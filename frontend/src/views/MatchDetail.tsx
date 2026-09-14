import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppContext } from '../context';
import { Match, MatchVerdict } from '../adapters/interfaces';
import { ExternalLink } from 'lucide-react';

function isValidAbsoluteUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function MatchDetail() {
  const { id } = useParams<{ id: string }>();
  const { arenaRead, genLayerRead } = useAppContext();
  const [match, setMatch] = useState<Match | null>(null);
  const [verdict, setVerdict] = useState<MatchVerdict | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true); setError('');
    arenaRead.getMatch(id).then(async (m) => {
      if (!active) return;
      setMatch(m);
      if (m && m.state === 'FINALIZED') setVerdict(await genLayerRead.getMatchVerdict(m.id));
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load match.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, arenaRead, genLayerRead, reload]);

  if (loading) {
    return <div className="animate-pulse space-y-4 max-w-3xl mx-auto">
      <div className="h-8 bg-muted rounded w-1/4 mb-8"></div>
      <div className="h-40 bg-card rounded"></div>
      <div className="h-64 bg-card rounded"></div>
    </div>;
  }

  if (error) return <div role="alert" className="glass-panel mx-auto max-w-3xl rounded-[28px] p-8"><p className="text-lg">{error}</p><button className="metal-button-ghost mt-5" onClick={() => setReload((value) => value + 1)}>Retry</button></div>;

  if (!match) {
    return (
      <div className="text-center p-8 bg-card border border-border rounded-lg max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold mb-2">Match not found</h2>
        <Link to="/" className="text-accent hover:underline">Return Home</Link>
      </div>
    );
  }

  const validExplorerUrl = isValidAbsoluteUrl(verdict?.explorerUrl) ? verdict?.explorerUrl : null;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <Link to={`/tournaments/${match.tournamentId}`} className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 mb-4 w-fit focus:outline-none focus:ring-2 focus:ring-ring rounded">
          &larr; Back to Tournament
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="page-title">Match Details</h1>
          <span className={`retro-chip px-3 py-1 text-xs font-bold ${
            match.state === 'FINALIZED' ? 'border-accent text-accent bg-accent/10' :
            match.state === 'FAILED' || match.state === 'RETRY' || match.state === 'RETRYABLE' ? 'border-destructive text-destructive bg-destructive/10' :
            'border-border text-muted-foreground bg-muted'
          }`}>
            {match.state}
          </span>
        </div>
      </div>

      <div className="glass-panel flex items-center justify-between rounded-[28px] p-6 md:p-8">
        <div className={`retro-inset flex-1 p-4 text-center ${match.winner === match.agentA ? 'text-accent' : ''}`}>
          <div className="font-mono font-bold text-lg">{match.agentA}</div>
          {match.winner === match.agentA && <div className="text-xs text-accent mt-2 font-bold uppercase tracking-widest">Winner</div>}
        </div>
        <div className="px-6 font-serif italic text-muted-foreground">VS</div>
        <div className={`retro-inset flex-1 p-4 text-center ${match.winner === match.agentB ? 'text-accent' : ''}`}>
          <div className="font-mono font-bold text-lg">{match.agentB}</div>
          {match.winner === match.agentB && <div className="text-xs text-accent mt-2 font-bold uppercase tracking-widest">Winner</div>}
        </div>
      </div>

      {verdict && (
        <div className="space-y-6">
          <div className="glass-panel rounded-[28px] p-6 md:p-8">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Semantic judgment</p>
                <h2 className="text-2xl font-bold">{verdict.source === 'LIVE' ? 'Verified GenLayer verdict' : 'Preview Verdict'}</h2>
              </div>
              {verdict.source === 'LIVE' && <span className="retro-chip border-accent bg-accent/10 px-3 py-2 text-xs font-bold text-accent">LIVE TESTNET EVIDENCE</span>}
            </div>

            {verdict.topic && (
              <div className="retro-inset mb-6 p-4 md:p-5">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Random match topic</p>
                <p className="text-base leading-relaxed">{verdict.topic}</p>
              </div>
            )}

            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <DetailFact label="Rubric" value={verdict.rubricVersion} />
              <DetailFact label="Attempt" value={verdict.attempt ? `#${verdict.attempt}` : undefined} />
              <DetailFact label="Finality" value={verdict.finality} />
              <DetailFact label="Execution" value={verdict.execution} />
            </div>

            {(verdict.scoreA !== undefined || verdict.scoreB !== undefined) && (
              <div className="mb-6 grid gap-3 sm:grid-cols-2">
                <ScoreCard label={match.agentA} score={verdict.scoreA} winner={verdict.winner === 'A'} />
                <ScoreCard label={match.agentB} score={verdict.scoreB} winner={verdict.winner === 'B'} />
              </div>
            )}

            <div className="mb-7">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Final summary</h3>
              <p className="leading-relaxed text-foreground/90">{verdict.summary}</p>
            </div>

            {verdict.criteria?.length ? (
              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Criterion reasoning</h3>
                <div className="divide-y divide-border border-y border-border">
                  {verdict.criteria.map((criterion) => (
                    <div key={criterion.id} className="grid gap-2 py-4 md:grid-cols-[180px_70px_1fr] md:items-start">
                      <p className="font-semibold">{criterion.label}</p>
                      <span className="retro-chip w-fit px-2 py-1 text-[11px] font-bold">{criterion.winner === 'TIE' ? 'TIE' : `${criterion.winner} WINS`}</span>
                      <p className="text-sm leading-relaxed text-muted-foreground">{criterion.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <ul className="space-y-2">
                {verdict.reasons.map((reason, index) => <li key={index} className="text-sm leading-relaxed">{reason}</li>)}
              </ul>
            )}
          </div>

          {verdict.source === 'LIVE' && (
            <div className="glass-panel rounded-[28px] p-6 md:p-8">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Proof trail</p>
                  <h2 className="text-xl font-bold">Live lifecycle receipts</h2>
                </div>
                <span className="retro-chip px-3 py-2 text-xs font-bold">{verdict.network}{verdict.chainId ? ` · ${verdict.chainId}` : ''}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <DetailFact label="GenLayer transaction" value={verdict.transactionHash} mono />
                <DetailFact label="Judge contract" value={verdict.judgeAddress} mono />
                <DetailFact label="Canonical match ID" value={verdict.canonicalMatchId} mono />
                <DetailFact label="Attempt ID" value={verdict.attemptId} mono />
                <DetailFact label="Safety class" value={verdict.safetyClass} mono />
                <DetailFact label="Arc terminal state" value={verdict.arcState} />
                <DetailFact label="Arc tournament" value={verdict.arcTournamentId} mono />
                <DetailFact label="Arc escrow" value={verdict.arcEscrowAddress} mono />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <DetailFact label="Gross pool" value={verdict.grossPoolUsdc ? `${verdict.grossPoolUsdc} USDC` : undefined} />
                <DetailFact label="Net payout" value={verdict.netPayoutUsdc ? `${verdict.netPayoutUsdc} USDC` : undefined} />
                <DetailFact label="Platform fee" value={verdict.platformFeeUsdc ? `${verdict.platformFeeUsdc} USDC` : undefined} />
              </div>
              <p className="mt-5 text-xs leading-relaxed text-muted-foreground">Participant names are display aliases for the hashed entrants used in the live run. Raw model outputs and secrets were not retained in public evidence; the canonical IDs, verdict, bounded reasons and transaction hashes were retained.</p>
            </div>
          )}

          {validExplorerUrl && (
            <div className="flex justify-end">
              <a href={validExplorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring rounded px-2 py-1">
                View on GenLayer Explorer <ExternalLink size={14} />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailFact({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="retro-inset min-w-0 p-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`${mono ? 'font-mono text-xs break-all' : 'text-sm font-semibold'} leading-relaxed`}>{value || '—'}</p>
    </div>
  );
}

function ScoreCard({ label, score, winner }: { label: string; score?: number; winner: boolean }) {
  return (
    <div className={`retro-inset flex items-end justify-between gap-3 p-4 ${winner ? 'border-accent bg-accent/5' : ''}`}>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-sm font-bold">{winner ? 'MATCH WINNER' : 'FINAL SCORE'}</p>
      </div>
      <p className="font-mono text-4xl font-bold tabular-nums">{score ?? '—'}</p>
    </div>
  );
}
