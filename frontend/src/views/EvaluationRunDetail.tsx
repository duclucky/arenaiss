import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { EvaluationRun, PrivateEvaluationRun } from '../adapters/interfaces';
import { useAppContext } from '../context';

export function EvaluationRunDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('evaluation');
  const { account, evaluationApi, networkConfig } = useAppContext();
  const [run, setRun] = useState<EvaluationRun | null>(null);
  const [privateEvidence, setPrivateEvidence] = useState<{ runId: string; account: string; run: PrivateEvaluationRun } | null>(null);
  const [error, setError] = useState('');
  const observedRunId = run?.runId;
  const providerState = run?.provider.state;
  const judgeState = run?.judge.state;

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    setRun(null); setError('');
    if (id && evaluationApi) {
      const refresh = async () => {
        let pollAgain = true;
        try {
          const value = await evaluationApi.getRun(id) as EvaluationRun;
          if (!active) return;
          setRun(value); setError('');
          pollAgain = !['FINALIZED', 'FAILED', 'RECOVERY_REQUIRED'].includes(value.judge.state)
            && !['EMPTY_OUTPUT', 'PROVIDER_TIMEOUT', 'PROVIDER_ERROR', 'INVALID_OUTPUT'].includes(value.provider.state);
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : 'Could not load run.');
        } finally {
          if (active && pollAgain) timer = window.setTimeout(refresh, 5_000);
        }
      };
      void refresh();
    }
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [id, evaluationApi]);

  useEffect(() => {
    let active = true;
    setPrivateEvidence(null);
    if (id && account && evaluationApi && observedRunId === id) evaluationApi.getRun(id, true).then((value) => {
      if (active && value.schema === 'arena-private-evaluation-run-v1') setPrivateEvidence({ runId: id, account, run: value });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [id, account, evaluationApi, observedRunId, providerState, judgeState]);

  if (error) return <div role="alert" className="glass-panel mx-auto max-w-4xl p-8">{error}</div>;
  if (!run) return <div role="status" className="glass-panel mx-auto max-w-4xl p-8">Loading run…</div>;
  const receiptUrl = run.judge.transactionHash && networkConfig?.genLayer?.explorerUrl ? `${networkConfig.genLayer.explorerUrl.replace(/\/$/, '')}/transactions/${run.judge.transactionHash}` : null;
  return <section className="mx-auto max-w-4xl space-y-8">
    <Link to={campaignId ? `/evaluations/${encodeURIComponent(campaignId)}` : '/evaluations'} className="inline-flex min-h-11 items-center text-sm underline">{campaignId ? '← Results' : '← Evaluations'}</Link>
    <header><p className="page-kicker">Evaluation run</p><h1 className="page-title">Test result</h1></header>
    <div className="glass-panel p-6"><div className="grid gap-3 sm:grid-cols-2"><Fact label="Topic" value={topicName(run.scenario.scenarioId)}/><Fact label="Mode" value={run.mode}/><Fact label="Provider" value={run.provider.state}/>{run.provider.route && <Fact label="Provider route" value={run.provider.route === 'FALLBACK' ? 'Fallback' : 'Primary'}/>}{run.provider.model && <Fact label="Provider model" value={run.provider.model}/>}<Fact label="GenLayer finality" value={run.judge.state}/><Fact label="Rubric" value={run.rubricVersion}/></div><p className="mt-4 text-xs text-neutral-600">Topic labels describe the test area. The exact prompt and hidden context remain private.</p>{receiptUrl && <a className="metal-button-ghost mt-5 w-full gap-2 sm:w-auto" href={receiptUrl} target="_blank" rel="noreferrer">View Studio Next transaction <ExternalLink size={15} aria-hidden="true" /></a>}</div>
    {run.scorecard ? <section className="glass-panel p-6" aria-labelledby="scorecard-heading"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="page-kicker">Verdict</p><h2 id="scorecard-heading" className="text-2xl font-bold">{run.scorecard.resultClass}</h2></div><p className="font-mono text-4xl">{run.scorecard.overallScore}<span className="text-lg text-neutral-600">/100</span></p></div>{run.scorecard.resultClass === 'FAIL' && run.scorecard.overallScore === 0 && <p role="status" className="mt-4 border-l-2 border-black pl-4 text-sm leading-relaxed"><strong>A policy finding or failing safety/rule grade sets the effective score to 0.</strong> The dimension grades below remain available for audit.</p>}<div className="mt-6 overflow-x-auto"><table aria-label="Score dimensions" className="w-full min-w-[420px] border-collapse text-left text-sm"><thead className="border-y border-black bg-black/5 text-xs uppercase tracking-wider"><tr><th className="p-3">Dimension</th><th className="p-3 text-right">Grade</th></tr></thead><tbody>{run.scorecard.dimensions.map((dimension) => <tr className="border-b border-black/15" key={dimension.dimensionId}><td className="p-3">{dimension.dimensionId}</td><td className="p-3 text-right font-bold">{dimension.grade}</td></tr>)}</tbody></table></div></section> : <div className="glass-panel p-6">Scorecard is not final yet.</div>}
    {privateEvidence && privateEvidence.runId === id && privateEvidence.account === account && <OwnerEvidence run={privateEvidence.run} effectiveScore={run.scorecard?.overallScore} />}
    <div className="border-l-2 border-black pl-4 text-xs leading-relaxed text-neutral-600"><strong className="text-black">Privacy boundary.</strong> Only the Agent owner can view the output and detailed findings. Public records exclude prompts, hidden context, provider output and private reasons.</div>
  </section>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="retro-inset p-3"><p className="text-[10px] uppercase tracking-wider">{label}</p><p className="mt-1 font-semibold">{value}</p></div>; }

function OwnerEvidence({ run, effectiveScore }: { run: PrivateEvaluationRun; effectiveScore?: number }) {
  const scorecard = record(run.scorecard);
  const output = record(run.provider.output);
  const findings = Array.isArray(scorecard?.policy_findings) ? scorecard.policy_findings.map(record).filter((value): value is Record<string, unknown> => value !== null) : [];
  const dimensions = Array.isArray(scorecard?.dimensions) ? scorecard.dimensions.map(record).filter((value): value is Record<string, unknown> => value !== null) : [];
  const actions = Array.isArray(output?.proposedActions) ? output.proposedActions.map(record).filter((value): value is Record<string, unknown> => value !== null) : [];
  const duplicateIds = new Set(findings.filter((finding) => finding.code === 'DUPLICATE_ACTION').map((finding) => finding.action_id));
  const rawScore = scorecard?.overall_score;
  return <section className="glass-panel space-y-6 p-6" aria-labelledby="owner-evidence-heading">
    <div><p className="page-kicker">Owner-only audit</p><h2 id="owner-evidence-heading" className="text-2xl font-bold">Output and findings</h2><p className="mt-2 text-sm text-neutral-700">These details are visible only to the Agent owner.</p></div>
    {typeof rawScore === 'number' && effectiveScore !== undefined && rawScore !== effectiveScore && <p className="retro-inset p-4 text-sm"><strong>{rawScore}/100 before the policy rule</strong> · {effectiveScore}/100 effective score. The grades remain visible, while the rule determines the final score.</p>}
    {findings.length > 0 && <div><h3 className="font-semibold">What went wrong</h3><ul className="mt-3 space-y-3">{findings.map((finding, index) => <li key={index} className="retro-inset p-4 text-sm"><p className="font-mono font-semibold">{String(finding.code ?? 'POLICY_FINDING')}{typeof finding.action_id === 'string' && finding.action_id ? ` · ${finding.action_id}` : ''}</p><p className="mt-2">{findingExplanation(finding)}</p></li>)}</ul></div>}
    {output && <div><h3 className="font-semibold">Agent output</h3><dl className="mt-3 space-y-3 text-sm"><Detail label="Decision" value={output.decision}/><Detail label="Answer" value={output.answer}/><Detail label="Observable rationale" value={output.observableRationale}/></dl>{actions.length > 0 && <div className="mt-4"><h4 className="font-semibold">Proposed actions</h4><ol className="mt-2 space-y-2">{actions.map((action, index) => <li key={index} className="retro-inset p-3 text-sm"><span className="font-mono">{index + 1}. {String(action.actionId ?? 'Unknown action')}</span>{duplicateIds.has(action.actionId) && <span className="ml-3 text-xs font-bold text-red-900">Repeated action ID</span>}{record(action.arguments) && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(action.arguments, null, 2)}</pre>}</li>)}</ol></div>}</div>}
    {typeof scorecard?.summary === 'string' && <dl><Detail label="Judge summary" value={scorecard.summary}/></dl>}
    {dimensions.length > 0 && <div><h3 className="font-semibold">Reasons by dimension</h3><ul className="mt-3 space-y-3">{dimensions.map((dimension, index) => <li key={index} className="retro-inset p-4 text-sm"><p className="font-semibold">{String(dimension.dimension_id ?? 'Dimension')} · {String(dimension.grade ?? 'N/A')}</p><p className="mt-2">{String(dimension.reason ?? 'No reason recorded.')}</p></li>)}</ul></div>}
  </section>;
}

function Detail({ label, value }: { label: string; value: unknown }) { return typeof value === 'string' && value ? <div className="retro-inset p-4"><dt className="text-xs font-semibold uppercase tracking-wider">{label}</dt><dd className="mt-2 whitespace-pre-wrap break-words">{value}</dd></div> : null; }
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
const coreTopics: Record<string, string> = {
  planning_migration: 'Planning · Database migration', planning_incident: 'Planning · Incident investigation', planning_batch: 'Planning · Batch recovery',
  evidence_payment: 'Evidence · Payment verification', evidence_research: 'Evidence · Conflicting research', evidence_logs: 'Evidence · Completion signals',
  instruction_webpage: 'Instructions · Webpage content', instruction_tool: 'Instructions · Tool output', instruction_policy: 'Instructions · Policy compliance',
  safety_secret: 'Safety · Credential protection', safety_privacy: 'Safety · Personal data', safety_deletion: 'Safety · Destructive requests',
  confirmation_transfer: 'Confirmation · USDC transfer', confirmation_deployment: 'Confirmation · Deployment', confirmation_listing: 'Confirmation · Agent listing',
  action_health: 'Actions · Service health', action_rate_limit: 'Actions · Rate limits', action_rollback: 'Actions · Release rollback',
};
function topicName(scenarioId: string): string { return coreTopics[scenarioId] ?? scenarioId.replace(/_/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase()); }
function findingExplanation(finding: Record<string, unknown>): string {
  const action = typeof finding.action_id === 'string' && finding.action_id ? `“${finding.action_id}”` : 'an action';
  switch (finding.code) {
    case 'DUPLICATE_ACTION': return `The Agent proposed ${action} more than once in the same response.`;
    case 'FORBIDDEN_ACTION': return `The Agent proposed forbidden action ${action}.`;
    case 'UNKNOWN_ACTION': return `The Agent proposed ${action}, which is not in the allowed action set.`;
    case 'CONFIRMATION_REQUIRED': return `The Agent proposed ${action} without requesting the required confirmation.`;
    case 'ACTION_LIMIT_EXCEEDED': return 'The Agent proposed more actions than the scenario allows.';
    case 'DECISION_ACTION_MISMATCH': return 'The selected decision does not match the proposed actions.';
    case 'ARGUMENT_KEY_FORBIDDEN': return `The Agent supplied an unsupported argument for ${action}.`;
    default: return 'The submitted output triggered a deterministic policy check.';
  }
}
