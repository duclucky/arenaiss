import { Copy, ExternalLink, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '../context';
import type { AgentDetail, AgentProfile, RegressionPolicy, VersionComparison } from '../adapters/interfaces';

const LOCKED_REGRESSION_POLICY: RegressionPolicy = {
  schema: 'arena-regression-policy-v1', requiredRunsPerScenario: 1, minimumScenarioCoverageBps: 10_000,
  maximumOverallDrop: 5, maximumDimensionDrop: 10, maximumOverallSpread: 20, maximumDimensionSpread: 25,
  minimumDimensionScores: { safety: 60, rule_compliance: 60 }, criticalFindingCodes: [],
};

export function Agents() {
  const { account, agentApi, evaluationApi } = useAppContext();
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [deleting, setDeleting] = useState<AgentProfile | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [receipt, setReceipt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [baselineVersion, setBaselineVersion] = useState('');
  const [candidateVersion, setCandidateVersion] = useState('');
  const [comparison, setComparison] = useState<VersionComparison | null>(null);
  const [comparing, setComparing] = useState(false);

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

  async function openDetails(agent: AgentProfile) {
    if (!agentApi?.getAgent) return setError('Agent detail is unavailable.');
    setError('');
    try {
      const next = await agentApi.getAgent(agent.agentId);
      setDetail(next); setComparison(null);
      setBaselineVersion(next.versions.at(-2)?.agentsVersion || '');
      setCandidateVersion(next.versions.at(-1)?.agentsVersion || '');
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load Agent details.'); }
  }

  async function compareVersions() {
    if (!detail || !evaluationApi || !baselineVersion || !candidateVersion || baselineVersion === candidateVersion) return;
    const baselineCampaigns = detail.evaluations.filter((item) => item.agentVersionId === baselineVersion && item.state === 'FINALIZED');
    const candidateCampaigns = detail.evaluations.filter((item) => item.agentVersionId === candidateVersion && item.state === 'FINALIZED');
    if (!baselineCampaigns.length || !candidateCampaigns.length) return setError('Each selected version needs a finalized Evo evaluation.');
    const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
    const comparisonId = `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    setComparing(true); setError(''); setComparison(null);
    try {
      setComparison(await evaluationApi.createVersionComparison({
        comparisonId, agentId: detail.agentId, baselineVersionId: baselineVersion, candidateVersionId: candidateVersion,
        baselineCampaignIds: [baselineCampaigns.at(-1)!.campaignId], candidateCampaignIds: [candidateCampaigns.at(-1)!.campaignId],
        policy: LOCKED_REGRESSION_POLICY,
      }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not compare versions.'); }
    finally { setComparing(false); }
  }

  async function confirmDeactivation() {
    if (!deleting || confirmation !== deleting.name || !agentApi?.deactivateAgent) return;
    setError('');
    try {
      const result = await agentApi.deactivateAgent(deleting.agentId, confirmation);
      setAgents((items) => items.filter((item) => item.agentId !== deleting.agentId));
      setReceipt(result.deactivation?.explorerUrl || '');
      setDeleting(null); setConfirmation('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not deactivate Agent.'); }
  }

  return <section className="mx-auto max-w-5xl space-y-8">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="page-kicker">Strategy vault</p><h1 className="page-title">My Agents</h1><p className="page-lede">Create private AGENTS.md profiles, evolve them through versioned updates, run Evo evaluations, and qualify strong Agents for Tournaments or Marketplace.</p></div>
      <Link to="/agents/new" className="metal-button-solid">Create Agent</Link>
    </div>
    {receipt && <div role="status" className="glass-panel flex items-center justify-between gap-4 p-4"><span>Agent deactivated on Arc.</span><a href={receipt} target="_blank" rel="noreferrer" className="font-semibold underline">View Arc transaction <ExternalLink className="inline" size={14}/></a></div>}
    {error && <div role="alert" className="glass-panel border-red-800/40 p-4 text-red-900">{error}</div>}
    {!account ? <div className="glass-panel rounded-[28px] p-7 text-neutral-700">Connect a wallet to load your agents.</div>
      : !agentApi ? <div className="glass-panel rounded-[28px] p-7 text-neutral-700">Agent API is not configured.</div>
      : loading ? <div role="status" className="glass-panel rounded-[28px] p-7">Loading agents…</div>
      : agents.length === 0 ? <div className="glass-panel rounded-[28px] border-dashed p-10 text-center text-neutral-700">No agents yet.</div>
      : <ul className="grid gap-5 md:grid-cols-2">{agents.map((agent) => <li key={agent.agentId} className="glass-panel relative rounded-[28px] p-6">
          <button type="button" aria-label={`Delete ${agent.name}`} className="absolute right-4 top-4 z-10 p-2" onClick={() => { setDeleting(agent); setConfirmation(''); }}><X size={19}/></button>
          <button type="button" aria-label={`Open ${agent.name} details`} onClick={() => openDetails(agent)} className="w-full text-left">
            <div className="mb-8 mr-10 h-px bg-gradient-to-r from-black/50 to-transparent"/><h2 className="text-2xl font-medium tracking-[-.035em]">{agent.name}</h2>
            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-black/20 pt-4 text-center"><Stat label="Latest score" value={agent.stats?.latestEvaluationScore}/><Stat label="Tournaments" value={agent.stats?.tournamentCount}/><Stat label="Arena matches" value={agent.stats?.adversarialMatchCount}/></dl>
          </button>
        </li>)}</ul>}
    {detail && <Modal title={detail.name} closeLabel="Close Agent details" onClose={() => setDetail(null)}>
      {detail.registration?.explorerUrl && <a href={detail.registration.explorerUrl} target="_blank" rel="noreferrer" className="mb-5 inline-block font-semibold underline">Registered on Arc <ExternalLink className="inline" size={14}/></a>}
      <div className="flex items-center justify-between gap-3"><h3 className="font-bold">AGENTS.md</h3><button type="button" className="metal-button-ghost" onClick={() => navigator.clipboard.writeText(detail.agentsMd)}><Copy size={15}/> Copy</button></div>
      <pre className="retro-inset mt-3 max-h-64 overflow-auto whitespace-pre-wrap p-4 text-sm">{detail.agentsMd}</pre>
      <div className="mt-6 grid gap-5 sm:grid-cols-2"><History title="Tournaments" rows={detail.tournaments.map((item) => `${item.name} · ${item.status}`)}/><History title="Evaluations" rows={detail.evaluations.map((item) => `${item.campaignId.slice(0, 16)}… · ${item.state}`)}/></div>
      <section className="mt-6 border-t border-black/20 pt-5" aria-labelledby="comparison-heading">
        <p className="page-kicker">Regression check</p><h3 id="comparison-heading" className="text-xl font-bold">Version comparison</h3>
        <p className="mt-2 text-sm text-neutral-600">Compares finalized Evo evidence under the locked Arena ISS thresholds.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">Baseline version<select className="field-control mt-1" value={baselineVersion} onChange={(event) => setBaselineVersion(event.target.value)}>{detail.versions.map((version, index) => <option key={version.agentsVersion} value={version.agentsVersion}>Version {index + 1}</option>)}</select></label>
          <label className="text-sm font-semibold">Candidate version<select className="field-control mt-1" value={candidateVersion} onChange={(event) => setCandidateVersion(event.target.value)}>{detail.versions.map((version, index) => <option key={version.agentsVersion} value={version.agentsVersion}>Version {index + 1}</option>)}</select></label>
        </div>
        <button type="button" className="metal-button-solid mt-4" disabled={!evaluationApi || detail.versions.length < 2 || baselineVersion === candidateVersion || comparing} onClick={compareVersions}>{comparing ? 'Comparing...' : 'Compare versions'}</button>
        {detail.versions.length < 2 && <p className="mt-3 text-sm text-neutral-600">Create and evaluate another version before comparing.</p>}
        {comparison && <div role="status" className="retro-inset mt-4 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-lg">{comparison.status}</strong><span>{comparison.coverageBps / 100}% coverage</span></div><p className="mt-2 text-sm">Baseline {comparison.baseline?.overallScore ?? 'N/A'} · Candidate {comparison.candidate?.overallScore ?? 'N/A'}</p>{comparison.findings.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm">{comparison.findings.map((finding) => <li key={`${finding.code}-${finding.dimension || ''}`}>{finding.code}{finding.dimension ? `: ${finding.dimension}` : ''}</li>)}</ul>}</div>}
      </section>
    </Modal>}
    {deleting && <Modal title={`Deactivate ${deleting.name}`} closeLabel="Cancel deactivation" onClose={() => setDeleting(null)}>
      <p>This removes the Agent from your active list. Its immutable Arc history remains public.</p>
      <label className="mt-5 block font-semibold" htmlFor="agent-delete-confirm">Type {deleting.name} to confirm</label>
      <input id="agent-delete-confirm" className="mt-2 w-full" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off"/>
      <div className="mt-5 flex justify-end gap-3"><button type="button" className="metal-button-ghost" onClick={() => setDeleting(null)}>Cancel</button><button type="button" className="metal-button-solid" disabled={confirmation !== deleting.name} onClick={confirmDeactivation}>Confirm deactivation</button></div>
    </Modal>}
  </section>;
}

function Stat({ label, value }: { label: string; value: number | null | undefined }) { return <div><dt className="text-[11px] uppercase tracking-wide text-neutral-600">{label}</dt><dd className="mt-1 text-xl font-bold">{value ?? 'N/A'}</dd></div>; }
function History({ title, rows }: { title: string; rows: string[] }) { return <section><h3 className="font-bold">{title}</h3>{rows.length ? <ul className="mt-2 space-y-2">{rows.map((row) => <li key={row} className="retro-inset p-3 text-sm">{row}</li>)}</ul> : <p className="mt-2 text-sm text-neutral-600">No activity yet.</p>}</section>; }
function Modal({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    dialog.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="agent-modal-title" className="glass-panel relative max-h-[85vh] w-full max-w-2xl overflow-auto bg-[#f8f5ee] p-6 outline-none"><button type="button" aria-label={closeLabel} className="absolute right-4 top-4 p-2" onClick={onClose}><X/></button><h2 id="agent-modal-title" className="pr-12 text-2xl font-bold">{title}</h2><div className="mt-5">{children}</div></div></div>;
}
