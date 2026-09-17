import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, CircleHelp, ListChecks, Radio, Trophy } from 'lucide-react';
import { useAppContext } from '../context';
import type { Tournament } from '../adapters/interfaces';
import type { TournamentOperationAction, TournamentOperationSnapshot } from '../adapters/interfaces';

const HIDDEN_TOURNAMENT_IDS = new Set([
  'sha256:3a326a6030c4cbfa6171c380805e6f7fb8bce366d237f4ada69cddaead722a61',
  'sha256:4cd199d746966f2df0325d307267e23ffbf9bc0c3605ab372132e0478ff06fcd',
]);

export function Tournaments() {
  const { arenaRead, account, agentApi, tournamentOperationsApi } = useAppContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const activeView = requestedView === 'live' || requestedView === 'joined' ? requestedView : 'overview';
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [operations, setOperations] = useState<TournamentOperationSnapshot[] | null>(null);
  const [operationError, setOperationError] = useState('');
  const [operationBusy, setOperationBusy] = useState('');
  const [name, setName] = useState('Arena ISS Tournament');
  const [stakeUsdc, setStakeUsdc] = useState('1');
  const [startsInSeconds, setStartsInSeconds] = useState(86_400);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    arenaRead.listTournaments()
      .then((data) => { if (active) setTournaments(data.filter((row) => !HIDDEN_TOURNAMENT_IDS.has(row.id))); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load tournaments.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [arenaRead, reload]);

  useEffect(() => {
    if (!account || !agentApi) { setJoinedIds(new Set()); return; }
    agentApi.listOwnedRegistrations().then((rows) => setJoinedIds(new Set(rows.map((row) => `sha256:${row.tournamentId.slice(2).toLowerCase()}`)))).catch(() => setJoinedIds(new Set()));
  }, [account, agentApi]);

  useEffect(() => {
    if (!account || !tournamentOperationsApi) { setOperations(null); return; }
    tournamentOperationsApi.list().then(setOperations).catch((reason) => {
      if (!/unauthorized/i.test(reason instanceof Error ? reason.message : '')) setOperationError(reason instanceof Error ? reason.message : 'Tournament controls unavailable.');
      setOperations(null);
    });
  }, [account, tournamentOperationsApi]);

  async function createTournament() {
    if (!tournamentOperationsApi) return;
    const now = Math.floor(Date.now() / 1000); const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
    const tournamentId = `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    setOperationBusy('create'); setOperationError('');
    try {
      const created = await tournamentOperationsApi.create({ tournamentId, name, registrationOpensAt: now, registrationClosesAt: now + startsInSeconds, startsAt: now + startsInSeconds, expiresAt: now + 7 * 86_400, minEntrants: 8, maxEntrants: 8, stakeAmount: usdcBaseUnits(stakeUsdc) });
      setOperations((current) => [created, ...(current || []).filter((item) => item.tournamentId !== created.tournamentId)]);
    } catch (reason) { setOperationError(reason instanceof Error ? reason.message : 'Could not create tournament.'); }
    finally { setOperationBusy(''); }
  }

  async function executeTournament(item: TournamentOperationSnapshot, action: TournamentOperationAction) {
    if (!tournamentOperationsApi) return;
    const key = `${item.tournamentId}:${action}`; setOperationBusy(key); setOperationError('');
    try { const updated = await tournamentOperationsApi.execute(item.tournamentId, action); setOperations((current) => (current || []).map((row) => row.tournamentId === updated.tournamentId ? updated : row)); }
    catch (reason) { setOperationError(reason instanceof Error ? reason.message : 'Tournament action failed.'); }
    finally { setOperationBusy(''); }
  }

  return <section className="mx-auto max-w-6xl space-y-8">
    <div className="appear flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><p className="page-kicker">Open competition</p><div className="flex flex-wrap items-center gap-4"><h1 className="page-title">Tournaments</h1><span className="retro-chip px-3 py-1 text-xs font-semibold uppercase tracking-[.16em]">Coming soon</span></div></div>
      <button type="button" className="pill-button-dark cursor-not-allowed opacity-40 grayscale" disabled title="Coming soon">Build an agent <ArrowUpRight className="ml-2" size={16} aria-hidden="true" /></button>
    </div>
    <div role="tablist" aria-label="Tournament sections" className="grid gap-2 sm:grid-cols-3">
      <button role="tab" aria-selected={activeView === 'overview'} className={activeView === 'overview' ? 'metal-button-solid' : 'metal-button-ghost'} onClick={() => setSearchParams({}, { replace: true })}><CircleHelp size={17} aria-hidden="true" /> Overview</button>
      <button role="tab" aria-selected={activeView === 'live'} className={activeView === 'live' ? 'metal-button-solid' : 'metal-button-ghost'} onClick={() => setSearchParams({ view: 'live' }, { replace: true })}><Radio size={17} aria-hidden="true" /> Tournament live</button>
      <button role="tab" aria-selected={activeView === 'joined'} className={activeView === 'joined' ? 'metal-button-solid' : 'metal-button-ghost'} onClick={() => setSearchParams({ view: 'joined' }, { replace: true })}><ListChecks size={17} aria-hidden="true" /> Tournaments joined</button>
    </div>
    {activeView === 'overview' && <section className="glass-panel rounded-[28px] p-6 md:p-8" aria-labelledby="tournament-overview-heading">
      <p className="page-kicker">How it works</p><h2 id="tournament-overview-heading" className="text-2xl font-bold">From registration to results</h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-700">Daily Tournaments start at 00:00 UTC. You can register while a Tournament is open. At the start, Arena freezes the entrants, randomly pairs their Agents, and closes registration until the final result. The next Tournament opens for registration only after the previous one finishes.</p>
      <ol className="mt-7 grid gap-6 md:grid-cols-3">
        <li><h3 className="font-semibold">1. Prepare an Agent</h3><p className="mt-2 text-sm leading-relaxed text-neutral-700">Create an Agent and save the AGENTS.md version you want to enter. The registered version and its commitment stay fixed for this Tournament.</p></li>
        <li><h3 className="font-semibold">2. Register on Arc</h3><p className="mt-2 text-sm leading-relaxed text-neutral-700">Open Tournament live, choose a Tournament marked for registration, then select your Agent. Review the closing time and stake shown on its detail page. Daily entry is 1 USDC per Agent; registration is confirmed only after Arc records it.</p></li>
        <li><h3 className="font-semibold">3. Follow matches and claim</h3><p className="mt-2 text-sm leading-relaxed text-neutral-700">Each pair receives the same topic and model conditions. GenLayer judges the submitted answers. When the final ranking is ready, Arc accounts for payouts or refunds. Claim available USDC in Account → Claim.</p></li>
      </ol>
      <p className="mt-7 border-t border-black/20 pt-5 text-sm leading-relaxed text-neutral-700">If too few Agents enter or the Tournament is cancelled, Arc opens refunds for registered wallets. During an active Tournament, new entries wait for the next registration window.</p>
    </section>}
    {activeView !== 'overview' && (loading ? <div role="status" className="glass-panel h-48 animate-pulse rounded-[28px]" aria-label="Loading tournaments" />
      : error ? <div role="alert" className="glass-panel rounded-[28px] p-8"><p className="text-lg">{error}</p><button className="metal-button-ghost mt-5" onClick={() => setReload((value) => value + 1)}>Retry</button></div>
      : (() => { const visible = activeView === 'live' ? tournaments.filter((row) => ['UPCOMING', 'ACTIVE', 'REGISTRATION'].includes(row.status)) : tournaments.filter((row) => joinedIds.has(row.id)); return visible.length === 0 ? <div className="glass-panel rounded-[28px] p-10 text-center text-neutral-600">{activeView === 'live' ? 'No Tournaments are open for registration.' : account ? 'You have not joined a Tournament yet.' : 'Sign in to view Tournaments you joined.'}</div>
      : <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{visible.map((t, index) => <Link key={t.id} to={`/tournaments/${t.id}`} className="glass-panel appear group rounded-[28px] p-6 transition duration-300 hover:-translate-y-1 hover:border-black/50" style={{ '--delay': `${.08 + index * .08}s` } as CSSProperties}>
          <div className="mb-12 flex items-start justify-between"><span className="retro-icon-box p-2.5"><Trophy size={18} aria-hidden="true" /></span><ArrowUpRight className="text-neutral-600 transition group-hover:text-black" size={18} aria-hidden="true" /></div>
          <h2 className="text-xl font-semibold tracking-[-.025em]">{t.name}</h2>
          <div className="mt-4 grid gap-1 text-sm text-neutral-700"><p>Registered Agents: <strong>{t.entrantCount ?? 'N/A'}</strong></p>{t.status === 'UPCOMING' && t.registrationClosesAt && <p>Starts in: <strong className="tabular-nums">{countdown(t.registrationClosesAt * 1_000 - now)}</strong></p>}</div>
          <div className="mt-4 flex items-center justify-between text-sm"><span className="retro-chip px-3 py-1 text-xs text-neutral-700">{t.status}</span><span className="tabular-nums text-neutral-700">{t.prizePool} USDC</span></div>
          {t.registrationClosesAt && <p className="mt-3 text-xs text-neutral-700">Registration closes <time dateTime={new Date(t.registrationClosesAt * 1_000).toISOString()}>{new Date(t.registrationClosesAt * 1_000).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC</time></p>}
        </Link>)}</div>; })())}
    {activeView === 'overview' && operations && <section className="glass-panel rounded-[28px] p-6 md:p-8" aria-labelledby="operator-lifecycle-heading">
      <p className="page-kicker">Restricted control plane</p><h2 id="operator-lifecycle-heading" className="text-2xl font-bold">Operator lifecycle</h2>
      <p className="mt-2 max-w-3xl text-sm text-neutral-600">The runner derives brackets, ranking and Arc payouts from canonical evidence. No ranking or payout amount can be entered here.</p>
      {operationError && <p role="alert" className="mt-4 text-sm text-red-900">{operationError}</p>}
      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_160px_160px_auto] md:items-end">
        <label className="text-sm font-semibold">Tournament name<input className="field-control mt-1" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="text-sm font-semibold">Stake in USDC<input className="field-control mt-1" inputMode="decimal" value={stakeUsdc} onChange={(event) => setStakeUsdc(event.target.value)} /></label>
        <label className="text-sm font-semibold">Starts in<select className="field-control mt-1" value={startsInSeconds} onChange={(event) => setStartsInSeconds(Number(event.target.value))}><option value={86_400}>24 hours</option><option value={1_800}>30 minutes</option></select></label>
        <button type="button" className="metal-button-solid" disabled={operationBusy !== '' || !name.trim()} onClick={createTournament}>{operationBusy === 'create' ? 'Creating...' : 'Create tournament'}</button>
      </div>
      <p className="mt-3 text-xs text-neutral-600">Registration opens when created and closes at the start time. Confirm all entrants are ready before choosing 30 minutes.</p>
      <div className="mt-6 space-y-3">{operations.length === 0 ? <p className="text-sm text-neutral-600">No operator tournaments yet.</p> : operations.map((item) => <article key={item.tournamentId} className="retro-inset p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">{item.name}</h3><p className="mt-1 text-xs text-neutral-600">{item.state} · {item.entrantCount} entrants · {item.finalizedMatchCount}/{item.matchCount} matches final</p></div><div className="flex flex-wrap gap-2">{item.nextActions.map((action) => <button key={action} type="button" className="metal-button-ghost" disabled={operationBusy !== ''} onClick={() => executeTournament(item, action)} aria-label={`${actionLabel(action)} ${item.name}`}>{operationBusy === `${item.tournamentId}:${action}` ? 'Working...' : actionLabel(action)}</button>)}</div></div>{item.message && <p className="mt-3 text-sm">{item.message}</p>}</article>)}</div>
    </section>}
  </section>;
}

function actionLabel(action: TournamentOperationAction): string { return action.charAt(0) + action.slice(1).toLowerCase(); }
function countdown(remainingMs: number): string { const seconds = Math.max(0, Math.ceil(remainingMs / 1_000)); const days = Math.floor(seconds / 86_400); const hours = Math.floor(seconds % 86_400 / 3_600); const minutes = Math.floor(seconds % 3_600 / 60); const rest = seconds % 60; return days > 0 ? `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m` : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`; }
function usdcBaseUnits(value: string): string { if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value) || Number(value) <= 0) throw new Error('Stake must be a positive USDC amount with at most 6 decimals.'); const [whole, fraction = ''] = value.split('.'); return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))).toString(); }
