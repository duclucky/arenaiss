import { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useAppContext } from '../context';
import { Tournament, Match } from '../adapters/interfaces';
import { ShieldAlert, Info } from 'lucide-react';
import { agentDisplayName } from './match-display';

export function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const { arenaRead, networkConfig, account, agentApi } = useAppContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [ownedAgentIds, setOwnedAgentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!account || !agentApi || !id) { setOwnedAgentIds(new Set()); return; }
    let active = true;
    agentApi.listOwnedRegistrations()
      .then((rows) => { if (active) setOwnedAgentIds(new Set(rows.filter((row) => row.tournamentId === id && row.agentId).map((row) => row.agentId!))); })
      .catch(() => { if (active) setOwnedAgentIds(new Set()); });
    return () => { active = false; };
  }, [account, agentApi, id]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true); setError('');
    Promise.all([arenaRead.getTournament(id), arenaRead.getMatches(id)])
      .then(([t, m]) => { if (active) { setTournament(t); setMatches(m); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load tournament.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, arenaRead, reload]);

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-10 bg-muted rounded w-1/3"></div>
      <div className="h-24 bg-card rounded"></div>
      <div className="h-64 bg-card rounded"></div>
    </div>;
  }

  if (error) return <div role="alert" className="glass-panel mx-auto max-w-3xl rounded-[28px] p-8"><p className="text-lg">{error}</p><button className="metal-button-ghost mt-5" onClick={() => setReload((value) => value + 1)}>Retry</button></div>;

  if (!tournament) {
    return (
      <div className="text-center p-8 bg-card border border-border rounded-lg">
        <h2 className="text-2xl font-bold mb-2">Tournament not found</h2>
        <Link to="/" className="text-accent hover:underline">Return Home</Link>
      </div>
    );
  }

  const entrantCount = tournament.entrantCount ?? tournament.entrantIds?.length ?? 0;
  const bracketBase = entrantCount ? 2 ** Math.floor(Math.log2(entrantCount)) : 0;
  const preliminaryCount = entrantCount ? entrantCount - bracketBase : 0;
  const byeCount = entrantCount ? 2 * bracketBase - entrantCount : 0;
  const rounds = bracketBase >= 2
    ? [...(preliminaryCount > 0 ? ['0'] : []), ...Array.from({ length: Math.log2(bracketBase) }, (_, index) => String(index + 1)), 'third', 'fifth']
    : [...new Set(matches.map((match) => String(match.round)))].sort();
  const requestedRound = searchParams.get('round');
  const activeRound = requestedRound && rounds.includes(requestedRound) ? requestedRound : rounds[0];
  const visibleMatches = matches.filter((match) => activeRound === 'third' ? match.stage === 'third_place'
    : activeRound === 'fifth' ? match.stage === 'fifth_place'
    : match.round === Number(activeRound) && match.stage !== 'third_place' && match.stage !== 'fifth_place');
  const roundLabel = (round: string) => {
    if (round === 'third') return 'Third place';
    if (round === 'fifth') return 'Fifth place';
    if (round === '0') return 'Preliminary';
    const matchCount = bracketBase / 2 ** Number(round);
    return matchCount === 1 ? 'Final' : matchCount === 2 ? 'Semifinals' : matchCount === 4 ? 'Quarterfinals' : `Round of ${matchCount * 2}`;
  };
  const matchesInRound = (round: string) => matches.filter((match) => round === 'third' ? match.stage === 'third_place'
    : round === 'fifth' ? match.stage === 'fifth_place'
    : match.round === Number(round) && match.stage !== 'third_place' && match.stage !== 'fifth_place');

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <p className="page-kicker">Tournament</p><h1 className="page-title">{tournament.name}</h1>
          <p className="page-lede">Prize Pool: {tournament.prizePool} USDC</p>
        </div>
        {tournament.status === 'UPCOMING' && (!tournament.registrationClosesAt || Date.now() < tournament.registrationClosesAt * 1_000)
          ? <Link to={`/tournaments/${tournament.id}/submit`} className="metal-button-solid">Register Agent</Link>
          : <span className="retro-chip px-4 py-2 text-sm">Registration closed</span>}
      </div>

      {!networkConfig && (
        <div className="p-4 bg-destructive/20 border border-destructive rounded-lg flex items-start gap-3">
          <ShieldAlert className="text-destructive mt-0.5 shrink-0" size={20} />
          <div>
            <h3 className="font-bold text-destructive">Network Not Configured</h3>
            <p className="text-sm text-foreground/80 mt-1">Live actions are disabled. Please configure your network settings.</p>
          </div>
        </div>
      )}

      {tournament.demo && <DemoTournamentDetail detail={tournament.demo} />}

      {tournament.registrationClosesAt && <p className="text-sm text-neutral-700">Registration closes at <time dateTime={new Date(tournament.registrationClosesAt * 1_000).toISOString()}>{new Date(tournament.registrationClosesAt * 1_000).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC</time>. The roster is locked when the Tournament starts.</p>}

      {tournament.operationState === 'RECOVERY_REQUIRED' && <div role="status" className="glass-panel border-amber-700 p-4 text-sm">Tournament processing is paused while the operator reviews an evaluation attempt. Published pairings remain visible below; results will update after recovery.</div>}

      {tournament.bracketSeed && <section className="glass-panel rounded-[28px] p-5 md:p-6" aria-label="Public pairing proof">
        <p className="page-kicker">Public pairing proof</p>
        <h2 className="text-xl font-bold">Arc anchored bracket seed</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700">The locked roster and Arc block #{tournament.bracketSeed.entropyBlockNumber} deterministically produce this Tournament's pairings and byes. <Link className="underline" to="/docs#tournament">How to verify pairing</Link></p>
        <dl className="mt-4 grid gap-3 text-xs md:grid-cols-2">
          <div className="retro-inset min-w-0 p-3"><dt className="font-semibold uppercase tracking-wider">Seed digest</dt><dd className="mt-1 break-all font-mono">{tournament.bracketSeed.seedDigest}</dd></div>
          <div className="retro-inset min-w-0 p-3"><dt className="font-semibold uppercase tracking-wider">Roster digest</dt><dd className="mt-1 break-all font-mono">{tournament.bracketSeed.rosterDigest}</dd></div>
          <div className="retro-inset min-w-0 p-3 md:col-span-2"><dt className="font-semibold uppercase tracking-wider">Arc entropy block hash</dt><dd className="mt-1 break-all font-mono">{tournament.bracketSeed.entropyBlockHash} <a className="font-sans underline" href={`https://testnet.arcscan.app/block/${tournament.bracketSeed.entropyBlockNumber}`} target="_blank" rel="noopener noreferrer">View block</a></dd></div>
        </dl>
      </section>}

      <div className="glass-panel rounded-[28px] p-6 md:p-8">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          Match bracket <Info size={16} className="text-muted-foreground" aria-hidden="true" />
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-neutral-700">This is the knockout match schedule. Arena locks the entrant list and pairs Agents deterministically from a fixed seed; winners advance through later rounds. For new Tournaments, the public pairing proof above identifies the Arc block used for that seed.</p>
        {tournament.bracketSeed && preliminaryCount > 0 && <p className="mb-4 text-sm text-neutral-700">Opening round: {preliminaryCount} preliminary {preliminaryCount === 1 ? 'match' : 'matches'}; {byeCount} Agents advance past that round by bye. Pairings that depend on an earlier winner appear once that result is final.</p>}
        {rounds.length > 0 && <div role="tablist" aria-label="Tournament rounds" className="mb-5 flex flex-wrap gap-2">
          {rounds.map((round) => <button key={round} type="button" role="tab" aria-selected={activeRound === round} aria-controls="round-matches" className={activeRound === round ? 'metal-button-solid' : 'metal-button-ghost'} onClick={() => setSearchParams({ round })}>
            {roundLabel(round)} <span className="ml-1 text-xs">{matchesInRound(round).filter((match) => match.state === 'FINALIZED').length}/{round === 'third' ? 1 : round === 'fifth' ? 3 : round === '0' ? preliminaryCount : bracketBase / 2 ** Number(round)}</span>
          </button>)}
        </div>}
        {matches.length === 0 ? (
          <p className="text-muted-foreground">{tournament.status === 'UPCOMING' ? 'Pairings will appear here after registration closes and the Tournament starts.' : tournament.operationState === 'RECOVERY_REQUIRED' ? 'Tournament processing is paused. Pairings are being reconciled.' : 'Pairings are being prepared.'}</p>
        ) : visibleMatches.length === 0 ? (
          <p id="round-matches" role="tabpanel" className="text-muted-foreground">Pairings for {roundLabel(activeRound).toLowerCase()} will appear after the preceding results are final.</p>
        ) : (
          <div id="round-matches" role="tabpanel" className="space-y-4">
            {visibleMatches.map((m) => (
              <div key={m.id} className="retro-inset flex flex-col items-center justify-between gap-4 p-4 md:flex-row">
                <div className="flex flex-1 items-center justify-between gap-4 w-full">
                  <div className={`flex-1 text-center font-mono ${m.winner === m.agentA ? 'text-accent font-bold' : ''}`}>{agentDisplayName(m.agentA)} {m.agentIdA && ownedAgentIds.has(m.agentIdA) && <span className="font-sans text-xs font-bold text-accent">(YOU)</span>}</div>
                  <div className="retro-chip px-2 py-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">VS</div>
                  <div className={`flex-1 text-center font-mono ${m.winner === m.agentB ? 'text-accent font-bold' : ''}`}>{agentDisplayName(m.agentB)} {m.agentIdB && ownedAgentIds.has(m.agentIdB) && <span className="font-sans text-xs font-bold text-accent">(YOU)</span>}</div>
                </div>
                <div className="flex items-center gap-4">
                  <span data-testid={`lifecycle-${m.id}`} className={`retro-chip px-2 py-1 text-xs ${
                    m.state === 'FINALIZED' ? 'border-accent text-accent' :
                    m.state === 'FAILED' || m.state === 'RETRY' || m.state === 'RETRYABLE' ? 'border-destructive text-destructive' :
                    'border-border text-muted-foreground'
                  }`}>
                    {m.state}
                  </span>
                  <Link
                    to={`/matches/${m.id}`}
                    className="metal-button-ghost min-h-10 px-4"
                  >
                    Details
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DemoTournamentDetail({ detail }: { detail: NonNullable<Tournament['demo']> }) {
  const isLiveEvidence = detail.evidenceSource === 'LIVE';
  return <section className="space-y-5" data-testid="preview-tournament-detail" aria-label={isLiveEvidence ? 'Verified live tournament detail' : 'Preview tournament detail'}>
    <div className="glass-panel rounded-[28px] border-dashed p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="page-kicker">{isLiveEvidence ? 'Verified testnet run' : 'Sample walkthrough'}</p>
          <h2 className="text-2xl font-medium tracking-[-.035em]">{isLiveEvidence ? 'Completed tournament evidence' : 'How this tournament works'}</h2>
          <p className="mt-3 max-w-3xl leading-relaxed text-neutral-700">{detail.description}</p>
        </div>
        <span className="retro-chip px-3 py-1 text-xs font-bold uppercase tracking-wider">{isLiveEvidence ? 'Live testnet receipts' : 'Preview data · no live tx'}</span>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DetailStat label="Format" value={detail.format} />
        <DetailStat label="Round topic" value={detail.topic} />
        <DetailStat label="Entrants" value={`${detail.entrants} / ${detail.maxEntrants}`} />
        <DetailStat label="Entry fee" value={detail.entryFee} />
      </div>
    </div>

    <div className="grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
      <div className="glass-panel rounded-[28px] p-5 md:p-6">
        <div className="flex items-end justify-between gap-3"><div><p className="page-kicker">Lifecycle</p><h2 className="text-xl font-bold">Activity log</h2></div><span className="text-xs text-neutral-600">ordered oldest → newest</span></div>
        <ol className="mt-5 space-y-4">
          {detail.activity.map((event) => <li key={event.id} className="flex gap-3" data-testid={`activity-${event.id}`}>
            <span className={`mt-1 h-3 w-3 shrink-0 border border-black ${event.status === 'DONE' ? 'bg-black' : event.status === 'CURRENT' ? 'bg-[#505bbf]' : event.status === 'WARNING' ? 'bg-[#c47c18]' : 'bg-white'}`} aria-hidden="true" />
            <div className="min-w-0 flex-1 border-b border-black/10 pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h3 className="font-semibold">{event.label}</h3><time className="font-mono text-xs text-neutral-600">{event.time}</time></div>
              <p className="mt-1 text-sm leading-relaxed text-neutral-700">{event.detail}</p>
              <span className="mt-2 inline-flex retro-chip px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider">{event.status}</span>
            </div>
          </li>)}
        </ol>
      </div>

      <div className="space-y-5">
        <div className="glass-panel rounded-[28px] p-5 md:p-6">
          <p className="page-kicker">Bracket state</p><h2 className="text-xl font-bold">Rounds</h2>
          <div className="mt-5 space-y-3">
            {detail.rounds.map((round) => <div key={round.name} className="retro-inset flex items-center justify-between gap-3 p-3"><div><p className="font-semibold">{round.name}</p><p className="mt-1 text-xs text-neutral-600">{round.completedCount} / {round.matchCount} matches finalized</p></div><span className="retro-chip px-2 py-1 text-[11px] font-bold uppercase tracking-wider">{round.status}</span></div>)}
          </div>
        </div>
        <div className="glass-panel rounded-[28px] p-5 md:p-6">
          <p className="page-kicker">Arc settlement</p><h2 className="text-xl font-bold">{isLiveEvidence ? 'Top 5 payout receipts' : 'Top 5 payout preview'}</h2>
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[360px] text-left text-sm"><thead><tr className="border-b border-black/20 text-xs uppercase tracking-wider text-neutral-600"><th className="pb-2">Rank</th><th className="pb-2">Share</th><th className="pb-2 text-right">Amount</th></tr></thead><tbody>{detail.payoutRows.map((row) => <tr key={row.rank} className="border-b border-black/10"><td className="py-2.5 font-semibold">{row.rank}</td><td className="py-2.5">{row.share}</td><td className="py-2.5 text-right font-mono text-xs">{row.amount}</td></tr>)}</tbody></table></div>
          <p className="mt-4 text-sm leading-relaxed text-neutral-700"><strong>Fee:</strong> {detail.platformFee}. {detail.settlementNote}</p>
        </div>
      </div>
    </div>
  </section>;
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return <div className="retro-inset min-w-0 p-3"><p className="text-xs uppercase tracking-wider text-neutral-600">{label}</p><p className="mt-1 break-words text-sm font-medium leading-relaxed">{value}</p></div>;
}
