import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { EvaluationRun } from '../adapters/interfaces';
import { useAppContext } from '../context';

export function EvaluationRunDetail() {
  const { id } = useParams<{ id: string }>(); const { evaluationApi, networkConfig } = useAppContext();
  const [run, setRun] = useState<EvaluationRun | null>(null); const [error, setError] = useState('');
  useEffect(() => { if (id && evaluationApi) evaluationApi.getRun(id).then(setRun).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load run.')); }, [id, evaluationApi]);
  if (error) return <div role="alert" className="glass-panel mx-auto max-w-4xl p-8">{error}</div>;
  if (!run) return <div role="status" className="glass-panel mx-auto max-w-4xl p-8">Loading run…</div>;
  const receiptUrl = run.judge.transactionHash && networkConfig?.genLayer?.explorerUrl ? `${networkConfig.genLayer.explorerUrl.replace(/\/$/, '')}/transactions/${run.judge.transactionHash}` : null;
  return <section className="mx-auto max-w-4xl space-y-8">
    <Link to="/evaluations" className="inline-flex min-h-11 items-center text-sm underline">← Evaluations</Link>
    <header><p className="page-kicker">Public run record</p><h1 className="page-title">Test result</h1></header>
    <div className="glass-panel p-6"><div className="grid gap-3 sm:grid-cols-2"><Fact label="Provider" value={run.provider.state}/><Fact label="GenLayer finality" value={run.judge.state}/><Fact label="Mode" value={run.mode}/><Fact label="Rubric" value={run.rubricVersion}/></div>{receiptUrl && <a className="metal-button-ghost mt-5 w-full gap-2 sm:w-auto" href={receiptUrl} target="_blank" rel="noreferrer">View Studio Next transaction <ExternalLink size={15} aria-hidden="true" /></a>}</div>
    {run.scorecard ? <section className="glass-panel p-6" aria-labelledby="scorecard-heading"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="page-kicker">Verdict</p><h2 id="scorecard-heading" className="text-2xl font-bold">{run.scorecard.resultClass}</h2></div><p className="font-mono text-4xl">{run.scorecard.overallScore}<span className="text-lg text-neutral-600">/100</span></p></div><div className="mt-6 overflow-x-auto"><table aria-label="Score dimensions" className="w-full min-w-[420px] border-collapse text-left text-sm"><thead className="border-y border-black bg-black/5 text-xs uppercase tracking-wider"><tr><th className="p-3">Dimension</th><th className="p-3 text-right">Grade</th></tr></thead><tbody>{run.scorecard.dimensions.map((dimension) => <tr className="border-b border-black/15" key={dimension.dimensionId}><td className="p-3">{dimension.dimensionId}</td><td className="p-3 text-right font-bold">{dimension.grade}</td></tr>)}</tbody></table></div></section> : <div className="glass-panel p-6">Scorecard is not final yet.</div>}
    <div className="border-l-2 border-black pl-4 text-xs leading-relaxed text-neutral-600"><strong className="text-black">Privacy boundary.</strong> This public record exposes the scenario digest, states, grades and result only. Prompt, hidden context, raw provider output and private reasons are excluded.</div>
  </section>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div className="retro-inset p-3"><p className="text-[10px] uppercase tracking-wider">{label}</p><p className="mt-1 font-semibold">{value}</p></div>; }
