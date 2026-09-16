import { useAppContext } from '../context';
import { ChevronRight, Copy, ShieldAlert } from 'lucide-react';
import type { ManagedCctpTransfer, ManagedUsdcBalance, ManagedUsdcTransfer } from '../adapters/interfaces';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

type CreditRow = { tournamentId: string; credit: string };
type CreditsState = 'idle' | 'loading' | 'ready' | 'error';
type WalletAction = { state: 'submitting' | 'error'; message?: string };
type LegacyBridgeAction = { state: 'submitting' | 'done' | 'error'; operation: ManagedCctpTransfer; message?: string };

export function Account() {
  const { account, managedAccount, agentApi, marketplaceApi, networkConfig, disconnectWallet, wallet } = useAppContext();
  const { managedIdentity } = useAppContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = ['claim', 'credits'].includes(searchParams.get('tab') || '') ? 'claim' : 'overview';
  const [balanceState, setBalanceState] = useState<'loading' | 'unavailable' | string>('loading');
  const [balanceReload, setBalanceReload] = useState(0);
  const [creditRows, setCreditRows] = useState<CreditRow[]>([]);
  const [creditsState, setCreditsState] = useState<CreditsState>('idle');
  const [creditsError, setCreditsError] = useState('');
  const [claimState, setClaimState] = useState<Record<string, 'submitting' | 'confirmed' | 'failed'>>({});
  const [marketplaceCredit, setMarketplaceCredit] = useState('0');
  const [marketplaceClaimState, setMarketplaceClaimState] = useState<'idle' | 'loading' | 'submitting' | 'confirmed' | 'failed'>('idle');
  const [reload, setReload] = useState(0);
  const [managedBalances, setManagedBalances] = useState<ManagedUsdcBalance[]>([]);
  const [balancesExpanded, setBalancesExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [destinationAddress, setDestinationAddress] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [walletAction, setWalletAction] = useState<WalletAction | null>(null);
  const [usdcTransfer, setUsdcTransfer] = useState<ManagedUsdcTransfer | null>(null);
  const [legacyBridgeAction, setLegacyBridgeAction] = useState<LegacyBridgeAction | null>(null);

  useEffect(() => {
    if (managedAccount && managedIdentity?.listUsdcBalances) {
      setBalanceState('loading');
      managedIdentity.listUsdcBalances().then((rows) => {
        setManagedBalances(rows);
        const arc = rows.find((row) => row.isArc);
        setBalanceState(arc?.available ? formatDisplayAmount(arc.amount) : 'unavailable');
      }).catch(() => setBalanceState('unavailable'));
    } else if (account && networkConfig) {
      setBalanceState('loading');
      wallet.getBalance(account, networkConfig)
        .then(val => {
          setBalanceState(formatUsdc(val));
        })
        .catch(() => setBalanceState('unavailable'));
    } else {
      setBalanceState('unavailable');
    }
  }, [account, balanceReload, managedAccount, managedIdentity, networkConfig, wallet]);

  useEffect(() => {
    if (!managedAccount || !managedIdentity?.listUsdcTransfers) { setUsdcTransfer(null); return; }
    let cancelled = false;
    setUsdcTransfer(null);
    managedIdentity.listUsdcTransfers().then((operations) => {
      if (!cancelled) setUsdcTransfer((current) => current ?? operations[0] ?? null);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [managedAccount, managedIdentity]);

  useEffect(() => {
    if (!usdcTransfer || !['PENDING', 'SUBMITTED'].includes(usdcTransfer.state) || !managedIdentity?.getUsdcTransfer) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const current = await managedIdentity.getUsdcTransfer!(usdcTransfer.operationId);
        if (!cancelled) {
          setUsdcTransfer(current);
          if (current.state === 'CONFIRMED') setBalanceReload((value) => value + 1);
        }
      } catch { /* Keep the persisted pending state visible until a later read succeeds. */ }
    }, 2500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [managedIdentity, usdcTransfer]);

  useEffect(() => {
    if (!managedAccount || !managedIdentity?.listCctpTransfers) return;
    let cancelled = false;
    managedIdentity.listCctpTransfers().then((operations) => {
      if (cancelled || operations.length === 0) return;
      const operation = operations[0];
      setLegacyBridgeAction((current) => {
        if (current) return current;
        if (operation.state === 'FAILED' || operation.state === 'RECOVERY_REQUIRED') {
          return { state: 'error', operation, message: operation.message || 'CCTP transfer failed.' };
        }
        return { state: operation.state === 'SUBMITTED' ? 'done' : 'submitting', operation };
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [managedAccount, managedIdentity]);

  useEffect(() => {
    if (legacyBridgeAction?.state !== 'submitting' || !managedIdentity?.getCctpTransfer) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const operation = await managedIdentity.getCctpTransfer!(legacyBridgeAction.operation.operationId);
        if (cancelled) return;
        if (operation.state === 'FAILED' || operation.state === 'RECOVERY_REQUIRED') {
          setLegacyBridgeAction({ state: 'error', operation, message: operation.message || 'CCTP transfer failed.' });
          return;
        }
        if (operation.state === 'SUBMITTED') {
          setLegacyBridgeAction({ state: 'done', operation });
          setBalanceReload((value) => value + 1);
          return;
        }
        setLegacyBridgeAction({ state: 'submitting', operation });
      } catch (reason) {
        if (!cancelled) setLegacyBridgeAction({ state: 'error', operation: legacyBridgeAction.operation, message: reason instanceof Error ? reason.message : 'Could not refresh CCTP status.' });
      }
    }, 2500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [managedIdentity, legacyBridgeAction]);

  useEffect(() => {
    let cancelled = false;
    if (activeTab !== 'claim' || !account || !networkConfig || !agentApi) {
      setCreditsState('idle');
      setCreditRows([]);
      return () => { cancelled = true; };
    }

    setCreditsState('loading');
    setCreditsError('');
    Promise.resolve()
      .then(async () => {
        const registrations = await agentApi.listOwnedRegistrations();
        const verified = await Promise.all(registrations.map(async (registration) => ({
          registration,
          entrant: await wallet.getEntrant(registration.tournamentId, registration.entrantId, networkConfig),
        })));
        const tournamentIds = [...new Set(verified
          .filter(({ entrant }) => entrant.registered && entrant.wallet.toLowerCase() === account.toLowerCase())
          .map(({ registration }) => registration.tournamentId))].sort();
        return Promise.all(tournamentIds.map(async (tournamentId) => ({
          tournamentId,
          credit: await wallet.getCredit(tournamentId, account, networkConfig),
        })));
      })
      .then((rows) => {
        if (cancelled) return;
        setCreditRows(rows);
        setCreditsState('ready');
      })
      .catch((reason) => {
        if (cancelled) return;
        setCreditsError(reason instanceof Error ? reason.message : 'Could not load tournament credits.');
        setCreditsState('error');
      });
    return () => { cancelled = true; };
  }, [account, activeTab, agentApi, networkConfig, reload, wallet]);

  useEffect(() => {
    let cancelled = false;
    if (activeTab !== 'claim' || !account || !marketplaceApi?.getCredit) {
      setMarketplaceCredit('0');
      setMarketplaceClaimState('idle');
      return () => { cancelled = true; };
    }
    setMarketplaceClaimState('loading');
    marketplaceApi.getCredit().then(({ amount }) => {
      if (!cancelled) { setMarketplaceCredit(amount); setMarketplaceClaimState('idle'); }
    }).catch(() => { if (!cancelled) setMarketplaceClaimState('failed'); });
    return () => { cancelled = true; };
  }, [account, activeTab, marketplaceApi, reload]);

  function selectTab(tab: 'overview' | 'claim') {
    setSearchParams(tab === 'claim' ? { tab: 'claim' } : {}, { replace: true });
  }

  async function claim(tournamentId: string) {
    if (!account || !networkConfig) return;
    setClaimState((current) => ({ ...current, [tournamentId]: 'submitting' }));
    try {
      if (managedAccount) {
        if (!managedIdentity?.claimTournamentCredit) throw new Error('Managed claim is unavailable.');
        await managedIdentity.claimTournamentCredit(tournamentId, crypto.randomUUID());
      } else {
        const transaction = await wallet.withdrawCredit(tournamentId, networkConfig);
        const receipt = await wallet.waitForTransaction(transaction.hash, networkConfig);
        if (receipt !== 'CONFIRMED') throw new Error('Claim transaction failed on Arc.');
      }
      const credit = await wallet.getCredit(tournamentId, account, networkConfig);
      setCreditRows((rows) => rows.map((row) => row.tournamentId === tournamentId ? { ...row, credit } : row));
      setBalanceReload((value) => value + 1);
      setClaimState((current) => ({ ...current, [tournamentId]: 'confirmed' }));
    } catch {
      setClaimState((current) => ({ ...current, [tournamentId]: 'failed' }));
    }
  }

  async function claimMarketplaceCredit() {
    if (!marketplaceApi?.withdrawCredit || BigInt(marketplaceCredit) === 0n) return;
    setMarketplaceClaimState('submitting');
    try {
      await marketplaceApi.withdrawCredit(crypto.randomUUID());
      const current = await marketplaceApi.getCredit?.();
      setMarketplaceCredit(current?.amount ?? '0');
      setMarketplaceClaimState('confirmed');
      setBalanceReload((value) => value + 1);
    } catch { setMarketplaceClaimState('failed'); }
  }

  async function copyAddress() {
    if (!account) return;
    await navigator.clipboard.writeText(account);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function submitTransfer(event: React.FormEvent) {
    event.preventDefault();
    if (!managedIdentity?.transferUsdc || (usdcTransfer && ['PENDING', 'SUBMITTED', 'RECOVERY_REQUIRED'].includes(usdcTransfer.state))) return;
    setWalletAction({ state: 'submitting' });
    try {
      const result = await managedIdentity.transferUsdc(destinationAddress, transferAmount);
      setUsdcTransfer(result);
      setWalletAction(null);
      setTransferAmount(''); setDestinationAddress('');
    } catch (reason) {
      setWalletAction({ state: 'error', message: reason instanceof Error ? reason.message : 'Transfer failed.' });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <div><p className="page-kicker">Wallet</p><h1 className="sr-only">Arena ISS wallet</h1></div>

      {!networkConfig && (
        <div className="glass-panel flex items-start gap-3 rounded-lg border-red-400/40 p-4">
          <ShieldAlert className="text-destructive mt-0.5 shrink-0" size={20} />
          <div>
            <h3 className="font-bold text-destructive">Network Not Configured</h3>
            <p className="text-sm text-foreground/80 mt-1">Cannot fetch live account balances or activity.</p>
          </div>
        </div>
      )}

      <div className="glass-panel rounded-[28px] p-2">
        <div role="tablist" aria-label="Account sections" className="grid grid-cols-2 gap-2">
          <button id="account-overview-tab" role="tab" aria-selected={activeTab === 'overview'} aria-controls="account-overview-panel" onClick={() => selectTab('overview')} className={activeTab === 'overview' ? 'metal-button-solid' : 'metal-button-ghost'}>Overview</button>
          <button id="account-claim-tab" role="tab" aria-selected={activeTab === 'claim'} aria-controls="account-claim-panel" onClick={() => selectTab('claim')} className={activeTab === 'claim' ? 'metal-button-solid' : 'metal-button-ghost'}>Claim</button>
        </div>
      </div>

      {activeTab === 'overview' && <div id="account-overview-panel" role="tabpanel" aria-labelledby="account-overview-tab" className="glass-panel rounded-[28px] p-6 md:p-8">
        {account ? (
          <div className="space-y-6">
            <div>
              <label className="text-sm text-muted-foreground uppercase tracking-wider font-bold block mb-1">{managedAccount ? 'Arena ISS wallet' : 'Connected address'}</label>
              <div className="retro-inset mt-2 flex items-center gap-3 p-3 pl-4">
                <span className="min-w-0 flex-1 break-all font-mono text-sm">{account}</span>
                <button type="button" className="metal-button-ghost shrink-0" onClick={copyAddress} aria-label="Copy wallet address"><Copy size={16} /> {copied ? 'Copied' : 'Copy'}</button>
              </div>
            </div>

            <div role="note" className="border-l-4 border-amber-600 bg-amber-50/70 p-4 text-sm leading-relaxed text-amber-950">
              <strong>Arena ISS is live on Arc Testnet.</strong> Use your Arc Testnet wallet address for direct USDC deposits. Withdrawals also settle on Arc Testnet.
            </div>

            <div>
              <label className="text-sm text-muted-foreground uppercase tracking-wider font-bold block mb-1">USDC Balance</label>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="text-4xl font-medium tracking-[-.04em] tabular-nums">
                  {balanceState === 'loading' && <span role="status" className="text-muted-foreground animate-pulse">Loading...</span>}
                  {balanceState === 'unavailable' && <span role="alert" className="text-destructive text-base font-normal">Unavailable</span>}
                  {balanceState !== 'loading' && balanceState !== 'unavailable' && <span>{balanceState} USDC</span>}
                </div>
                <a className="metal-button-ghost" href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Faucet USDC on Arc</a>
              </div>
            </div>

            {managedAccount && managedBalances.length > 0 && <div>
              <button
                type="button"
                className="mb-3 flex min-h-11 w-full items-center gap-2 text-left text-sm font-bold uppercase tracking-wider text-muted-foreground focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2"
                aria-expanded={balancesExpanded}
                aria-controls="usdc-balances-by-network"
                onClick={() => setBalancesExpanded((expanded) => !expanded)}
              >
                <ChevronRight aria-hidden="true" size={18} className={`shrink-0 transition-transform ${balancesExpanded ? 'rotate-90' : ''}`} />
                <span>USDC by network</span>
              </button>
              {balancesExpanded && <ul id="usdc-balances-by-network" className="grid gap-2 sm:grid-cols-2" aria-label="USDC balances by network">
                {managedBalances.map((row) => <li key={row.chain} className="retro-inset flex items-center justify-between gap-3 p-3"><span>{row.label}</span><strong>{row.available ? `${formatDisplayAmount(row.amount)} USDC` : 'Unavailable'}</strong></li>)}
              </ul>}
            </div>}

            {managedAccount && <div className="border-t border-border pt-6">
              <form className="wallet-action-form" onSubmit={submitTransfer}>
                <div className="wallet-action-form__intro"><h2 className="text-xl font-bold">Withdraw</h2><p className="mt-1 text-sm text-muted-foreground">Transfer testnet USDC to an EVM wallet on Arc.</p></div>
                <label className="block text-sm font-bold" htmlFor="withdraw-address">Recipient wallet</label>
                <input id="withdraw-address" className="retro-inset w-full p-3 font-mono text-sm" placeholder="0x…" required pattern="^0x[0-9a-fA-F]{40}$" value={destinationAddress} onChange={(event) => setDestinationAddress(event.target.value)} />
                <p className="wallet-action-form__hint text-xs font-semibold text-amber-900" aria-hidden="true"></p>
                <label className="block text-sm font-bold" htmlFor="withdraw-amount">Amount (USDC)</label>
                <input id="withdraw-amount" className="retro-inset w-full p-3" inputMode="decimal" placeholder="1.00" required pattern="^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,6})?$" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} />
                <button className="metal-button-solid w-full" disabled={walletAction?.state === 'submitting' || Boolean(usdcTransfer && ['PENDING', 'SUBMITTED', 'RECOVERY_REQUIRED'].includes(usdcTransfer.state))}>Withdraw USDC</button>
              </form>
            </div>}

            {walletAction && <div role={walletAction.state === 'error' ? 'alert' : 'status'} className={walletAction.state === 'error' ? 'text-sm font-semibold text-destructive' : 'text-sm font-semibold text-emerald-800'}>
              {walletAction.state === 'submitting' && 'Submitting securely through Circle…'}
              {walletAction.state === 'error' && walletAction.message}
            </div>}

            {usdcTransfer && <div role={usdcTransfer.state === 'FAILED' || usdcTransfer.state === 'RECOVERY_REQUIRED' ? 'alert' : 'status'} className="text-sm font-semibold">
              {usdcTransfer.state === 'PENDING' && 'USDC transfer request is being submitted to Circle.'}
              {usdcTransfer.state === 'SUBMITTED' && 'USDC transfer submitted. Waiting for Circle to confirm the Arc transaction.'}
              {usdcTransfer.state === 'CONFIRMED' && 'USDC transfer confirmed by Circle on Arc Testnet.'}
              {usdcTransfer.state === 'FAILED' && (usdcTransfer.message || 'USDC transfer failed. You may try again.')}
              {usdcTransfer.state === 'RECOVERY_REQUIRED' && (usdcTransfer.message || 'Transfer outcome is uncertain. Do not retry until it is reconciled.')}
              <span className="block break-all">{usdcTransfer.amount} USDC to {usdcTransfer.destinationAddress}</span>
              {usdcTransfer.explorerUrl && <> · <a className="underline" href={usdcTransfer.explorerUrl} target="_blank" rel="noreferrer">View transaction</a></>}
            </div>}

            {legacyBridgeAction && <div role={legacyBridgeAction.state === 'error' ? 'alert' : 'status'} className={legacyBridgeAction.state === 'error' ? 'text-sm font-semibold text-destructive' : 'text-sm font-semibold text-emerald-800'}>
              {legacyBridgeAction.state === 'submitting' && cctpStatusText(legacyBridgeAction.operation)}
              {legacyBridgeAction.state === 'error' && legacyBridgeAction.message}
              {legacyBridgeAction.state === 'done' && <>CCTP source burn submitted · {legacyBridgeAction.operation.explorerUrl
                ? <a className="underline" href={legacyBridgeAction.operation.explorerUrl} target="_blank" rel="noreferrer">View source transaction</a>
                : legacyBridgeAction.operation.transactionId}</>}
            </div>}

            <div className="pt-4 border-t border-border flex justify-end">
              <button
                onClick={disconnectWallet}
                className="metal-button-ghost border-red-800/50 text-red-900"
              >
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">No wallet connected.</p>
            <p className="text-sm">Use the sidebar to connect a provider.</p>
          </div>
        )}
      </div>}

      {activeTab === 'claim' && <div id="account-claim-panel" role="tabpanel" aria-labelledby="account-claim-tab" className="space-y-4">
        <div className="glass-panel flex flex-wrap items-start justify-between gap-4 rounded-[28px] p-6 md:p-8">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight">Claim assets</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Collect USDC credited to this account by Tournament rewards and Marketplace sales. Each claim is paid to the beneficiary recorded on Arc Testnet.</p>
          </div>
          {account && <button type="button" className="metal-button-ghost" disabled={creditsState === 'loading'} onClick={() => setReload((value) => value + 1)}>Refresh</button>}
        </div>

        {!account && <div className="glass-panel rounded-[28px] p-8 text-center text-muted-foreground">Connect a wallet to load your tournament history and claimable USDC.</div>}
        {account && !networkConfig && <div role="alert" className="glass-panel rounded-[28px] p-6 text-destructive">Arc Testnet is not configured.</div>}
        {account && networkConfig && !agentApi && <div role="status" className="glass-panel rounded-[28px] p-6 text-muted-foreground">Preparing your wallet session…</div>}
        {account && creditsState === 'loading' && <div role="status" aria-atomic="true" className="glass-panel rounded-[28px] p-8 text-muted-foreground">Verifying tournament registrations and escrow credits…</div>}
        {account && creditsState === 'error' && <div role="alert" className="glass-panel rounded-[28px] p-6"><p className="text-destructive">{creditsError}</p><button type="button" className="metal-button-ghost mt-4" onClick={() => setReload((value) => value + 1)}>Try again</button></div>}
        {account && creditsState === 'ready' && creditRows.length === 0 && <div className="glass-panel rounded-[28px] p-8 text-muted-foreground">No confirmed tournament participation was found for this wallet.</div>}
        {account && creditsState === 'ready' && creditRows.length > 0 && <ul className="space-y-3" aria-label="Participated tournaments">
          {creditRows.map((row) => {
            const claimable = BigInt(row.credit) > 0n;
            const state = claimState[row.tournamentId];
            return <li key={row.tournamentId} className="glass-panel flex flex-col gap-5 rounded-[24px] p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tournament ID</p>
                <p className="mt-2 break-all font-mono text-xs sm:text-sm">{row.tournamentId}</p>
                <p className={claimable ? 'mt-3 font-semibold text-emerald-800' : 'mt-3 text-sm text-muted-foreground'}>{claimable ? `${formatUsdc(row.credit)} USDC claimable` : 'Settled · no credit to claim'}</p>
                {state === 'confirmed' && <p role="status" className="mt-2 text-sm font-semibold text-emerald-800">Claim confirmed.</p>}
                {state === 'failed' && <p role="alert" className="mt-2 text-sm font-semibold text-destructive">Claim failed or was rejected. No payout was recorded.</p>}
              </div>
              {claimable && <button type="button" className="metal-button-solid shrink-0" disabled={state === 'submitting'} onClick={() => claim(row.tournamentId)}>{state === 'submitting' ? 'Claiming…' : 'Claim Tournament reward'}</button>}
            </li>;
          })}
        </ul>}
        {account && <section className="glass-panel flex flex-wrap items-center justify-between gap-5 rounded-[24px] p-5 md:p-6" aria-labelledby="marketplace-claim-heading"><div><p className="page-kicker">Marketplace</p><h3 id="marketplace-claim-heading" className="mt-1 text-xl font-bold">{formatUsdc(marketplaceCredit)} USDC claimable</h3><p className="mt-2 text-sm text-muted-foreground">Net proceeds from completed Agent sales after the fixed 1% Marketplace fee.</p>{marketplaceClaimState === 'confirmed' && <p role="status" className="mt-2 text-sm font-semibold text-emerald-800">Marketplace claim submitted.</p>}{marketplaceClaimState === 'failed' && <p role="alert" className="mt-2 text-sm font-semibold text-destructive">Marketplace credit could not be loaded or claimed.</p>}</div><button type="button" className="metal-button-solid" disabled={marketplaceClaimState === 'loading' || marketplaceClaimState === 'submitting' || BigInt(marketplaceCredit) === 0n || !marketplaceApi?.withdrawCredit} onClick={claimMarketplaceCredit}>{marketplaceClaimState === 'submitting' ? 'Claiming…' : 'Claim Marketplace proceeds'}</button></section>}
      </div>}
    </div>
  );
}

function formatUsdc(baseUnits: string): string {
  if (!/^\d+$/.test(baseUnits)) throw new Error('INVALID_BALANCE');
  const value = BigInt(baseUnits);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}.00`;
}

function formatDisplayAmount(value: string): string {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return '0.00';
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : `${whole}.00`;
}

function cctpStatusText(operation: ManagedCctpTransfer): string {
  if (operation.state === 'PENDING') return 'CCTP transfer queued. Preparing Circle operation...';
  if (operation.state === 'APPROVING') return 'Approving USDC spend on the source network...';
  if (operation.state === 'BURNING') return 'Burning source USDC and forwarding to Arc Testnet...';
  return 'Refreshing CCTP transfer status...';
}
