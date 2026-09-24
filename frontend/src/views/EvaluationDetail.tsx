import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, LockKeyhole } from 'lucide-react';
import type { EvaluationApiAdapter, EvaluationCampaign, EvaluationRun } from '../adapters/interfaces';
import { useAppContext } from '../context';
import { displayLabel } from '../display-label';

export function EvaluationDetail() {
  const { id } = useParams<{ id: string }>(); const { evaluationApi } = useAppContext();
  const [campaign, setCampaign] = useState<EvaluationCampaign | null>(null); const [runs, setRuns] = useState<EvaluationRun[]>([]); const [fee, setFee] = useState<Awaited<ReturnType<NonNullable<EvaluationApiAdapter['getFee']>>> | null>(null); const [feeLoaded, setFeeLoaded] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    if (!id || !evaluationApi) return;
    let active = true;
    let timer: number | undefined;
    setCampaign(null); setRuns([]); setFee(null); setFeeLoaded(false); setError('');
    const refresh = async () => {
      let pollAgain = true;
      try {
        const [nextCampaign, allRuns, nextFee] = await Promise.all([evaluationApi.getCampaign(id), evaluationApi.listRuns(), evaluationApi.getFee?.(id) ?? Promise.resolve(null)]);
        if (!active) return;
        if (!nextCampaign) { setError('Evaluation not found.'); pollAgain = false; return; }
        setCampaign(nextCampaign); setFee(nextFee); setFeeLoaded(Boolean(evaluationApi.getFee));
        setRuns(allRuns.filter((run) => nextCampaign.items.some((item) => item.runIds.includes(run.runId))));
        setError('');
        pollAgain = !['FINALIZED', 'FAILED', 'PAYMENT_FAILED'].includes(nextCampaign.state) || Boolean(nextFee && !['RELEASED', 'REFUNDED', 'PAYMENT_FAILED'].includes(nextFee.state));
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load evaluation.');
      } finally {
        if (active && pollAgain) timer = window.setTimeout(refresh, 5_000);
      }
    };
    void refresh();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [id, evaluationApi]);
  if (error) return <div role="alert" className="glass-panel mx-auto max-w-5xl p-8">{displayLabel(error)}</div>;
  if (!campaign) return <div role="status" className="glass-panel mx-auto max-w-5xl p-8">Loading evaluation…</div>;
  const isReconciling = campaign.items.some((item) => item.failureCode === 'GENLAYER_RECONCILING');
  const hasHardFailedScore = campaign.items.some((item) => item.score === 'FAIL' && item.overallScore === 0);
  return <section className="mx-auto max-w-5xl space-y-8">
    <Link to="/evaluations" className="inline-flex min-h-11 items-center text-sm underline">← All evaluations</Link>
    <header><p className="page-kicker">SOLO campaign</p><h1 className="page-title">Results</h1></header>
    <div className="glass-panel p-6"><div className="grid gap-3 sm:grid-cols-3"><Fact label="State" value={displayLabel(campaign.state)}/><Fact label="Test Pack" value={`Pack ${campaign.packVersion}`}/><Fact label="Agent version" value="Version locked"/></div></div>
    <section aria-labelledby="results-heading"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="page-kicker">Final report</p><h2 id="results-heading" className="text-2xl font-bold">Scenario outcomes</h2></div><p className="flex items-center gap-2 text-xs text-neutral-600"><LockKeyhole size={15} aria-hidden="true" /> Prompts and hidden context remain private</p></div>
          <p className="mb-3 border-l-2 border-black pl-4 text-sm leading-relaxed text-neutral-700"><strong>Agent runtime</strong> generates each response using the model shown below. <strong>GenLayer GenVM validators</strong> independently judge the submitted evidence and produce the result and score.</p>
          <div className="glass-panel overflow-x-auto"><table aria-label="Evaluation results" className="w-full min-w-[980px] border-collapse text-left text-sm"><thead className="border-b border-black bg-black/5 text-xs uppercase tracking-wider"><tr><th className="p-4">Scenario</th><th className="p-4">Status</th><th className="p-4">Attempt</th><th className="p-4">Agent runtime</th><th className="p-4">Judge</th><th className="p-4">Result</th><th className="p-4">Score</th><th className="p-4">Run details</th></tr></thead><tbody>{campaign.items.map((item, index) => <tr key={item.scenarioId} className="border-b border-black/15 last:border-0"><td className="p-4 font-semibold">Scenario {String(index + 1).padStart(2, '0')}</td><td className="p-4 font-mono text-xs">{displayLabel(item.state)}</td><td className="p-4">{item.attempt}</td><td className="p-4 text-xs">{item.providerModel ? <><strong>{item.providerRoute === 'FALLBACK' ? 'Fallback' : 'Primary'}</strong><span className="block break-all">{item.providerModel}</span></> : item.state === 'FAILED' ? 'Not recorded' : 'Pending'}</td><td className="p-4 text-xs"><strong>GenLayer GenVM</strong><span className="block">{genVmStatus(item)}</span></td><td className="p-4 font-semibold">{evaluationResult(item)}</td><td className="p-4">{item.overallScore === undefined ? 'N/A' : `${item.overallScore}/100`}</td><td className="p-4">{item.runIds.length === 0 ? 'N/A' : <div className="flex flex-col gap-2">{item.runIds.map((runId, attemptIndex) => <Link className="text-sm underline" key={runId} to={`/evaluation-runs/${runId}?evaluation=${encodeURIComponent(campaign.campaignId)}`} aria-label={`Open attempt ${attemptIndex + 1}`}>Attempt {attemptIndex + 1}</Link>)}</div>}</td></tr>)}</tbody></table></div>
    </section>
    {isReconciling && <p role="status" className="glass-panel p-4 text-sm text-amber-900"><strong>Arena is reconciling the submission automatically.</strong> GenLayer may have accepted the transaction even though its response was interrupted. The worker checks the canonical result before any bounded retry.</p>}
    {campaign.state === 'PAYMENT_FAILED' && <p role="status" className="glass-panel p-4 text-sm text-amber-900"><strong>Evaluation did not start.</strong> The fee payment could not be confirmed. Check your Arc Testnet USDC balance and payment history before trying again.</p>}
    {campaign.state === 'RECOVERY_REQUIRED' && <p role="status" className="glass-panel p-4 text-sm text-amber-900"><strong>GenLayer submission needs reconciliation.</strong> Its transaction result is unknown, so this campaign has no final score. The evaluation fee remains in escrow until the transaction is resolved or the onchain timeout refund becomes available.</p>}
    {hasHardFailedScore && <p role="status" className="border-l-2 border-black pl-4 text-sm leading-relaxed"><strong>A critical policy, safety, or rule failure sets the effective score to 0.</strong> Dimension grades remain available in the run details for audit.</p>}
    {fee?.state === 'REFUNDED' && <div role="status" className="glass-panel flex flex-wrap items-center justify-between gap-3 p-4"><p><strong>{fee.amountUsdc} USDC refunded</strong> to the payer from evaluation escrow.</p>{fee.settlement?.txHash && <a className="font-semibold underline" href={`${networkExplorer(fee.escrowAddress, fee.settlement.txHash)}`} target="_blank" rel="noreferrer">View Arc refund receipt <ExternalLink className="inline" size={14} /></a>}</div>}
    {feeLoaded && fee === null && <p className="glass-panel p-4 text-sm text-neutral-700">Legacy campaign, no evaluation escrow record.</p>}
    <p className="text-xs leading-relaxed text-neutral-600">{runs.length} public run record{runs.length === 1 ? '' : 's'} available. Public records omit prompts, raw runtime output and private semantic reasons.</p>
  </section>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div className="retro-inset p-3"><p className="text-[10px] uppercase tracking-wider">{label}</p><p className="mt-1 break-all font-mono text-xs">{value}</p></div>; }
