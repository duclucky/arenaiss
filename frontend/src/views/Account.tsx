import { useAppContext } from '../context';
import { ChevronRight, Copy, ShieldAlert } from 'lucide-react';
import type { ManagedCctpTransfer, ManagedUsdcBalance, ManagedWalletTransaction } from '../adapters/interfaces';
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

type CreditRow = { tournamentId: string; credit: string };
type CreditsState = 'idle' | 'loading' | 'ready' | 'error';
type WalletAction =
  | { kind: 'transfer'; state: 'submitting' | 'done' | 'error'; result?: ManagedWalletTransaction; message?: string }
  | { kind: 'bridge'; state: 'submitting' | 'done' | 'error'; operation?: ManagedCctpTransfer; message?: string };

export function Account() {
  const { account, managedAccount, agentApi, networkConfig, disconnectWallet, wallet } = useAppContext();
  const { managedIdentity } = useAppContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'credits' ? 'credits' : 'overview';
  const [balanceState, setBalanceState] = useState<'loading' | 'unavailable' | string>('loading');
  const [balanceReload, setBalanceReload] = useState(0);
  const [creditRows, setCreditRows] = useState<CreditRow[]>([]);
  const [creditsState, setCreditsState] = useState<CreditsState>('idle');
  const [creditsError, setCreditsError] = useState('');
  const [claimState, setClaimState] = useState<Record<string, 'submitting' | 'confirmed' | 'failed'>>({});
  const [reload, setReload] = useState(0);
  const [managedBalances, setManagedBalances] = useState<ManagedUsdcBalance[]>([]);
  const [balancesExpanded, setBalancesExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [destinationAddress, setDestinationAddress] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [bridgeChain, setBridgeChain] = useState('ETH-SEPOLIA');
  const [bridgeAmount, setBridgeAmount] = useState('');
  const [walletAction, setWalletAction] = useState<WalletAction | null>(null);
  const bridgeableBalances = useMemo(() => managedBalances.filter((row) => !row.isArc && row.available && baseUnits(row.amount) > 0n), [managedBalances]);
  const selectedBridgeBalance = useMemo(() => managedBalances.find((row) => row.chain === bridgeChain), [bridgeChain, managedBalances]);
  const selectedBridgeHasUsdc = Boolean(selectedBridgeBalance?.available && baseUnits(selectedBridgeBalance.amount) > 0n);

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
    const firstAvailable = bridgeableBalances.find((row) => CCTP_CHAINS.some(([chain]) => chain === row.chain));
    if (firstAvailable && !selectedBridgeHasUsdc) setBridgeChain(firstAvailable.chain);
  }, [bridgeableBalances, selectedBridgeHasUsdc]);

  useEffect(() => {
    if (walletAction?.kind !== 'bridge' || walletAction.state !== 'submitting' || !walletAction.operation?.operationId || !managedIdentity?.getCctpTransfer) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const operation = await managedIdentity.getCctpTransfer!(walletAction.operation!.operationId);
        if (cancelled) return;
        if (operation.state === 'FAILED' || operation.state === 'RECOVERY_REQUIRED') {
          setWalletAction({ kind: 'bridge', state: 'error', operation, message: operation.message || 'CCTP transfer failed.' });
          return;
        }
        if (operation.state === 'SUBMITTED') {
          setWalletAction({ kind: 'bridge', state: 'done', operation });
          setBridgeAmount('');
          setBalanceReload((value) => value + 1);
          return;
        }
        setWalletAction({ kind: 'bridge', state: 'submitting', operation });
      } catch (reason) {
        if (!cancelled) setWalletAction({ kind: 'bridge', state: 'error', operation: walletAction.operation, message: reason instanceof Error ? reason.message : 'Could not refresh CCTP status.' });
      }
    }, 2500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [managedIdentity, walletAction]);

  useEffect(() => {
    let cancelled = false;
    if (activeTab !== 'credits' || !account || !networkConfig || !agentApi) {
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

  function selectTab(tab: 'overview' | 'credits') {
    setSearchParams(tab === 'credits' ? { tab: 'credits' } : {}, { replace: true });
  }

  async function claim(tournamentId: string) {
    if (!account || !networkConfig || managedAccount) return;
    setClaimState((current) => ({ ...current, [tournamentId]: 'submitting' }));
    try {
      const transaction = await wallet.withdrawCredit(tournamentId, networkConfig);
      const receipt = await wallet.waitForTransaction(transaction.hash, networkConfig);
      if (receipt !== 'CONFIRMED') throw new Error('Claim transaction failed on Arc.');
      const credit = await wallet.getCredit(tournamentId, account, networkConfig);
      setCreditRows((rows) => rows.map((row) => row.tournamentId === tournamentId ? { ...row, credit } : row));
      setBalanceReload((value) => value + 1);
      setClaimState((current) => ({ ...current, [tournamentId]: 'confirmed' }));
    } catch {
      setClaimState((current) => ({ ...current, [tournamentId]: 'failed' }));
    }
  }

  async function copyAddress() {
    if (!account) return;
    await navigator.clipboard.writeText(account);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function submitTransfer(event: React.FormEvent) {
    event.preventDefault();
    if (!managedIdentity?.transferUsdc) return;
    setWalletAction({ kind: 'transfer', state: 'submitting' });
    try {
      const result = await managedIdentity.transferUsdc(destinationAddress, transferAmount);
      setWalletAction({ kind: 'transfer', state: 'done', result });
      setTransferAmount(''); setDestinationAddress(''); setBalanceReload((value) => value + 1);
    } catch (reason) {
      setWalletAction({ kind: 'transfer', state: 'error', message: reason instanceof Error ? reason.message : 'Transfer failed.' });
    }
  }

  async function submitBridge(event: React.FormEvent) {
    event.preventDefault();
    if (!managedIdentity?.bridgeUsdcToArc) return;
    if (!selectedBridgeHasUsdc) {
      setWalletAction({ kind: 'bridge', state: 'error', message: 'Select a source network with available USDC.' });
      return;
    }
    if (selectedBridgeBalance && baseUnits(selectedBridgeBalance.amount) < baseUnits(bridgeAmount)) {
      setWalletAction({ kind: 'bridge', state: 'error', message: 'Source network USDC balance is insufficient.' });
      return;
    }
    setWalletAction({ kind: 'bridge', state: 'submitting' });
    try {
      const operation = await managedIdentity.bridgeUsdcToArc(bridgeChain, bridgeAmount);
      if (operation.state === 'FAILED' || operation.state === 'RECOVERY_REQUIRED') {
        setWalletAction({ kind: 'bridge', state: 'error', operation, message: operation.message || 'CCTP transfer failed.' });
      } else if (operation.state === 'SUBMITTED') {
        setWalletAction({ kind: 'bridge', state: 'done', operation });
        setBridgeAmount(''); setBalanceReload((value) => value + 1);
      } else {
        setWalletAction({ kind: 'bridge', state: 'submitting', operation });
      }
    } catch (reason) {
      setWalletAction({ kind: 'bridge', state: 'error', message: reason instanceof Error ? reason.message : 'Bridge failed.' });
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
          <button id="account-credits-tab" role="tab" aria-selected={activeTab === 'credits'} aria-controls="account-credits-panel" onClick={() => selectTab('credits')} className={activeTab === 'credits' ? 'metal-button-solid' : 'metal-button-ghost'}>Tournament credits</button>
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
              <strong>Arena ISS is live on Arc Testnet.</strong> Direct deposits and withdrawals use Arc Testnet. CCTP deposits burn USDC on the selected source chain and mint it to this wallet on Arc Testnet.
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

            {managedAccount && <div className="wallet-action-grid grid gap-5 border-t border-border pt-6 lg:grid-cols-2">
              <form className="wallet-action-form" onSubmit={submitBridge}>
                <div className="wallet-action-form__intro"><h2 className="text-xl font-bold">Bridge USDC to Arc Testnet</h2><p className="mt-1 text-sm text-muted-foreground">CCTP V2 Fast · destination is this Arena ISS wallet. The source SCA needs USDC for the transfer and CCTP fee; Gas Station sponsors source-network gas when its policy applies.</p></div>
                <label className="block text-sm font-bold" htmlFor="bridge-chain">Source network</label>
                <select id="bridge-chain" className="retro-inset w-full p-3" value={bridgeChain} onChange={(event) => setBridgeChain(event.target.value)}>
                  {CCTP_CHAINS.map(([value, label]) => {
                    const balance = managedBalances.find((row) => row.chain === value);
                    const hasUsdc = Boolean(balance?.available && baseUnits(balance.amount) > 0n);
                    return <option value={value} key={value} disabled={!hasUsdc}>{label}{hasUsdc ? ` · ${formatDisplayAmount(balance!.amount)} USDC` : ' · no USDC'}</option>;
                  })}
                </select>
                <p className="wallet-action-form__hint text-xs font-semibold text-amber-900">{!selectedBridgeHasUsdc ? 'Choose a source network with available testnet USDC before bridging.' : ''}</p>
                <label className="block text-sm font-bold" htmlFor="bridge-amount">Amount (USDC)</label>
                <input id="bridge-amount" className="retro-inset w-full p-3" inputMode="decimal" placeholder="1.00" required pattern="^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,6})?$" value={bridgeAmount} onChange={(event) => setBridgeAmount(event.target.value)} />
                <button className="metal-button-solid w-full" disabled={walletAction?.state === 'submitting' || !selectedBridgeHasUsdc}>Bridge to Arc Testnet</button>
              </form>

              <form className="wallet-action-form" onSubmit={submitTransfer}>
                <div className="wallet-action-form__intro"><h2 className="text-xl font-bold">Withdraw</h2><p className="mt-1 text-sm text-muted-foreground">Transfer testnet USDC to an EVM wallet on Arc.</p></div>
                <label className="block text-sm font-bold" htmlFor="withdraw-address">Recipient wallet</label>
                <input id="withdraw-address" className="retro-inset w-full p-3 font-mono text-sm" placeholder="0x…" required pattern="^0x[0-9a-fA-F]{40}$" value={destinationAddress} onChange={(event) => setDestinationAddress(event.target.value)} />
                <p className="wallet-action-form__hint text-xs font-semibold text-amber-900" aria-hidden="true"></p>
                <label className="block text-sm font-bold" htmlFor="withdraw-amount">Amount (USDC)</label>
                <input id="withdraw-amount" className="retro-inset w-full p-3" inputMode="decimal" placeholder="1.00" required pattern="^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,6})?$" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} />
                <button className="metal-button-solid w-full" disabled={walletAction?.state === 'submitting'}>Withdraw USDC</button>
              </form>
            </div>}

            {walletAction && <div role={walletAction.state === 'error' ? 'alert' : 'status'} className={walletAction.state === 'error' ? 'text-sm font-semibold text-destructive' : 'text-sm font-semibold text-emerald-800'}>
              {walletAction.state === 'submitting' && (walletAction.kind === 'bridge' && walletAction.operation ? cctpStatusText(walletAction.operation) : 'Submitting securely through Circle…')}
              {walletAction.state === 'error' && walletAction.message}
              {walletAction.state === 'done' && walletAction.kind === 'transfer' && <>Transaction submitted · {walletAction.result?.explorerUrl
                ? <a className="underline" href={walletAction.result.explorerUrl} target="_blank" rel="noreferrer">View transaction</a>
                : walletAction.result?.transactionId}</>}
              {walletAction.state === 'done' && walletAction.kind === 'bridge' && <>CCTP source burn submitted · {walletAction.operation?.explorerUrl
                ? <a className="underline" href={walletAction.operation.explorerUrl} target="_blank" rel="noreferrer">View source transaction</a>
                : walletAction.operation?.transactionId}</>}
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

      {activeTab === 'credits' && <div id="account-credits-panel" role="tabpanel" aria-labelledby="account-credits-tab" className="space-y-4">
        <div className="glass-panel flex flex-wrap items-start justify-between gap-4 rounded-[28px] p-6 md:p-8">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight">Tournament credits</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Every confirmed tournament participation for this account is verified against the Arc escrow. A positive credit is claimable only by its recorded beneficiary.</p>
            {managedAccount && <p className="mt-3 text-sm font-semibold text-amber-900">Circle contract execution is not enabled yet. Arena will not fall back to your sign-in wallet for claims.</p>}
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
              {claimable && !managedAccount && <button type="button" className="metal-button-solid shrink-0" disabled={state === 'submitting'} onClick={() => claim(row.tournamentId)}>{state === 'submitting' ? 'Claiming…' : 'Claim'}</button>}
              {claimable && managedAccount && <span className="text-sm font-semibold text-amber-900">Claim unavailable until managed execution is enabled</span>}
            </li>;
          })}
        </ul>}
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

function baseUnits(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return 0n;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0');
}

function cctpStatusText(operation: ManagedCctpTransfer): string {
  if (operation.state === 'PENDING') return 'CCTP transfer queued. Preparing Circle operation...';
  if (operation.state === 'APPROVING') return 'Approving USDC spend on the source network...';
  if (operation.state === 'BURNING') return 'Burning source USDC and forwarding to Arc Testnet...';
  return 'Refreshing CCTP transfer status...';
}

const CCTP_CHAINS = [
  ['ETH-SEPOLIA', 'Ethereum Sepolia'], ['BASE-SEPOLIA', 'Base Sepolia'], ['ARB-SEPOLIA', 'Arbitrum Sepolia'],
  ['OP-SEPOLIA', 'OP Sepolia'],
] as const;
