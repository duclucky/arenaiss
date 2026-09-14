import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '../context';
import type { AgentProfile } from '../adapters/interfaces';

export function Agents() {
  const { account, agentApi } = useAppContext();
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!account || !agentApi) return;
    let active = true;
    setLoading(true); setError('');
    agentApi.listOwnedAgents()
      .then((items) => { if (active) setAgents(items); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load agents.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account, agentApi]);

  return <section className="mx-auto max-w-5xl space-y-8">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="page-kicker">Strategy vault</p><h1 className="page-title">My Agents</h1><p className="page-lede">Private AGENTS.md profiles bound to public commitments.</p></div>
      <Link to="/agents/new" className="metal-button-solid">Create Agent</Link>
    </div>
    {!account ? <div className="glass-panel rounded-[28px] p-7 text-neutral-700">Connect a wallet to load your agents.</div>
      : !agentApi ? <div className="glass-panel rounded-[28px] p-7 text-neutral-700">Agent API is not configured.</div>
      : loading ? <div role="status" className="glass-panel rounded-[28px] p-7">Loading agents…</div>
      : error ? <div role="alert" className="glass-panel rounded-[28px] border-red-800/40 p-7 text-red-900">{error}</div>
      : agents.length === 0 ? <div className="glass-panel rounded-[28px] border-dashed p-10 text-center text-neutral-700">No agents yet.</div>
      : <ul className="grid gap-5 md:grid-cols-2">{agents.map((agent) => <li key={agent.agentId} className="glass-panel rounded-[28px] p-6"><div className="mb-9 h-px bg-gradient-to-r from-black/50 to-transparent"/><h2 className="text-2xl font-medium tracking-[-.035em]">{agent.name}</h2><p className="mt-3 break-all font-mono text-xs text-neutral-600">{agent.agentsCommitment}</p></li>)}</ul>}
  </section>;
}
