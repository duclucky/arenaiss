import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { AgentProfile } from '../adapters/interfaces';
import { useAppContext } from '../context';

type Room = {
  roomId: string; creator: string; challenger?: string; creatorWallet: string; challengerWallet?: string;
  creatorAgentId: string; challengerAgentId?: string; challengerVersion?: string; stake: string;
  joinDeadline: number; resolutionDeadline: number; state: 'OPEN' | 'JOINING' | 'JOINED' | 'REFUNDABLE' | 'SETTLED';
  createTx?: string; joinTx?: string; cancelTx?: string; refundTx?: string; verdictTx?: string; settleTx?: string;
  evaluationStage?: 'QUEUED' | 'RUNNING_AGENTS' | 'WAITING_VERDICT' | 'RETRYING' | 'TIE_WAITING_REFUND' | 'SETTLING' | 'COMPLETE';
  evaluationFailureCode?: 'PROVIDER_ERROR' | 'GENLAYER_BUSY' | 'GENLAYER_ERROR' | 'VERDICT_PENDING' | 'ARC_ERROR';
  evaluationAttempts?: number; retryAt?: number;
};

function failureExplanation(code?: Room['evaluationFailureCode']): string {
  if (code === 'PROVIDER_ERROR') return 'The Agent response provider did not produce both valid outputs.';
  if (code === 'GENLAYER_BUSY') return 'GenLayer has no free execution slot for this comparison.';
  if (code === 'GENLAYER_ERROR') return 'GenLayer did not accept or finalize a valid comparison.';
  if (code === 'VERDICT_PENDING') return 'The comparison was submitted and its finalized GenLayer verdict is still pending.';
  if (code === 'ARC_ERROR') return 'Arc escrow state could not be read or updated safely.';
  return 'The evaluation pipeline could not complete.';
}

function parseStake(value: string): string {
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(value)) throw new Error('Enter a positive USDC amount with up to 6 decimal places.');
  const [whole, decimal = ''] = value.split('.');
  const units = BigInt(whole) * 1_000_000n + BigInt(decimal.padEnd(6, '0') || '0');
  if (units <= 0n || units > 999_999_999_999n) throw new Error('Stake amount is outside the supported range.');
  return units.toString();
}

function units(value: string): string { const number = BigInt(value); return `${number / 1_000_000n}.${(number % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '') || '0'}`; }
function progress(room: Room): string {
  if (room.state !== 'JOINED') return room.state === 'REFUNDABLE' ? 'Refund credits are available to the depositors.' : room.state === 'SETTLED' ? 'Arc settlement is final. The winner can claim any remaining payout credit.' : '';
  if (room.evaluationStage === 'RUNNING_AGENTS') return 'Match started automatically. Both Agents are producing responses.';
  if (room.evaluationStage === 'WAITING_VERDICT') return failureExplanation(room.evaluationFailureCode);
  if (room.evaluationStage === 'RETRYING') {
    const attempts = room.evaluationAttempts ?? 1;
    if (attempts >= 3) return `${failureExplanation(room.evaluationFailureCode)} Evaluation paused after ${attempts} failed attempts. No winner was selected. Both players can approve an early refund, or refunds open after ${new Date(room.resolutionDeadline * 1_000).toLocaleString()}.`;
    return `${failureExplanation(room.evaluationFailureCode)} Automatic retry ${attempts} is scheduled${room.retryAt ? ` for ${new Date(room.retryAt * 1_000).toLocaleString()}` : ''}.`;
  }
  if (room.evaluationStage === 'TIE_WAITING_REFUND') return 'GenLayer returned a tie. Both stakes become refundable at the resolution deadline.';
  if (room.evaluationStage === 'SETTLING') return 'The verdict is final. Arc payout settlement is being confirmed.';
  return 'Both deposits are held. The match is queued to start automatically.';
}

export type PairRoomView = 'open' | 'mine' | 'completed';

