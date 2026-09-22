import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useAppContext } from '../context';
import type { AgentProfile } from '../adapters/interfaces';
import { displayLabel } from '../display-label';

type FlowState = 'IDLE' | 'PREPARING' | 'APPROVING' | 'REGISTERING' | 'VERIFYING' | 'CONFIRMED';

export function SubmitEntry() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { account, managedAccount, managedIdentity, agentApi, arenaRead, networkConfig, wallet, capabilities } = useAppContext();
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [registeredCount, setRegisteredCount] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [flow, setFlow] = useState<FlowState>('IDLE');
  const [error, setError] = useState('');
  const [stake, setStake] = useState<string | null>(null);
  const [registrationClosed, setRegistrationClosed] = useState(false);

  useEffect(() => {
    if (!account || !agentApi) { setAgents([]); setSelectedAgentId(''); setRegistrationClosed(false); return; }
    let active = true;
    setLoading(true); setError('');
    Promise.all([agentApi.listOwnedAgents(), agentApi.listOwnedRegistrations().catch(() => []), id ? arenaRead.getTournament(id).catch(() => null) : Promise.resolve(null)])
      .then(([items, registrations, tournament]) => { if (active) {
        const confirmed = new Set((tournament?.entrantIds || []).map((entrant) => entrant.toLowerCase().replace(/^sha256:/, '0x')));
        const alreadyEntered = new Set(registrations.filter((row) => confirmed.has(row.entrantId.toLowerCase())).map((row) => row.agentId?.toLowerCase().replace(/^0x/, 'sha256:')));
        const available = items.filter((agent) => !alreadyEntered.has(agent.agentId.toLowerCase()));
        const closed = Boolean(tournament && (tournament.status !== 'UPCOMING' || (tournament.registrationClosesAt && Date.now() >= tournament.registrationClosesAt * 1_000)));
        setRegisteredCount(items.length - available.length); setAgents(available); setSelectedAgentId((current) => available.some((agent) => agent.agentId === current) ? current : available[0]?.agentId || ''); setStake(tournament?.stakeAmount ?? null); setRegistrationClosed(closed);
      } })
      .catch((reason) => { if (active) setError(messageOf(reason, 'Could not load your agents.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account, agentApi, arenaRead, id]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!capabilities.tournament.registrationEnabled) { setError('Tournament registration is currently disabled. No wallet signature was requested.'); return; }
    if (registrationClosed) { setError('Registration is closed. No wallet signature was requested.'); return; }
    if (!id || !account || !agentApi || !networkConfig || !selectedAgentId) { setError('Connect a wallet, configure Arc, and select an agent.'); return; }
    try {
      if (managedAccount) {
        if (!managedIdentity?.registerTournamentEntrant) throw new Error('Managed Tournament registration is unavailable.');
        setFlow('REGISTERING');
        const transaction = await managedIdentity.registerTournamentEntrant(id, selectedAgentId);
        if (transaction.state !== 'COMPLETE' || !transaction.txHash) throw new Error('Managed registration did not complete on Arc.');
        setFlow('CONFIRMED');
        return;
      }
      setFlow('PREPARING');
      const prepared = await agentApi.prepareRegistration(id, selectedAgentId);
      setStake(prepared.stakeAmount);
      const balance = BigInt(await wallet.getBalance(account, networkConfig));
      if (balance < BigInt(prepared.stakeAmount)) throw new Error(`Insufficient USDC. Required stake: ${formatUsdc(prepared.stakeAmount)} USDC.`);
      const allowance = BigInt(await wallet.getAllowance(account, networkConfig));
      if (allowance < BigInt(prepared.stakeAmount)) {
        setFlow('APPROVING');
        const approval = await wallet.approveEscrow(prepared.stakeAmount, networkConfig);
        if (await wallet.waitForTransaction(approval.hash, networkConfig) !== 'CONFIRMED') throw new Error('USDC approval failed on Arc.');
      }
      setFlow('REGISTERING');
      const registration = await wallet.registerEntrant(prepared, networkConfig);
      if (await wallet.waitForTransaction(registration.hash, networkConfig) !== 'CONFIRMED') throw new Error('Registration transaction failed on Arc.');
      setFlow('VERIFYING');
      const canonical = await wallet.getEntrant(prepared.tournamentId, prepared.entrantId, networkConfig);
      const matches = canonical.registered
        && canonical.wallet.toLowerCase() === account.toLowerCase()
        && canonical.agentId.toLowerCase() === prepared.agentId.toLowerCase()
        && canonical.agentsVersion.toLowerCase() === prepared.agentsVersion.toLowerCase()
        && canonical.agentsCommitment.toLowerCase() === prepared.agentsCommitment.toLowerCase();
      if (!matches) throw new Error('Arc receipt confirmed, but canonical entrant state does not match.');
      setFlow('CONFIRMED');
    } catch (reason) { setFlow('IDLE'); setError(messageOf(reason, 'Registration failed.')); }
  }

  const pending = !['IDLE', 'CONFIRMED'].includes(flow);
  return <section className="mx-auto max-w-3xl space-y-7">
    <Link to={`/tournaments/${id}`} className="inline-flex min-h-11 items-center gap-2 rounded text-sm text-neutral-700 focus:outline-none focus:ring-2 focus:ring-black"><ArrowLeft size={16} aria-hidden="true" /> Back to tournament</Link>
    <div className="appear"><p className="page-kicker">Arc entry</p><h1 className="page-title">Enter tournament</h1><p className="page-lede">Choose an existing AGENTS.md profile. Arc registers its commitment with your stake. Tournament model calls and GenLayer comparison submit the exact profile bytes.</p></div>

    {!networkConfig && <div className="glass-panel flex gap-3 rounded-2xl border-red-800/40 p-4"><ShieldAlert className="shrink-0 text-red-900" size={20} aria-hidden="true" /><div><h2 className="font-semibold text-red-900">Network Not Configured</h2><p className="mt-1 text-sm text-neutral-700">Live Arc actions are disabled until runtime network settings are complete.</p></div></div>}
    {!capabilities.tournament.registrationEnabled && <div role="alert" className="glass-panel flex gap-3 rounded-2xl border-amber-800/40 p-4 text-amber-950"><AlertCircle className="shrink-0" size={20} aria-hidden="true" /><div><p className="font-semibold">Tournament registration is unavailable.</p><p className="mt-1 text-sm">No approval, signature, or deposit will be requested while this capability is disabled.</p></div></div>}
    {registrationClosed && <div role="alert" className="glass-panel flex gap-3 rounded-2xl border-amber-800/40 p-4 text-amber-950"><AlertCircle className="shrink-0" size={20} aria-hidden="true" /><div><p className="font-semibold">Registration is closed.</p><p className="mt-1 text-sm">This Tournament no longer accepts signatures or deposits.</p></div></div>}
    {error && <div role="alert" className="glass-panel flex gap-3 rounded-2xl border-red-800/40 p-4 text-red-900"><AlertCircle className="shrink-0" size={20} aria-hidden="true" /><p>{displayLabel(error)}</p></div>}
    {flow === 'CONFIRMED' && <div role="status" className="glass-panel flex gap-3 rounded-2xl border-emerald-800/35 p-4 text-emerald-900"><CheckCircle2 className="shrink-0" size={20} aria-hidden="true" /><div><p className="font-semibold">Registration confirmed on Arc.</p>{stake && <p className="mt-1 text-sm text-neutral-700">Locked stake: {formatUsdc(stake)} USDC.</p>}</div></div>}

    <form onSubmit={submit} className="glass-panel space-y-6 rounded-[28px] p-6 md:p-8">
      <div><label htmlFor="agent" className="mb-2 block text-sm font-semibold">Agent</label><select id="agent" className="field-control" value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)} disabled={!account || !agentApi || loading || pending}><option value="">{!account ? 'Connect a wallet first' : loading ? 'Loading agents…' : agents.length ? 'Select an agent' : 'No agents available'}</option>{agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}</select><p className="mt-2 text-sm text-neutral-600">The latest immutable version and commitment are resolved by the authenticated backend.</p></div>
      <div className="grid gap-3 border-y border-black/15 py-5 text-sm sm:grid-cols-3"><div><p className="text-neutral-600">Stake</p><p className="mt-1 font-semibold">{stake ? `${formatUsdc(stake)} USDC` : 'Set by tournament'}</p></div><div><p className="text-neutral-600">Platform fee</p><p className="mt-1">10% of final pool</p></div><div><p className="text-neutral-600">Settlement</p><p className="mt-1">Pull-based USDC credit</p></div></div>
      <p role={managedAccount ? 'status' : undefined} className="text-sm text-neutral-700">{managedAccount ? 'Arena will submit the approval and registration through your managed wallet.' : 'Your wallet may ask for an approval and a registration signature.'}</p>
      <p className="text-xs leading-relaxed text-neutral-600">Trusted-operator disclosure: the platform controls model calls, match mapping, and bracket progression. Arc independently enforces registration and payout accounting.</p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={() => navigate(`/tournaments/${id}`)} className="metal-button-ghost">Cancel</button>{!networkConfig || !capabilities.tournament.registrationEnabled ? <button type="button" disabled className="metal-button-solid">Submit to Arena (Disabled)</button> : <button type="submit" disabled={registrationClosed || !account || !agentApi || !selectedAgentId || pending || flow === 'CONFIRMED' || (Boolean(managedAccount) && !managedIdentity?.registerTournamentEntrant)} className="metal-button-solid min-w-44">{registrationClosed ? 'Registration closed' : managedAccount && flow === 'IDLE' ? 'Enter with managed wallet' : flowLabel(flow)}</button>}</div>
      {account && agents.length === 0 && !loading && <p className="text-center text-sm text-neutral-700">{registeredCount > 0 ? 'Your available Agents have already entered this Tournament.' : <>No AGENTS.md profile yet. <Link to="/agents/new" className="underline decoration-neutral-600 underline-offset-4 hover:decoration-black">Create an agent</Link>.</>}</p>}
    </form>
  </section>;
}

function flowLabel(state: FlowState) {
  return { IDLE: 'Approve and enter', PREPARING: 'Preparing…', APPROVING: 'Approving USDC…', REGISTERING: 'Registering…', VERIFYING: 'Verifying on Arc…', CONFIRMED: 'Entered' }[state];
}

function formatUsdc(baseUnits: string) {
  const value = BigInt(baseUnits); const whole = value / 1_000_000n; const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}.00`;
}

function messageOf(reason: unknown, fallback: string) { return reason instanceof Error && reason.message ? reason.message : fallback; }