function networkExplorer(_escrow: string, hash: string) { return `https://testnet.arcscan.app/tx/${hash}`; }
function evaluationResult(item: EvaluationCampaign['items'][number]): string {
  if (item.score) return item.score;
  if (item.state === 'PENDING') return 'Not run';
  if (item.state === 'RETRYABLE') return item.failureCode === 'PROVIDER_TIMEOUT' ? 'Retrying after timeout' : 'Retrying provider';
  if (item.state === 'FAILED') {
    if (item.failureCode === 'PROVIDER_TIMEOUT') return 'Provider timed out';
    if (item.failureCode === 'EMPTY_OUTPUT') return 'Provider returned no output';
    return item.failureStage === 'PROVIDER' ? 'Provider failed' : 'Infrastructure failure';
  }
  if (item.state === 'RECOVERY_REQUIRED') return 'Needs reconciliation';
  if (item.state === 'FINALIZED') return 'Score unavailable';
  return 'Processing';
}
function genVmStatus(item: EvaluationCampaign['items'][number]): string {
  if (item.state === 'FINALIZED') return 'Verdict finalized';
  if (item.state === 'JUDGING') return 'Judging';
  if (item.state === 'RECOVERY_REQUIRED' || item.failureCode === 'GENLAYER_RECONCILING') return 'Reconciling';
  if (item.failureStage === 'GENLAYER_SUBMIT' || item.failureStage === 'GENLAYER_FINALITY') return 'Submission failed';
  return 'Not submitted';
}
