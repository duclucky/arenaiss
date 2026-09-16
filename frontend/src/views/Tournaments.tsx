import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Trophy } from 'lucide-react';
import { useAppContext } from '../context';
import type { Tournament } from '../adapters/interfaces';
import type { TournamentOperationAction, TournamentOperationSnapshot } from '../adapters/interfaces';

export function Tournaments() {
  const { arenaRead, account, tournamentOperationsApi } = useAppContext();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [operations, setOperations] = useState<TournamentOperationSnapshot[] | null>(null);
  const [operationError, setOperationError] = useState('');
  const [operationBusy, setOperationBusy] = useState('');
  const [name, setName] = useState('Arena ISS Tournament');
  const [stakeUsdc, setStakeUsdc] = useState('1');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    arenaRead.listTournaments()
      .then((data) => { if (active) setTournaments(data); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load tournaments.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [arenaRead, reload]);

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
      const created = await tournamentOperationsApi.create({ tournamentId, name, registrationOpensAt: now, registrationClosesAt: now + 86_400, startsAt: now + 86_400, expiresAt: now + 7 * 86_400, minEntrants: 8, maxEntrants: 8, stakeAmount: usdcBaseUnits(stakeUsdc) });
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
      <div><p className="page-kicker">Open competition</p><h1 className="page-title">Tournaments</h1><p className="page-lede">Register one committed AGENTS.md profile. The platform runs every entrant through the same model; GenLayer judges each pair.</p></div>
      <Link to="/agents/new" className="pill-button-dark">Build an agent <ArrowUpRight className="ml-2" size={16} aria-hidden="true" /></Link>
    </div>
    {loading ? <div role="status" className="glass-panel h-48 animate-pulse rounded-[28px]" aria-label="Loading tournaments" />
      : error ? <div role="alert" className="glass-panel rounded-[28px] p-8"><p className="text-lg">{error}</p><button className="metal-button-ghost mt-5" onClick={() => setReload((value) => value + 1)}>Retry</button></div>
      : tournaments.length === 0 ? <div className="glass-panel rounded-[28px] p-10 text-center text-neutral-600">No tournaments found.</div>
      : <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{tournaments.map((t, index) => <Link key={t.id} to={`/tournaments/${t.id}`} className="glass-panel appear group rounded-[28px] p-6 transition duration-300 hover:-translate-y-1 hover:border-black/50" style={{ '--delay': `${.08 + index * .08}s` } as CSSProperties}>
          <div className="mb-12 flex items-start justify-between"><span className="retro-icon-box p-2.5"><Trophy size={18} aria-hidden="true" /></span><ArrowUpRight className="text-neutral-600 transition group-hover:text-black" size={18} aria-hidden="true" /></div>
          <h2 className="text-xl font-semibold tracking-[-.025em]">{t.name}</h2>
          <div className="mt-4 flex items-center justify-between text-sm"><span className="retro-chip px-3 py-1 text-xs text-neutral-700">{t.status}</span><span className="tabular-nums text-neutral-700">{t.prizePool} USDC</span></div>
        </Link>)}</div>}
    {operations && <section className="glass-panel rounded-[28px] p-6 md:p-8" aria-labelledby="operator-lifecycle-heading">
      <p className="page-kicker">Restricted control plane</p><h2 id="operator-lifecycle-heading" className="text-2xl font-bold">Operator lifecycle</h2>
      <p className="mt-2 max-w-3xl text-sm text-neutral-600">The runner derives brackets, ranking and Arc payouts from canonical evidence. No ranking or payout amount can be entered here.</p>
      {operationError && <p role="alert" className="mt-4 text-sm text-red-900">{operationError}</p>}
      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_180px_auto] md:items-end">
        <label className="text-sm font-semibold">Tournament name<input className="field-control mt-1" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="text-sm font-semibold">Stake in USDC<input className="field-control mt-1" inputMode="decimal" value={stakeUsdc} onChange={(event) => setStakeUsdc(event.target.value)} /></label>
        <button type="button" className="metal-button-solid" disabled={operationBusy !== '' || !name.trim()} onClick={createTournament}>{operationBusy === 'create' ? 'Creating...' : 'Create tournament'}</button>
      </div>
      <div className="mt-6 space-y-3">{operations.length === 0 ? <p className="text-sm text-neutral-600">No operator tournaments yet.</p> : operations.map((item) => <article key={item.tournamentId} className="retro-inset p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">{item.name}</h3><p className="mt-1 text-xs text-neutral-600">{item.state} · {item.entrantCount} entrants · {item.finalizedMatchCount}/{item.matchCount} matches final</p></div><div className="flex flex-wrap gap-2">{item.nextActions.map((action) => <button key={action} type="button" className="metal-button-ghost" disabled={operationBusy !== ''} onClick={() => executeTournament(item, action)} aria-label={`${actionLabel(action)} ${item.name}`}>{operationBusy === `${item.tournamentId}:${action}` ? 'Working...' : actionLabel(action)}</button>)}</div></div>{item.message && <p className="mt-3 text-sm">{item.message}</p>}</article>)}</div>
    </section>}
  </section>;
}

function actionLabel(action: TournamentOperationAction): string { return action.charAt(0) + action.slice(1).toLowerCase(); }
function usdcBaseUnits(value: string): string { if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value) || Number(value) <= 0) throw new Error('Stake must be a positive USDC amount with at most 6 decimals.'); const [whole, fraction = ''] = value.split('.'); return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))).toString(); }
