import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, LockKeyhole } from 'lucide-react';
import type { EvaluationApiAdapter, EvaluationCampaign, EvaluationRun } from '../adapters/interfaces';
import { useAppContext } from '../context';

export function EvaluationDetail() {
  const { id } = useParams<{ id: string }>(); const { evaluationApi } = useAppContext();
  const [campaign, setCampaign] = useState<EvaluationCampaign | null>(null); const [runs, setRuns] = useState<EvaluationRun[]>([]); const [fee, setFee] = useState<Awaited<ReturnType<NonNullable<EvaluationApiAdapter['getFee']>>> | null>(null); const [feeLoaded, setFeeLoaded] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (!id || !evaluationApi) return; Promise.all([evaluationApi.getCampaign(id), evaluationApi.listRuns(), evaluationApi.getFee?.(id) ?? Promise.resolve(null)]).then(([nextCampaign, allRuns, nextFee]) => { setCampaign(nextCampaign); setFee(nextFee); setFeeLoaded(Boolean(evaluationApi.getFee)); setRuns(allRuns.filter((run) => nextCampaign?.items.some((item) => item.runIds.includes(run.runId)))); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load evaluation.')); }, [id, evaluationApi]);
  if (error) return <div role="alert" className="glass-panel mx-auto max-w-5xl p-8">{error}</div>;
  if (!campaign) return <div role="status" className="glass-panel mx-auto max-w-5xl p-8">Loading evaluation…</div>;
  const isReconciling = campaign.items.some((item) => item.failureCode === 'GENLAYER_RECONCILING');
  const hasHardFailedScore = campaign.items.some((item) => item.score === 'FAIL' && item.overallScore === 0);
  return <section className="mx-auto max-w-5xl space-y-8">
    <Link to="/evaluations" className="inline-flex min-h-11 items-center text-sm underline">← All evaluations</Link>
    <header><p className="page-kicker">SOLO campaign</p><h1 className="page-title">Results</h1></header>
    <div className="glass-panel p-6"><div className="grid gap-3 sm:grid-cols-3"><Fact label="State" value={campaign.state}/><Fact label="Test Pack" value={`Pack ${campaign.packVersion}`}/><Fact label="Agent version" value="Version locked"/></div></div>
    <section aria-labelledby="results-heading"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="page-kicker">Final report</p><h2 id="results-heading" className="text-2xl font-bold">Scenario outcomes</h2></div><p className="flex items-center gap-2 text-xs text-neutral-600"><LockKeyhole size={15} aria-hidden="true" /> Prompts and hidden context remain private</p></div>
          <div className="glass-panel overflow-x-auto"><table aria-label="Evaluation results" className="w-full min-w-[720px] border-collapse text-left text-sm"><thead className="border-b border-black bg-black/5 text-xs uppercase tracking-wider"><tr><th className="p-4">Scenario</th><th className="p-4">Status</th><th className="p-4">Attempt</th><th className="p-4">Result</th><th className="p-4">Score</th><th className="p-4">Run details</th></tr></thead><tbody>{campaign.items.map((item, index) => <tr key={item.scenarioId} className="border-b border-black/15 last:border-0"><td className="p-4 font-semibold">Scenario {String(index + 1).padStart(2, '0')}</td><td className="p-4 font-mono text-xs">{item.state}</td><td className="p-4">{item.attempt}</td><td className="p-4 font-semibold">{evaluationResult(item)}</td><td className="p-4">{item.overallScore === undefined ? 'N/A' : `${item.overallScore}/100`}</td><td className="p-4">{item.runIds.length === 0 ? 'N/A' : <div className="flex flex-col gap-2">{item.runIds.map((runId, attemptIndex) => <Link className="text-sm underline" key={runId} to={`/evaluation-runs/${runId}`} aria-label={`Open attempt ${attemptIndex + 1}`}>Attempt {attemptIndex + 1}</Link>)}</div>}</td></tr>)}</tbody></table></div>
    </section>
    {isReconciling && <p role="status" className="glass-panel p-4 text-sm text-amber-900"><strong>Arena is reconciling the submission automatically.</strong> GenLayer may have accepted the transaction even though its response was interrupted. The worker checks the canonical result before any bounded retry.</p>}
    {campaign.state === 'RECOVERY_REQUIRED' && <p role="status" className="glass-panel p-4 text-sm text-amber-900"><strong>GenLayer submission needs reconciliation.</strong> Its transaction result is unknown, so this campaign has no final score. The evaluation fee remains in escrow until the transaction is resolved or the onchain timeout refund becomes available.</p>}
    {hasHardFailedScore && <p role="status" className="border-l-2 border-black pl-4 text-sm leading-relaxed"><strong>A critical policy, safety, or rule failure sets the effective score to 0.</strong> Dimension grades remain available in the run details for audit.</p>}
    {fee?.state === 'REFUNDED' && <div role="status" className="glass-panel flex flex-wrap items-center justify-between gap-3 p-4"><p><strong>{fee.amountUsdc} USDC refunded</strong> to the payer from evaluation escrow.</p>{fee.settlement?.txHash && <a className="font-semibold underline" href={`${networkExplorer(fee.escrowAddress, fee.settlement.txHash)}`} target="_blank" rel="noreferrer">View Arc refund receipt <ExternalLink className="inline" size={14} /></a>}</div>}
    {feeLoaded && fee === null && <p className="glass-panel p-4 text-sm text-neutral-700">Legacy campaign, no evaluation escrow record.</p>}
    <p className="text-xs leading-relaxed text-neutral-600">{runs.length} public run record{runs.length === 1 ? '' : 's'} available. Public records omit prompts, raw provider bytes and private semantic reasons.</p>
  </section>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div className="retro-inset p-3"><p className="text-[10px] uppercase tracking-wider">{label}</p><p className="mt-1 break-all font-mono text-xs">{value}</p></div>; }
function networkExplorer(_escrow: string, hash: string) { return `https://testnet.arcscan.app/tx/${hash}`; }
function evaluationResult(item: EvaluationCampaign['items'][number]): string {
  if (item.score) return item.score;
  if (item.state === 'PENDING') return 'Not run';
  if (item.state === 'FAILED') {
    if (item.failureCode === 'PROVIDER_TIMEOUT') return 'Provider timed out';
    if (item.failureCode === 'EMPTY_OUTPUT') return 'Provider returned no output';
    return item.failureStage === 'PROVIDER' ? 'Provider failed' : 'Infrastructure failure';
  }
  if (item.state === 'RECOVERY_REQUIRED') return 'Needs reconciliation';
  if (item.state === 'FINALIZED') return 'Score unavailable';
  return 'Processing';
}