export function PairMatches({ view = 'open' }: { view?: PairRoomView }) {
  const { account, managedAccount, agentApi, networkConfig } = useAppContext();
  const base = networkConfig?.apiUrl?.replace(/\/$/, '') || '';
  const [enabled, setEnabled] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [roomsError, setRoomsError] = useState('');
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentId, setAgentId] = useState('');
  const [stake, setStake] = useState('1');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [credits, setCredits] = useState<Record<string, string>>({});
  const createKey = useRef(crypto.randomUUID());

  const request = useCallback(async <T,>(path: string, body?: object): Promise<T> => {
    const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, credentials: 'include', body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Pair match request failed.');
    return result as T;
  }, [base]);

  const refresh = useCallback(async () => {
    try {
      if (view !== 'open' && !managedAccount) { setRooms([]); setRoomsError(''); return; }
      const next = await request<Room[]>(view === 'open' ? '/api/pair-rooms' : '/api/pair-rooms/mine');
      setRooms(next);
      setRoomsError('');
      const address = managedAccount?.managedWallet.address.toLowerCase();
      if (!address) { setCredits({}); return; }
      const balances = await Promise.all(next.filter((room) => (room.state === 'REFUNDABLE' || room.state === 'SETTLED')
        && (room.creatorWallet.toLowerCase() === address || room.challengerWallet?.toLowerCase() === address))
        .map(async (room) => {
          try { return [room.roomId, (await request<{ amount: string }>(`/api/pair-rooms/${room.roomId}/credit`)).amount] as const; }
          catch { return [room.roomId, '0'] as const; }
        }));
      setCredits(Object.fromEntries(balances));
    } catch (cause) {
      setRoomsError(cause instanceof Error ? cause.message : 'Could not load rooms.');
      throw cause;
    } finally { setRoomsLoaded(true); }
  }, [managedAccount, request, view]);
  useEffect(() => {
    request<{ enabled: boolean }>('/api/pair-rooms/config').then((config) => setEnabled(config.enabled)).catch(() => undefined);
    refresh().catch(() => undefined);
    const timer = window.setInterval(() => refresh().catch(() => undefined), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh, request]);
  useEffect(() => {
    if (!account || !agentApi) return;
    agentApi.listOwnedAgents().then((items) => { setAgents(items); setAgentId((current) => current || items[0]?.agentId || ''); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load Agents.'));
  }, [account, agentApi]);

  async function perform(operation: () => Promise<unknown>, message: string) {
    setPending(true); setError(''); setNotice('');
    try { await operation(); await refresh(); setNotice(message); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Pair match operation failed.'); await refresh().catch(() => undefined); }
    finally { setPending(false); }
  }

  const selected = agents.find((agent) => agent.agentId === agentId);
  const myRoom = (room: Room) => Boolean(managedAccount &&
    (room.creatorWallet.toLowerCase() === managedAccount.managedWallet.address.toLowerCase()
      || room.challengerWallet?.toLowerCase() === managedAccount.managedWallet.address.toLowerCase()));
  const myCreatedRoom = (room: Room) => Boolean(managedAccount && room.creatorWallet.toLowerCase() === managedAccount.managedWallet.address.toLowerCase());
  const myJoinedRoom = (room: Room) => Boolean(managedAccount && room.challengerWallet?.toLowerCase() === managedAccount.managedWallet.address.toLowerCase());
  const visibleRooms = rooms.filter((room) => view === 'open' ? room.state === 'OPEN'
    : view === 'mine' ? myRoom(room)
      : room.state === 'SETTLED' || room.state === 'REFUNDABLE');
  const viewCopy = view === 'open'
    ? { title: 'Open rooms', empty: 'No open rooms.' }
    : view === 'mine' ? { title: 'My rooms', empty: managedAccount ? 'You have not joined a room yet.' : 'Log in to see rooms you created or joined.' }
      : { title: 'Completed', empty: managedAccount ? 'No completed rooms yet.' : 'Log in to see rooms you created or joined.' };

  return <section className="mx-auto max-w-5xl space-y-8">
    <header><p className="page-kicker">Independent competition</p><h1 className="page-title">Pair matches</h1><p className="page-lede">Create a room with a USDC stake on Arc Testnet. A challenger deposits the same amount. The winner can claim both stakes after a finalized comparison; refunds remain claimable if the room is canceled or expires.</p></header>
    <nav className="flex flex-wrap gap-2" aria-label="Pair match views">
      {([['open', 'Open rooms'], ['mine', 'My rooms'], ['completed', 'Completed']] as const).map(([key, label]) =>
        <NavLink key={key} to={`/pairs/${key}`} className={({ isActive }) => `metal-button-ghost ${isActive ? 'is-active' : ''}`}>{label}</NavLink>)}
    </nav>
    {!enabled && <div className="glass-panel p-6" role="status">Pair matches are being prepared. Deposits are disabled until the Arc escrow is deployed and verified.</div>}
    {error && <p className="retro-inset p-4 text-red-900" role="alert">{error}</p>}
    {notice && <p className="retro-inset p-4" role="status">{notice}</p>}
    {view === 'open' && enabled && managedAccount && <form className="glass-panel space-y-4 p-6" onSubmit={(event) => { event.preventDefault(); if (!selected) return; void perform(async () => {
      await request('/api/pair-rooms', { agentId: selected.agentId, version: selected.agentsVersion, stake: parseStake(stake), idempotencyKey: createKey.current });
      createKey.current = crypto.randomUUID();
    }, 'Room created. Your USDC stake is held by the Arc escrow.'); }}>
      <h2 className="text-2xl font-semibold">Create a room</h2><label className="block text-sm font-semibold" htmlFor="pair-agent">Your Agent</label>
      <select className="field-control" id="pair-agent" value={agentId} onChange={(event) => setAgentId(event.target.value)}>{agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}</select>
      <label className="block text-sm font-semibold" htmlFor="pair-stake">Stake per player (USDC)</label><input className="field-control" id="pair-stake" inputMode="decimal" value={stake} onChange={(event) => setStake(event.target.value)} />
      <p className="text-sm text-neutral-700">The wallet approves the exact stake, then deposits it. If your Arc USDC balance is insufficient, the room will not open. You can cancel before someone joins and receive your stake back.</p>
      <button type="submit" className="metal-button-solid" disabled={pending || !selected}>Create and deposit</button>
    </form>}
    <section aria-labelledby="pair-rooms-heading"><h2 id="pair-rooms-heading" className="mb-4 text-2xl font-semibold">{viewCopy.title}</h2>
      {roomsError ? <div className="glass-panel p-6" role="alert"><p>{roomsError}</p><button type="button" className="metal-button-ghost mt-4" onClick={() => void refresh().catch(() => undefined)}>Retry rooms</button></div>
        : !roomsLoaded ? <p className="glass-panel p-6" role="status">Loading rooms…</p>
        : visibleRooms.length === 0 ? <p className="glass-panel p-6">{viewCopy.empty}</p> : <ul className="space-y-3">{visibleRooms.map((room) => <li className="glass-panel space-y-3 p-5" key={room.roomId}>
        <div className="flex flex-wrap items-center justify-between gap-3"><strong>{units(room.stake)} USDC each</strong><span className="retro-chip px-3 py-1 text-xs">{room.state}</span></div>
        <p className="break-all font-mono text-xs">Room {room.roomId}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {room.createTx && <a className="underline" href={`https://testnet.arcscan.app/tx/${room.createTx}`} target="_blank" rel="noreferrer">Creator deposit</a>}
          {room.joinTx && <a className="underline" href={`https://testnet.arcscan.app/tx/${room.joinTx}`} target="_blank" rel="noreferrer">Challenger deposit</a>}
          {room.verdictTx && <a className="underline" href={`https://explorer-studio-dev.genlayer.com/transactions/${room.verdictTx}`} target="_blank" rel="noreferrer">GenLayer verdict</a>}
          {room.settleTx && <a className="underline" href={`https://testnet.arcscan.app/tx/${room.settleTx}`} target="_blank" rel="noreferrer">Arc settlement</a>}
        </div>
        <p className="text-sm">{room.state === 'OPEN' ? `Join by ${new Date(room.joinDeadline * 1_000).toLocaleString()}.` : room.state === 'JOINING' ? 'Challenger deposit is pending Arc confirmation.' : progress(room)}</p>
        {room.evaluationFailureCode && <p className="text-xs text-neutral-700">Evaluation code: <code className="retro-chip px-2 py-1">{room.evaluationFailureCode}</code></p>}
        {enabled && managedAccount && <div className="flex flex-wrap gap-2">
          {(room.state === 'OPEN' || room.state === 'JOINING') && myCreatedRoom(room) && <button className="metal-button-ghost" disabled={pending} onClick={() => void perform(() => request(`/api/pair-rooms/${room.roomId}/actions/CANCEL`, {}), 'Room canceled. Refund was sent to your wallet or remains claimable below.')}>Cancel and refund</button>}
          {room.state === 'OPEN' && !myRoom(room) && selected && <button className="metal-button-solid" disabled={pending} onClick={() => void perform(() => request(`/api/pair-rooms/${room.roomId}/join`, { agentId: selected.agentId, version: selected.agentsVersion }), 'Joined the room. Your matching stake is held by the escrow.')}>Join and deposit</button>}
          {room.state === 'JOINING' && myJoinedRoom(room) && room.challengerAgentId && room.challengerVersion && <button className="metal-button-solid" disabled={pending} onClick={() => void perform(() => request(`/api/pair-rooms/${room.roomId}/join`, { agentId: room.challengerAgentId, version: room.challengerVersion }), 'Arc join status refreshed.')}>Retry join confirmation</button>}
          {room.state === 'JOINED' && myRoom(room) && <button className="metal-button-ghost" disabled={pending} onClick={() => void perform(() => request(`/api/pair-rooms/${room.roomId}/actions/REQUEST_CANCEL`, {}), 'Cancellation requested. Both players must agree for an early refund.')}>Request mutual cancellation</button>}
          {(room.state === 'OPEN' || room.state === 'JOINING' || room.state === 'JOINED') && (myRoom(room) || room.state === 'OPEN') && Date.now() / 1_000 >= (room.state === 'JOINED' ? room.resolutionDeadline : room.joinDeadline) && <button className="metal-button-ghost" disabled={pending} onClick={() => void perform(() => request(`/api/pair-rooms/${room.roomId}/actions/EXPIRE`, {}), 'Deadline passed. Refunds are claimable.')}>Open timeout refunds</button>}
          {(room.state === 'REFUNDABLE' || room.state === 'SETTLED') && myRoom(room) && BigInt(credits[room.roomId] || '0') > 0n && <button className="metal-button-solid" disabled={pending} onClick={() => void perform(() => request(`/api/pair-rooms/${room.roomId}/actions/WITHDRAW`, {}), 'Available USDC credit was transferred to your wallet.')}>Claim {units(credits[room.roomId])} USDC</button>}
        </div>}
      </li>)}</ul>}
    </section>
  </section>;
}
