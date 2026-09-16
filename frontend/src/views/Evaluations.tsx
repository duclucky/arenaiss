import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, LockKeyhole, ReceiptText, Shuffle } from 'lucide-react';
import type { AgentProfile, EvaluationCampaign } from '../adapters/interfaces';
import { useAppContext } from '../context';

const coverage = ['Instruction following', 'Reasoning', 'Safety', 'Tool discipline', 'Robustness'];

export function Evaluations() {
  const { account, agentApi, evaluationApi } = useAppContext();
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [campaigns, setCampaigns] = useState<EvaluationCampaign[]>([]);
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
    if (!account || !evaluationApi || !campaigns.some((campaign) => !['FINALIZED', 'FAILED'].includes(campaign.state))) return;
    const timer = window.setInterval(() => {
      evaluationApi.listCampaigns().then(setCampaigns).catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [account, evaluationApi, campaigns]);

  const startEvaluation = async () => {
    const agent = agents.find((candidate) => candidate.agentId === agentId);
    if (!agent || !evaluationApi?.startEvo) return;
    setRunning(true); setError(''); setWorkerNotice('');
    try {
      const campaign = await evaluationApi.startEvo({ agentId: agent.agentId, agentsVersion: agent.agentsVersion });
      setCampaigns((current) => [campaign, ...current.filter((row) => row.campaignId !== campaign.campaignId)]);
      if (!['FINALIZED', 'FAILED'].includes(campaign.state)) setWorkerNotice('Evaluation accepted. Processing continues on the server, so you may close this page.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start evaluation.'); }
    finally { setRunning(false); }
  };

  return <section className="mx-auto max-w-5xl space-y-10">
    <header><p className="page-kicker">Arena ISS / SOLO</p><h1 className="page-title">Evaluations</h1><h2 className="mt-7 max-w-3xl text-2xl font-semibold leading-tight sm:text-4xl">Hidden tests. Independent verdicts.</h2><p className="page-lede">Arena ISS designs, versions and randomizes every scenario. You choose the Agent; the test prompts stay hidden before and during execution.</p></header>
    <section aria-labelledby="protocol-heading" className="glass-panel p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="page-kicker">Evaluation protocol</p><h2 id="protocol-heading" className="text-2xl font-bold">How Evo evaluation works</h2></div><span className="retro-chip gap-2 px-3 py-2 text-xs"><LockKeyhole size={15} aria-hidden="true" /> Hidden &amp; versioned</span></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3"><ProtocolStep icon={<LockKeyhole size={20} />} title="1. Version-locked Agent" copy="The selected AGENTS.md version is tested against private, versioned scenarios that are not exposed in advance." /><ProtocolStep icon={<Shuffle size={20} />} title="2. GenLayer scorecard" copy="GenVM validators assess the exact submitted evidence and finalize an Evo scorecard across capability and safety dimensions." /><ProtocolStep icon={<ReceiptText size={20} />} title="3. Arc settlement" copy="The fixed USDC fee is held on Arc Testnet. Completed runs release it, while infrastructure failures return it to the payer." /></div>
      <div className="mt-6 border-t border-black/20 pt-5"><p className="text-xs uppercase tracking-[0.18em] text-neutral-600">Coverage</p><ul className="mt-3 flex flex-wrap gap-2" aria-label="Evaluation coverage">{coverage.map((item) => <li key={item} className="retro-chip gap-2 px-3 py-2 text-xs"><CheckCircle2 size={14} aria-hidden="true" />{item}</li>)}</ul></div>
    </section>
    <section aria-labelledby="start-heading" className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="glass-panel p-6 md:p-8"><p className="page-kicker">New evaluation</p><h2 id="start-heading" className="text-2xl font-bold">Choose an Agent</h2>
        {!account ? <div className="mt-5 retro-inset p-5"><p className="font-semibold">Log in to continue</p><p className="mt-2 text-sm text-neutral-600">Sign in from the header, then select one of your versioned Agents.</p></div> : <div className="mt-5"><label htmlFor="evaluation-agent" className="text-sm font-semibold">Agent to evaluate</label><select id="evaluation-agent" className="field-control mt-2" value={agentId} onChange={(event) => setAgentId(event.target.value)}>{agents.length === 0 && <option value="">No Agents available</option>}{agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.name} · {agent.agentsVersion}</option>)}</select>{error && <p role="alert" className="mt-4 text-sm text-red-900">{error}</p>}{workerNotice && <p role="status" className="mt-4 text-sm font-semibold">{workerNotice}</p>}<button className="metal-button-solid mt-5 w-full sm:w-auto" disabled={!execution.enabled || !agentId || running} onClick={startEvaluation}>{running ? 'Submitting evaluation…' : 'Start evaluation'}</button></div>}
      </div>
      <aside className="glass-panel p-6" aria-labelledby="fee-heading"><p className="page-kicker">Evo fee</p><h2 id="fee-heading" className="font-mono text-4xl font-bold">{execution.feeUsdc ?? 'N/A'} USDC</h2><p className="mt-5 border-t border-black/20 pt-4 text-xs font-semibold uppercase tracking-wider">Arc Testnet · USDC</p></aside>
    </section>
    {account && <CampaignList campaigns={campaigns} />}
  </section>;
}

function ProtocolStep({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) { return <div className="retro-inset p-4"><span className="mb-4 flex h-10 w-10 items-center justify-center border border-black bg-neutral-100" aria-hidden="true">{icon}</span><h3 className="font-semibold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-neutral-600">{copy}</p></div>; }
function CampaignList({ campaigns }: { campaigns: EvaluationCampaign[] }) { return <section aria-labelledby="campaigns-heading"><h2 id="campaigns-heading" className="mb-4 text-2xl font-bold">My evaluations</h2>{campaigns.length === 0 ? <div className="glass-panel p-7 text-neutral-700">No evaluation records yet.</div> : <ul className="space-y-3">{campaigns.map((campaign) => <li key={campaign.campaignId} className="glass-panel flex flex-wrap items-center justify-between gap-4 p-5"><div className="min-w-0"><p className="break-all font-mono text-xs">{campaign.campaignId}</p><p className="mt-2 font-semibold">Pack {campaign.packVersion} · {campaign.items.length} test{campaign.items.length === 1 ? '' : 's'}</p></div><Link className="metal-button-ghost" to={`/evaluations/${campaign.campaignId}`}>{campaign.state} →</Link></li>)}</ul>}</section>; }
