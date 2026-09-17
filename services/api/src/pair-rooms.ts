import { createHash, randomUUID } from 'node:crypto';
import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import type { ArenaApiService } from './service.ts';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORE = 'pair-rooms-v1';

export type PairRoomState = 'PENDING' | 'OPEN' | 'JOINING' | 'JOINED' | 'REFUNDABLE' | 'SETTLED';
export type PairRoom = {
  roomId: string; creator: string; creatorWallet: string; creatorAgentId: string; creatorVersion: string;
  challenger?: string; challengerWallet?: string; challengerAgentId?: string; challengerVersion?: string;
  stake: string; joinDeadline: number; resolutionDeadline: number; state: PairRoomState;
  createTx?: string; joinTx?: string; cancelTx?: string; refundTx?: string; verdictTx?: string; settleTx?: string;
  evaluationStage?: 'QUEUED' | 'RUNNING_AGENTS' | 'WAITING_VERDICT' | 'RETRYING' | 'TIE_WAITING_REFUND' | 'SETTLING' | 'COMPLETE';
  evaluationAttempts?: number; retryAt?: number;
  createdAt: number;
};
export type ChainRoom = {
  creator: string; challenger: string; creatorAgentVersion: string; challengerAgentVersion: string;
  stake: bigint; joinDeadline: number; resolutionDeadline: number; state: number; winner: string; verdictDigest?: string;
};
export interface PairChainPort {
  readonly escrowAddress: string;
  assertReady(): Promise<void>;
  balanceOf(wallet: string): Promise<bigint>;
  getRoom(roomId: string): Promise<ChainRoom>;
  creditOf(roomId: string, wallet: string): Promise<bigint>;
}
export interface PairWalletPort {
  account(userId: string): Promise<{ address: string }>;
  create(userId: string, input: { escrowAddress: string; roomId: string; version: string; stake: string; joinDeadline: number; resolutionDeadline: number; approvalKey: string; executionKey: string }): Promise<{ txHash?: string }>;
  join(userId: string, input: { escrowAddress: string; roomId: string; version: string; stake: string; approvalKey: string; executionKey: string }): Promise<{ txHash?: string }>;
  action(userId: string, input: { escrowAddress: string; roomId: string; kind: 'CANCEL' | 'REQUEST_CANCEL' | 'EXPIRE' | 'WITHDRAW'; executionKey: string }): Promise<{ txHash?: string }>;
}

