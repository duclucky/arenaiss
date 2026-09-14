import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import type { EvaluationCampaign, EvaluationRun } from '../adapters/interfaces';
import { useAppContext } from '../context';

export function EvaluationDetail() {
  const { id } = useParams<{ id: string }>(); const { evaluationApi } = useAppContext();
  const [campaign, setCampaign] = useState<EvaluationCampaign | null>(null); const [runs, setRuns] = useState<EvaluationRun[]>([]); const [error, setError] = useState('');
  useEffect(() => { if (!id || !evaluationApi) return; Promise.all([evaluationApi.getCampaign(id), evaluationApi.listRuns()]).then(([nextCampaign, allRuns]) => { setCampaign(nextCampaign); setRuns(allRuns.filter((run) => nextCampaign?.items.some((item) => item.runIds.includes(run.runId)))); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load evaluation.')); }, [id, evaluationApi]);
  if (error) return <div role="alert" className="glass-panel mx-auto max-w-5xl p-8">{error}</div>;
  if (!campaign) return <div role="status" className="glass-panel mx-auto max-w-5xl p-8">Loading evaluation…</div>;
  return <section className="mx-auto max-w-5xl space-y-8">
    <Link to="/evaluations" className="inline-flex min-h-11 items-center text-sm underline">← All evaluations</Link>
    <header><p className="page-kicker">SOLO campaign</p><h1 className="page-title">Results</h1><p className="mt-4 break-all font-mono text-xs">{campaign.campaignId}</p></header>
    <div className="glass-panel p-6"><div className="grid gap-3 sm:grid-cols-3"><Fact label="State" value={campaign.state}/><Fact label="Test Pack" value={`${campaign.packId} · ${campaign.packVersion}`}/><Fact label="Agent version" value={campaign.agentVersionId}/></div></div>
    <section aria-labelledby="results-heading"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="page-kicker">Final report</p><h2 id="results-heading" className="text-2xl font-bold">Scenario outcomes</h2></div><p className="flex items-center gap-2 text-xs text-neutral-600"><LockKeyhole size={15} aria-hidden="true" /> Prompts and hidden context remain private</p></div>
      <div className="glass-panel overflow-x-auto"><table aria-label="Evaluation results" className="w-full min-w-[720px] border-collapse text-left text-sm"><thead className="border-b border-black bg-black/5 text-xs uppercase tracking-wider"><tr><th className="p-4">Test</th><th className="p-4">Status</th><th className="p-4">Attempt</th><th className="p-4">Result</th><th className="p-4">Score</th><th className="p-4">Evidence</th></tr></thead><tbody>{campaign.items.map((item, index) => <tr key={item.scenarioId} className="border-b border-black/15 last:border-0"><td className="p-4 font-semibold">Test {String(index + 1).padStart(2, '0')}</td><td className="p-4 font-mono text-xs">{item.state}</td><td className="p-4">{item.attempt}</td><td className="p-4 font-semibold">{item.score ?? 'Pending'}</td><td className="p-4">{item.overallScore === undefined ? '—' : `${item.overallScore}/100`}</td><td className="p-4">{item.runIds.length === 0 ? '—' : <div className="flex flex-col gap-2">{item.runIds.map((runId) => <Link className="font-mono text-xs underline" key={runId} to={`/evaluation-runs/${runId}`} aria-label={`Open run ${runId}`}>{runId}</Link>)}</div>}</td></tr>)}</tbody></table></div>
    </section>
    <p className="text-xs leading-relaxed text-neutral-600">{runs.length} public run record{runs.length === 1 ? '' : 's'} available. Public records omit prompts, raw provider bytes and private semantic reasons.</p>
  </section>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div className="retro-inset p-3"><p className="text-[10px] uppercase tracking-wider">{label}</p><p className="mt-1 break-all font-mono text-xs">{value}</p></div>; }
