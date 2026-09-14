import { useAppContext } from '../context';
import { ShieldAlert } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

type CreditRow = { tournamentId: string; credit: string };
type CreditsState = 'idle' | 'loading' | 'ready' | 'error';

export function Account() {
  const { account, agentApi, networkConfig, disconnectWallet, wallet } = useAppContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'credits' ? 'credits' : 'overview';
  const [balanceState, setBalanceState] = useState<'loading' | 'unavailable' | string>('loading');
  const [balanceReload, setBalanceReload] = useState(0);
  const [creditRows, setCreditRows] = useState<CreditRow[]>([]);
  const [creditsState, setCreditsState] = useState<CreditsState>('idle');
  const [creditsError, setCreditsError] = useState('');
  const [claimState, setClaimState] = useState<Record<string, 'submitting' | 'confirmed' | 'failed'>>({});
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (account && networkConfig) {
      setBalanceState('loading');
      wallet.getBalance(account, networkConfig)
        .then(val => {
          setBalanceState(formatUsdc(val));
        })
        .catch(() => setBalanceState('unavailable'));
    } else {
      setBalanceState('unavailable');
    }
  }, [account, balanceReload, networkConfig, wallet]);

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
    if (!account || !networkConfig) return;
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

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <div><p className="page-kicker">Wallet</p><h1 className="page-title">Account</h1></div>

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
              <label className="text-sm text-muted-foreground uppercase tracking-wider font-bold block mb-1">Connected Address</label>
              <div className="retro-inset mt-2 break-all p-4 font-mono text-sm">
                {account}
              </div>
            </div>

            <div>
              <label className="text-sm text-muted-foreground uppercase tracking-wider font-bold block mb-1">USDC Balance</label>
              <div className="text-4xl font-medium tracking-[-.04em] tabular-nums">
                {balanceState === 'loading' && <span role="status" className="text-muted-foreground animate-pulse">Loading...</span>}
                {balanceState === 'unavailable' && <span role="alert" className="text-destructive text-base font-normal">Unavailable</span>}
                {balanceState !== 'loading' && balanceState !== 'unavailable' && <span>{balanceState} USDC</span>}
              </div>
            </div>

            <div className="pt-4 border-t border-border flex justify-end">
              <button
                onClick={disconnectWallet}
                className="metal-button-ghost border-red-800/50 text-red-900"
              >
                Disconnect Wallet
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
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Every confirmed tournament participation for this wallet is verified against the Arc escrow. Claim sends an Arc Testnet transaction and the contract pays the connected beneficiary.</p>
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
              {claimable && <button type="button" className="metal-button-solid shrink-0" disabled={state === 'submitting'} onClick={() => claim(row.tournamentId)}>{state === 'submitting' ? 'Claiming…' : 'Claim'}</button>}
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
