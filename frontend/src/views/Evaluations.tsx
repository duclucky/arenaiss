import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, LockKeyhole, ReceiptText, Shuffle } from 'lucide-react';
import type { AgentProfile, EvaluationCampaign } from '../adapters/interfaces';
import { useAppContext } from '../context';
import { displayLabel } from '../display-label';

const capabilityGroups = [
  { name: 'Planning', meaning: 'Plans reversible work and identifies missing evidence before taking action.' },
  { name: 'Evidence', meaning: 'Reports only what the supplied records support and reconciles conflicting signals.' },
  { name: 'Prompt injection defense', meaning: 'Detects and resists prompt injection by treating instructions in webpages, logs and tool results as untrusted data, not authority.' },
  { name: 'Safety', meaning: 'Protects secrets and personal data and avoids unsupported destructive operations.' },
  { name: 'Confirmation discipline', meaning: 'Requests explicit confirmation before transfers, deployments or public listings.' },
  { name: 'Tool action selection', meaning: 'Chooses the least-privileged tool call and uses idempotent recovery for failures.' },
] as const;
function mergeCampaigns(current: EvaluationCampaign[], incoming: EvaluationCampaign[]): EvaluationCampaign[] {
  const merged = new Map(current.map((campaign) => [campaign.campaignId, campaign]));
  for (const campaign of incoming) merged.set(campaign.campaignId, campaign);
  return [...merged.values()];
}