type IntentKeys = { approvalKey: string; executionKey: string };
type JoinIntent = { principal: string; wallet: string; agentId: string; version: string };
function sha(value: string): string { return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`; }
function sameAddress(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase(); }
function bytes32(value: string): string { return `0x${value.slice(7)}`; }

export class PairRoomCoordinator {
  private readonly runtime: SqliteRuntimeStore;
  private readonly agents: ArenaApiService;
  private readonly wallet: PairWalletPort;
  private readonly chain: PairChainPort;
  private readonly now: () => number;

  constructor(
    runtime: SqliteRuntimeStore,
    agents: ArenaApiService,
    wallet: PairWalletPort,
    chain: PairChainPort,
    now: () => number = () => Math.floor(Date.now() / 1_000),
  ) {
    if (!ADDRESS.test(chain.escrowAddress)) throw new Error('pair escrow address is invalid');
    this.runtime = runtime;
    this.agents = agents;
    this.wallet = wallet;
    this.chain = chain;
    this.now = now;
  }

  list(): PairRoom[] {
    return this.runtime.list<PairRoom>(STORE).filter((row) => row.state !== 'PENDING')
      .sort((a, b) => b.createdAt - a.createdAt).map((row) => structuredClone(row));
  }

  listOpen(): PairRoom[] { return this.list().filter((room) => room.state === 'OPEN'); }

  listForPrincipal(principal: string): PairRoom[] {
    if (!principal) throw new Error('unauthorized');
    return this.list().filter((room) => room.creator === principal || room.challenger === principal);
  }

  get(roomId: string): PairRoom | null {
    if (!DIGEST.test(roomId)) throw new Error('invalid room ID');
    const row = this.runtime.get<PairRoom>(STORE, roomId);
    return row && row.state !== 'PENDING' ? structuredClone(row) : null;
  }

  async ready(): Promise<boolean> {
    try { await this.chain.assertReady(); return true; } catch { return false; }
  }

  async credit(userId: string, principal: string, roomId: string): Promise<string> {
    const room = this.requireRoom(roomId);
    if (principal !== room.creator && principal !== room.challenger) throw new Error('unauthorized room credit');
    const account = await this.wallet.account(userId);
    if (!sameAddress(account.address, room.creatorWallet) && !sameAddress(account.address, room.challengerWallet ?? '')) throw new Error('unauthorized room wallet');
    return (await this.chain.creditOf(roomId, account.address)).toString();
  }

  async create(userId: string, principal: string, input: { agentId: string; version: string; stake: string; idempotencyKey: string }): Promise<PairRoom> {
    if (!DIGEST.test(input.agentId) || !DIGEST.test(input.version) || !/^[1-9][0-9]{0,11}$/.test(input.stake)
      || !UUID_V4.test(input.idempotencyKey)) throw new Error('invalid pair room request');
    this.agents.getAgentVersion(principal, input.agentId as `sha256:${string}`, input.version as `sha256:${string}`);
    await this.chain.assertReady();
    const roomId = sha(`arena-pair-room-v1|5042002|${this.chain.escrowAddress.toLowerCase()}|${principal}|${input.idempotencyKey.toLowerCase()}`);
    const account = await this.wallet.account(userId);
    if (!ADDRESS.test(account.address)) throw new Error('pair room wallet is invalid');
    const prior = this.runtime.get<PairRoom>(STORE, roomId);
    if (prior && (prior.creator !== principal || prior.creatorAgentId !== input.agentId || prior.creatorVersion !== input.version
      || prior.stake !== input.stake || !sameAddress(prior.creatorWallet, account.address))) throw new Error('conflicting pair room request');
    if (prior && prior.state !== 'PENDING') return structuredClone(prior);
    const stake = BigInt(input.stake);
    if (!prior && await this.chain.balanceOf(account.address) < stake) throw new Error('insufficient Arc USDC balance');
    const now = this.now();
    let intent: PairRoom = prior ?? {
      roomId, creator: principal, creatorWallet: account.address, creatorAgentId: input.agentId, creatorVersion: input.version,
      stake: input.stake, joinDeadline: now + 86_400, resolutionDeadline: now + 7 * 86_400,
      state: 'PENDING', createdAt: now,
    };
    if (!this.runtime.putIfAbsent(STORE, roomId, intent)) {
      const persisted = this.runtime.get<PairRoom>(STORE, roomId)!;
      if (persisted.creator !== principal || persisted.creatorAgentId !== input.agentId || persisted.creatorVersion !== input.version
        || persisted.stake !== input.stake || !sameAddress(persisted.creatorWallet, account.address)) throw new Error('conflicting pair room request');
      intent = persisted;
    }
    if (intent.createTx) {
      const existing = await this.chain.getRoom(roomId);
      if (existing.state === 1 && sameAddress(existing.creator, account.address) && existing.stake === stake
        && existing.creatorAgentVersion.toLowerCase() === bytes32(input.version)
        && existing.joinDeadline === intent.joinDeadline && existing.resolutionDeadline === intent.resolutionDeadline) {
        const created = { ...intent, state: 'OPEN' as const };
        this.runtime.put(STORE, roomId, created);
        return structuredClone(created);
      }
      throw new Error('Arc room creation requires reconciliation');
    }
    const keys = this.keys(`${roomId}:create`);
    const submitted = await this.wallet.create(userId, { escrowAddress: this.chain.escrowAddress, roomId, version: input.version, stake: input.stake, joinDeadline: intent.joinDeadline, resolutionDeadline: intent.resolutionDeadline, ...keys });
    if (!submitted.txHash || !TX.test(submitted.txHash)) throw new Error('Arc room creation transaction is unknown');
    this.runtime.put(STORE, roomId, { ...intent, createTx: submitted.txHash });
    const onchain = await this.chain.getRoom(roomId);
    if (onchain.state !== 1 || !sameAddress(onchain.creator, account.address) || onchain.stake !== stake
      || onchain.creatorAgentVersion.toLowerCase() !== bytes32(input.version) || onchain.joinDeadline !== intent.joinDeadline
      || onchain.resolutionDeadline !== intent.resolutionDeadline) throw new Error('Arc room creation requires reconciliation');
    const created: PairRoom = { ...intent, state: 'OPEN', createTx: submitted.txHash };
    this.runtime.put(STORE, roomId, created);
    return structuredClone(created);
  }

  async join(userId: string, principal: string, roomId: string, agentId: string, version: string): Promise<PairRoom> {
    const row = this.requireRoom(roomId);
    await this.chain.assertReady();
    if (!DIGEST.test(agentId) || !DIGEST.test(version) || principal === row.creator || (row.state !== 'OPEN' && row.state !== 'JOINING')) throw new Error('room is not open for this Agent');
    if (row.state === 'JOINING' && (row.challenger !== principal || row.challengerAgentId !== agentId || row.challengerVersion !== version)) throw new Error('room join is already pending');
    this.agents.getAgentVersion(principal, agentId as `sha256:${string}`, version as `sha256:${string}`);
    const account = await this.wallet.account(userId);
    if (!ADDRESS.test(account.address) || sameAddress(account.address, row.creatorWallet)) throw new Error('challenger wallet is invalid');
    if (row.state === 'JOINING' && !sameAddress(row.challengerWallet ?? '', account.address)) throw new Error('room join wallet changed');
    const onchain = await this.chain.getRoom(roomId);
    if (onchain.state === 2 && row.joinTx && sameAddress(onchain.challenger, account.address)
      && onchain.challengerAgentVersion.toLowerCase() === bytes32(version)
      && sameAddress(onchain.creator, row.creatorWallet) && onchain.stake === BigInt(row.stake)) {
      const joined: PairRoom = { ...row, state: 'JOINED', evaluationStage: 'QUEUED' };
      this.runtime.put(STORE, roomId, joined);
      return structuredClone(joined);
    }
    if (onchain.state !== 1 && !(row.state === 'JOINING' && !row.joinTx && onchain.state === 2
      && sameAddress(onchain.challenger, account.address) && onchain.challengerAgentVersion.toLowerCase() === bytes32(version))) throw new Error('room is closed on Arc');
    if (onchain.state === 1 && this.now() >= onchain.joinDeadline) throw new Error('room is closed on Arc');
    if (row.state === 'OPEN' && await this.chain.balanceOf(account.address) < BigInt(row.stake)) throw new Error('insufficient Arc USDC balance');
    const joinIntent: JoinIntent = { principal, wallet: account.address, agentId, version };
    this.runtime.putIfAbsent('pair-room-join-intents', roomId, joinIntent);
    const reserved = this.runtime.get<JoinIntent>('pair-room-join-intents', roomId)!;
    if (reserved.principal !== principal || !sameAddress(reserved.wallet, account.address)
      || reserved.agentId !== agentId || reserved.version !== version) throw new Error('room join is already pending');
    const pending: PairRoom = row.state === 'JOINING' ? row : { ...row, challenger: principal, challengerWallet: account.address, challengerAgentId: agentId, challengerVersion: version, state: 'JOINING' };
    if (row.state === 'OPEN') this.runtime.put(STORE, roomId, pending);
    const keys = this.keys(`${roomId}:join:${principal}`);
    const submitted = await this.wallet.join(userId, { escrowAddress: this.chain.escrowAddress, roomId, version, stake: row.stake, ...keys });
    if (!submitted.txHash || !TX.test(submitted.txHash)) throw new Error('Arc room join transaction is unknown');
    this.runtime.put(STORE, roomId, { ...pending, joinTx: submitted.txHash });
    const confirmed = await this.chain.getRoom(roomId);
    if (confirmed.state !== 2 || !sameAddress(confirmed.challenger, account.address)
      || confirmed.challengerAgentVersion.toLowerCase() !== bytes32(version)
      || !sameAddress(confirmed.creator, row.creatorWallet) || confirmed.stake !== BigInt(row.stake)) throw new Error('Arc room join requires reconciliation');
    const joined: PairRoom = { ...pending, joinTx: submitted.txHash, state: 'JOINED', evaluationStage: 'QUEUED' };
    this.runtime.put(STORE, roomId, joined);
    return structuredClone(joined);
  }

  async action(userId: string, principal: string, roomId: string, kind: 'CANCEL' | 'REQUEST_CANCEL' | 'EXPIRE' | 'WITHDRAW'): Promise<PairRoom> {
    const row = this.requireRoom(roomId);
    await this.chain.assertReady();
    if (kind !== 'EXPIRE' && principal !== row.creator && principal !== row.challenger) throw new Error('unauthorized room action');
    if (kind === 'CANCEL') {
      if (principal !== row.creator || (row.state !== 'OPEN' && row.state !== 'JOINING')) throw new Error('only the creator may cancel an open room');
      if ((await this.chain.getRoom(roomId)).state !== 1) throw new Error('room is closed on Arc');
    }
    if (kind === 'REQUEST_CANCEL' && row.state !== 'JOINED') throw new Error('room is not joined');
    const account = await this.wallet.account(userId);
    if (kind === 'WITHDRAW' && await this.chain.creditOf(roomId, account.address) === 0n) throw new Error('no pair room credit');
    const submitted = await this.wallet.action(userId, { escrowAddress: this.chain.escrowAddress, roomId, kind, executionKey: this.keys(`${roomId}:${kind}:${principal}`).executionKey });
    if (!submitted.txHash || !TX.test(submitted.txHash)) throw new Error('Arc room action transaction is unknown');
    const chain = await this.chain.getRoom(roomId);
    const updated: PairRoom = { ...row, ...(chain.state === 4 ? { state: 'REFUNDABLE' as const } : {}), ...(chain.state === 3 ? { state: 'SETTLED' as const } : {}), ...(kind === 'CANCEL' ? { cancelTx: submitted.txHash } : {}), ...(kind === 'WITHDRAW' ? { refundTx: submitted.txHash } : {}) };
    this.runtime.put(STORE, roomId, updated);
    if (kind === 'CANCEL' && chain.state === 4 && await this.chain.creditOf(roomId, account.address) > 0n) {
      try { return await this.action(userId, principal, roomId, 'WITHDRAW'); }
      catch { /* Refund stays claimable from escrow; caller can retry withdrawal. */ }
    }
    return structuredClone(updated);
  }

  private requireRoom(roomId: string): PairRoom {
    const room = this.get(roomId);
    if (!room) throw new Error('pair room not found');
    return room;
  }
  private keys(key: string): IntentKeys {
    this.runtime.putIfAbsent('pair-room-keys', key, { approvalKey: randomUUID(), executionKey: randomUUID() });
    return this.runtime.get<IntentKeys>('pair-room-keys', key)!;
  }
}
