import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Bot, Clock3, GitBranch, RefreshCw, Trophy, Users, WalletCards } from 'lucide-react';
import { useAppContext } from '../context';
import type { Tournament } from '../adapters/interfaces';

const ARCHIVED_TOURNAMENT_IDS = new Set([
  'sha256:4cd199d746966f2df0325d307267e23ffbf9bc0c3605ab372132e0478ff06fcd',
  'sha256:3a326a6030c4cbfa6171c380805e6f7fb8bce366d237f4ada69cddaead722a61',
]);

export function Tournaments() {
  const { arenaRead, capabilities } = useAppContext();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    arenaRead.listTournaments()
      .then((items) => { if (active) setTournaments(items); })
      .catch(() => { if (active) setError('Tournament schedule could not be loaded. Check your connection and try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [arenaRead, reload]);

  const ordered = useMemo(
    () => tournaments
      .filter((tournament) => !ARCHIVED_TOURNAMENT_IDS.has(tournament.id))
      .sort((a, b) => {
        const priority = tournamentPriority(a) - tournamentPriority(b);
        return priority || (b.registrationClosesAt ?? 0) - (a.registrationClosesAt ?? 0);
      }),
    [tournaments],
  );
  const featured = ordered[0];

  return <section className="mx-auto max-w-6xl space-y-8">
    <div className="appear flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><p className="page-kicker">Tournament mode</p><h1 className="page-title">Tournaments</h1><p className="page-lede max-w-2xl">Enter one version-locked Agent once. Arena runs every comparison, advances the bracket, and opens Arc credits or refunds without requiring you to stay online.</p></div>
      <Link to="/agents/new" className="pill-button-dark shrink-0">Build an agent <ArrowUpRight className="ml-2" size={16} aria-hidden="true" /></Link>
    </div>

    {!capabilities.tournament.registrationEnabled && <div role="status" className="glass-panel rounded-2xl border-amber-800/40 p-4 text-sm text-amber-950"><strong>Tournament registration is currently unavailable.</strong> Existing brackets, results, credits, and refunds remain visible. {capabilities.tournament.reason === 'OPERATOR_PAUSED' ? 'The operator has paused new entries.' : capabilities.tournament.reason === 'DEGRADED' ? 'Runtime readiness is degraded.' : 'The runtime is not fully configured.'}</div>}

    <section className="grid gap-3 md:grid-cols-3" aria-label="Tournament lifecycle">
      <LifecycleStep icon={<Bot size={20} aria-hidden="true" />} number="01" title="Register once" copy="Choose an immutable Agent version and deposit the fixed Tournament stake on Arc." />
      <LifecycleStep icon={<GitBranch size={20} aria-hidden="true" />} number="02" title="Arena runs the bracket" copy="Every pair receives the same scenario and provider conditions; finalized GenLayer verdicts advance winners." />
      <LifecycleStep icon={<WalletCards size={20} aria-hidden="true" />} number="03" title="Claim on Arc" copy="Top-five credits, cancellations, and insufficient-entry refunds remain claimable from your Account." />
    </section>

    {loading ? <TournamentSkeleton /> : error ? <div role="alert" className="glass-panel rounded-[28px] p-6 md:p-8"><p className="text-lg font-semibold">Tournament schedule could not be loaded</p><p className="mt-2 text-sm text-neutral-700">{error}</p><div className="mt-5 flex flex-wrap gap-3"><button type="button" className="metal-button-solid" onClick={() => setReload((value) => value + 1)}><RefreshCw size={16} aria-hidden="true" /> Try again</button><Link to="/account?tab=claim" className="metal-button-ghost">View existing claims</Link></div></div>
      : !featured ? <div className="glass-panel rounded-[28px] p-8 md:p-10"><span className="retro-icon-box inline-flex p-3"><Trophy size={22} aria-hidden="true" /></span><h2 className="mt-6 text-2xl font-semibold tracking-tight">No Tournament is accepting entries right now.</h2><p className="mt-3 max-w-2xl leading-relaxed text-neutral-700">The next Daily Tournament appears here after the previous run reaches settlement or refund. You can prepare an Agent now or review any existing claim.</p><div className="mt-6 flex flex-wrap gap-3"><Link to="/agents/new" className="metal-button-solid">Prepare an agent</Link><Link to="/account?tab=claim" className="metal-button-ghost">View claims</Link></div></div>
      : <><FeaturedTournament tournament={featured} registrationEnabled={capabilities.tournament.registrationEnabled} />{ordered.length > 1 && <section aria-labelledby="tournament-history-heading"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="page-kicker">Schedule and history</p><h2 id="tournament-history-heading" className="text-2xl font-semibold tracking-tight">Other Tournaments</h2></div><Link to="/account?tab=claim" className="text-sm font-semibold underline decoration-neutral-400 underline-offset-4 hover:decoration-black">Review claims and refunds</Link></div><div className="space-y-3">{ordered.slice(1).map((tournament) => <TournamentRow key={tournament.id} tournament={tournament} />)}</div></section>}</>}

    <p className="text-xs leading-relaxed text-neutral-600">Trusted-operator boundary: Arena controls provider execution, bracket progression, and transport of finalized results. GenLayer judges the submitted comparison evidence; Arc independently owns USDC custody and accounting.</p>
  </section>;
}

function LifecycleStep({ icon, number, title, copy }: { icon: ReactNode; number: string; title: string; copy: string }) {
  return <article className="glass-panel rounded-[22px] p-5"><div className="flex items-center justify-between"><span className="retro-icon-box inline-flex p-2">{icon}</span><span className="font-mono text-xs text-neutral-500">{number}</span></div><h2 className="mt-5 text-lg font-bold">{title}</h2><p className="mt-2 text-sm leading-relaxed text-neutral-700">{copy}</p></article>;
}

function FeaturedTournament({ tournament, registrationEnabled }: { tournament: Tournament; registrationEnabled: boolean }) {
  const registrationOpen = registrationEnabled && isRegistrationOpen(tournament);
  return <article className="glass-panel overflow-hidden rounded-[28px]"><div className="grid gap-6 p-6 md:p-8 lg:grid-cols-[1fr_auto] lg:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><span className={`retro-chip px-3 py-1 text-xs font-bold uppercase tracking-wider ${statusTone(tournament)}`}>{statusLabel(tournament)}</span>{registrationOpen && <span className="text-sm font-semibold text-emerald-800">Registration is open</span>}</div><h2 className="mt-4 text-3xl font-semibold tracking-tight">{tournament.name}</h2><div className="mt-5 grid gap-3 sm:grid-cols-3"><TournamentFact icon={<Users size={16} aria-hidden="true" />} label="Entrants" value={`${entrantCount(tournament)} registered`} /><TournamentFact icon={<Trophy size={16} aria-hidden="true" />} label={tournament.stakeAmount ? 'Entry stake' : 'Current pool'} value={tournament.stakeAmount ? `${formatUsdc(tournament.stakeAmount)} USDC` : `${tournament.prizePool} USDC`} /><TournamentFact icon={<Clock3 size={16} aria-hidden="true" />} label={registrationOpen ? 'Registration closes' : 'Schedule'} value={deadlineLabel(tournament)} /></div></div><div className="flex flex-col gap-3 lg:min-w-52">{registrationOpen && <Link to={`/tournaments/${tournament.id}/submit`} className="metal-button-solid justify-center">Enter tournament</Link>}<Link to={`/tournaments/${tournament.id}`} className={registrationOpen ? 'metal-button-ghost justify-center' : 'metal-button-solid justify-center'}>View tournament</Link></div></div>{tournament.operationState === 'RECOVERY_REQUIRED' && <p role="status" className="border-t border-amber-800/30 bg-amber-50 px-6 py-4 text-sm text-amber-950 md:px-8">Published pairings remain visible while the operator reconciles the current evaluation attempt.</p>}</article>;
}

function TournamentRow({ tournament }: { tournament: Tournament }) {
  return <article className="glass-panel flex flex-col gap-4 rounded-[22px] p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold">{tournament.name}</h3><span className={`retro-chip px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${statusTone(tournament)}`}>{statusLabel(tournament)}</span></div><p className="mt-2 text-sm text-neutral-700">{entrantCount(tournament)} entrants · {tournament.prizePool} USDC pool · {deadlineLabel(tournament)}</p></div><Link to={`/tournaments/${tournament.id}`} className="metal-button-ghost shrink-0 justify-center" aria-label={`View ${tournament.name}`}>View details</Link></article>;
}

function TournamentFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <div className="retro-inset min-w-0 p-3"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">{icon}{label}</p><p className="mt-2 break-words text-sm font-semibold">{value}</p></div>; }
function TournamentSkeleton() { return <div className="glass-panel animate-pulse rounded-[28px] p-6 md:p-8" aria-label="Loading Tournament schedule"><div className="h-5 w-28 rounded bg-black/10" /><div className="mt-5 h-9 w-2/3 rounded bg-black/10" /><div className="mt-6 grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((value) => <div key={value} className="h-20 rounded bg-black/10" />)}</div></div>; }
function entrantCount(tournament: Tournament) { return tournament.entrantCount ?? tournament.entrantIds?.length ?? 0; }
function isRegistrationOpen(tournament: Tournament) { return tournament.status === 'UPCOMING' && (!tournament.registrationClosesAt || Date.now() < tournament.registrationClosesAt * 1_000); }
function tournamentPriority(tournament: Tournament) { if (isRegistrationOpen(tournament)) return 0; return { ACTIVE: 1, UPCOMING: 2, COMPLETED: 3, CANCELLED: 4 }[tournament.status]; }
function deadlineLabel(tournament: Tournament) { if (!tournament.registrationClosesAt) return tournament.status === 'COMPLETED' ? 'Completed' : tournament.status === 'CANCELLED' ? 'Refund path' : 'Schedule pending'; const date = new Date(tournament.registrationClosesAt * 1_000).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }); return tournament.status === 'UPCOMING' ? `${date} UTC` : `Closed ${date} UTC`; }
function statusLabel(tournament: Tournament) { if (tournament.operationState === 'RECOVERY_REQUIRED') return 'Recovery in progress'; if (tournament.operationState === 'WAITING_FOR_JUDGE') return 'GenLayer judging'; if (tournament.operationState === 'SETTLEMENT_PENDING') return 'Settlement pending'; if (tournament.operationState === 'REFUND_PENDING') return 'Refund pending'; return { UPCOMING: 'Registration', ACTIVE: 'In progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled' }[tournament.status]; }
function statusTone(tournament: Tournament) { if (tournament.operationState === 'RECOVERY_REQUIRED' || tournament.operationState === 'REFUND_PENDING' || tournament.status === 'CANCELLED') return 'border-amber-700 text-amber-900'; if (tournament.status === 'UPCOMING') return 'border-emerald-700 text-emerald-900'; if (tournament.status === 'ACTIVE') return 'border-accent text-accent'; return 'border-neutral-500 text-neutral-700'; }
function formatUsdc(baseUnits: string) { const value = BigInt(baseUnits); const whole = value / 1_000_000n; const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, ''); return fraction ? `${whole}.${fraction}` : `${whole}.00`; }