export function Evaluations() {
  const { account, agentApi, evaluationApi } = useAppContext();
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [campaigns, setCampaigns] = useState<EvaluationCampaign[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [error, setError] = useState('');
  const [execution, setExecution] = useState<{ enabled: boolean; feeUsdc?: string }>({ enabled: false });
  const [running, setRunning] = useState(false);
  const [workerNotice, setWorkerNotice] = useState('');

  useEffect(() => {
    if (!account || !agentApi || !evaluationApi) return;
    Promise.all([agentApi.listOwnedAgents(), evaluationApi.listCampaigns(), evaluationApi.getExecutionConfig?.() ?? Promise.resolve({ enabled: false })]).then(([nextAgents, nextCampaigns, nextExecution]) => {
      setAgents(nextAgents); setCampaigns(nextCampaigns);
      setExecution(nextExecution);
      if (nextAgents[0]) setAgentId((current) => current || nextAgents[0].agentId);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load evaluations.'));
  }, [account, agentApi, evaluationApi]);

  useEffect(() => {
    if (!account || !evaluationApi || !campaigns.some((campaign) => !['FINALIZED', 'FAILED', 'PAYMENT_FAILED'].includes(campaign.state))) return;
    const timer = window.setInterval(() => {
      evaluationApi.listCampaigns().then((next) => setCampaigns((current) => mergeCampaigns(current, next))).catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [account, evaluationApi, campaigns]);

  const startEvaluation = async () => {
    const agent = agents.find((candidate) => candidate.agentId === agentId);
    if (!agent || !evaluationApi?.startEvo) return;
    setRunning(true); setError(''); setWorkerNotice('');
    try {
      const campaign = await evaluationApi.startEvo({ agentId: agent.agentId, agentsVersion: agent.agentsVersion });
      setCampaigns((current) => mergeCampaigns(current, [campaign]));
      setActiveCampaignId(campaign.campaignId);
      try {
        const refreshed = await evaluationApi.listCampaigns();
        setCampaigns((current) => mergeCampaigns(current, refreshed));
      } catch { /* Keep the accepted campaign visible while the next background refresh retries. */ }
      if (!['FINALIZED', 'FAILED', 'PAYMENT_FAILED'].includes(campaign.state)) setWorkerNotice('Evaluation accepted. Processing continues on the server, so you may close this page.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start evaluation.');
      try { setCampaigns(await evaluationApi.listCampaigns()); } catch { /* Preserve the payment error; the next page load can refresh history. */ }
    }
    finally { setRunning(false); }
  };
  const activeCampaign = activeCampaignId
    ? campaigns.find((campaign) => campaign.campaignId === activeCampaignId && isEvaluationInProgress(campaign))
    : running ? undefined : latestActiveCampaign(campaigns);

  return <section className="mx-auto max-w-5xl space-y-10">
    <header><p className="page-kicker">Arena ISS / SOLO</p><h1 className="page-title">Evaluations</h1><h2 className="mt-7 max-w-3xl text-2xl font-semibold leading-tight sm:text-4xl">Hidden tests. Independent verdicts.</h2><p className="page-lede">Arena ISS designs, versions and randomizes every scenario. You choose the Agent; the test prompts stay hidden before and during execution.</p></header>
    <section aria-labelledby="protocol-heading" className="glass-panel p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="page-kicker">Evaluation protocol</p><h2 id="protocol-heading" className="text-2xl font-bold">How Agent evaluation works</h2></div><span className="retro-chip gap-2 px-3 py-2 text-xs"><LockKeyhole size={15} aria-hidden="true" /> Hidden &amp; versioned</span></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3"><ProtocolStep icon={<LockKeyhole size={20} />} title="1. Version-locked Agent" copy="The selected AGENTS.md version is tested against private, versioned scenarios that are not exposed in advance." /><ProtocolStep icon={<Shuffle size={20} />} title="2. GenLayer scorecard" copy="GenVM validators assess the exact submitted evidence and finalize a scorecard across capability and safety dimensions." /><ProtocolStep icon={<ReceiptText size={20} />} title="3. Arc settlement" copy="The fixed USDC fee is held on Arc Testnet. Completed runs release it, and the finalized result is committed to the Agent's ERC-8004 reputation record. Infrastructure failures return it to the payer." /></div>
    </section>
    <section aria-labelledby="start-heading" className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(420px,1.15fr)]">
      <div className="glass-panel p-6 md:p-8"><p className="page-kicker">New evaluation</p><h2 id="start-heading" className="text-2xl font-bold">Choose an Agent</h2>
    {!account ? <div className="mt-5 retro-inset p-5"><p className="font-semibold">Log in to continue</p><p className="mt-2 text-sm text-neutral-600">Sign in from the header, then select one of your versioned Agents.</p></div> : <div className="mt-5"><label htmlFor="evaluation-agent" className="text-sm font-semibold">Agent to evaluate</label><select id="evaluation-agent" className="field-control mt-2" value={agentId} onChange={(event) => setAgentId(event.target.value)}>{agents.length === 0 && <option value="">No Agents available</option>}{agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}</select>{error && <p role="alert" className="mt-4 text-sm text-red-900">{displayLabel(error)}</p>}{workerNotice && <p role="status" className="mt-4 text-sm font-semibold">{workerNotice}</p>}<div className="mt-5 flex flex-wrap items-center gap-3"><button className="metal-button-solid w-full sm:w-auto" disabled={!execution.enabled || !agentId || running} onClick={startEvaluation}>{running ? 'Submitting evaluation…' : 'Start evaluation'}</button><span className="retro-chip px-3 py-2 text-xs font-semibold">Fee · {execution.feeUsdc ?? 'N/A'} USDC on Arc Testnet</span></div></div>}
    {(running || activeCampaign) && <EvaluationProgress campaign={activeCampaign} submitting={running && !activeCampaign} />}
      </div>
      <aside className="glass-panel p-6 md:p-8" aria-labelledby="checklist-heading"><p className="page-kicker">Evaluation checklist</p><h2 id="checklist-heading" className="text-2xl font-bold">Evaluation checklist</h2><p className="mt-3 text-sm leading-relaxed text-neutral-700">Every evaluation selects one hidden scenario from each of the six groups below, for six scenarios total. The exact prompts stay private until the evaluation is complete.</p><ul className="mt-5 grid gap-3 sm:grid-cols-2" aria-label="Evaluation capability groups">{capabilityGroups.map((group) => <li key={group.name} className="retro-inset flex gap-3 p-4"><CheckCircle2 className="mt-0.5 shrink-0" size={18} aria-hidden="true" /><div><h3 className="font-semibold">{group.name}</h3><p className="mt-1 text-sm leading-relaxed text-neutral-600">{group.meaning}</p></div></li>)}</ul></aside>
    </section>
    {account && <CampaignList campaigns={campaigns} />}
  </section>;
}

function ProtocolStep({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) { return <div className="retro-inset p-4"><span className="mb-4 flex h-10 w-10 items-center justify-center border border-black bg-neutral-100" aria-hidden="true">{icon}</span><h3 className="font-semibold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-neutral-600">{copy}</p></div>; }
function isEvaluationInProgress(campaign: EvaluationCampaign): boolean { return !['FINALIZED', 'FAILED', 'PAYMENT_FAILED', 'REFUNDED'].includes(campaign.state); }
function latestActiveCampaign(campaigns: EvaluationCampaign[]): EvaluationCampaign | undefined {
  return campaigns.filter(isEvaluationInProgress).reduce<EvaluationCampaign | undefined>((latest, campaign) => {
    if (!latest) return campaign;
    return (campaign.startedAt ?? campaign.createdAt ?? 0) > (latest.startedAt ?? latest.createdAt ?? 0) ? campaign : latest;
  }, undefined);
}
function EvaluationProgress({ campaign, submitting = false }: { campaign?: EvaluationCampaign; submitting?: boolean }) {
  const total = campaign?.items.length || 6;
  const finalized = campaign?.items.filter((item) => item.state === 'FINALIZED').length || 0;
  const activeItem = campaign?.items.find((item) => item.state !== 'FINALIZED');
  const activeStep = submitting || campaign?.state === 'PENDING'
    ? 0
    : activeItem?.state === 'JUDGING' || activeItem?.state === 'RECOVERY_REQUIRED'
      ? 2
      : finalized === total
        ? 3
        : 1;
  const status = submitting
    ? 'Submitting the evaluation and securing its Arc fee.'
    : campaign?.state === 'PENDING'
    ? 'Securing the evaluation fee on Arc Testnet.'
    : campaign?.state === 'RECOVERY_REQUIRED'
      ? 'Reconciling the GenLayer submission automatically.'
      : activeItem?.state === 'JUDGING'
        ? `GenLayer validators are judging the hidden scenarios. ${finalized} of ${total} scorecards are final.`
        : finalized === total
          ? 'The final scorecard is being prepared for the Agent reputation record.'
          : `The Agent is producing responses for the hidden scenarios. ${finalized} of ${total} are complete.`;
  const steps = ['Payment secured', 'Agent runtime', 'GenLayer judging', 'Scorecards', 'ERC-8004 record'];
  return <section className="evaluation-progress" aria-label="Evaluation progress" role="status" aria-live="polite">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="page-kicker">Live evaluation</p><h3 className="text-lg font-bold">Evaluation in progress</h3></div><span className="evaluation-progress__refresh">Auto-refreshing</span></div>
    <div className="evaluation-progress__visual"><div className="evaluation-progress__orbit" role="img" aria-label={`Stage ${activeStep + 1} of ${steps.length}`}><span className="evaluation-progress__runner" aria-hidden="true" /><span className="evaluation-progress__counter"><strong>{activeStep + 1}</strong><small>of {steps.length}</small></span></div><p>{status}</p></div>
    <ol className="evaluation-progress__steps">{steps.map((step, index) => <li key={step} className={index < activeStep ? 'is-complete' : index === activeStep ? 'is-active' : ''}><span className="evaluation-progress__marker" aria-hidden="true">{index < activeStep ? '✓' : index + 1}</span><span>{step}</span></li>)}</ol>
    <p className="evaluation-progress__reduced">Reduced motion: static progress marker</p>
  </section>;
}
function CampaignList({ campaigns }: { campaigns: EvaluationCampaign[] }) {
  const timestamp = (campaign: EvaluationCampaign) => campaign.startedAt ?? campaign.createdAt;
  const ordered = campaigns.slice().sort((a, b) => (timestamp(b) ?? 0) - (timestamp(a) ?? 0));
  const utcDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
  return <section aria-labelledby="campaigns-heading"><h2 id="campaigns-heading" className="mb-4 text-2xl font-bold">My evaluations</h2>{campaigns.length === 0 ? <div className="glass-panel p-7 text-neutral-700">No evaluation records yet.</div> : <ul className="space-y-3">{ordered.map((campaign) => { const time = timestamp(campaign); return <li key={campaign.campaignId} className="glass-panel flex flex-wrap items-center justify-between gap-4 p-5"><div className="min-w-0"><p className="break-words font-semibold">{campaign.agentName || 'Agent name unavailable'}</p><p className="mt-1 text-sm text-neutral-600">{time && Number.isFinite(time) ? <time dateTime={new Date(time).toISOString()}>{utcDate.format(time)} UTC</time> : 'Time not recorded'}</p></div><Link aria-label="Open evaluation results" className="metal-button-ghost" to={`/evaluations/${campaign.campaignId}`}>{campaign.state === 'PAYMENT_FAILED' ? 'Payment failed' : displayLabel(campaign.state)} →</Link></li>; })}</ul>}</section>;
}
