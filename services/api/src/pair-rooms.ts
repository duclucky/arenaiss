import { createHash, randomUUID } from 'node:crypto';
import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import type { ArenaApiService } from './service.ts';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORE = 'pair-rooms-v1';

export type PairRoomState = 'PENDING' | 'OPEN' | 'JOINING' | 'JOINED' | 'REFUNDABLE' | 'SETTLED';
export type PairEvaluationFailureCode = 'PROVIDER_ERROR' | 'GENLAYER_BUSY' | 'GENLAYER_ERROR' | 'GENLAYER_NO_CONSENSUS' | 'VERDICT_PENDING' | 'ARC_ERROR';
export type PairRoom = {
  roomId: string; creator: string; creatorWallet: string; creatorAgentId: string; creatorVersion: string;
  challenger?: string; challengerWallet?: string; challengerAgentId?: string; challengerVersion?: string;
  stake: string; joinDeadline: number; resolutionDeadline: number; state: PairRoomState;
  createTx?: string; joinTx?: string; cancelTx?: string; refundTx?: string; verdictTx?: string; settleTx?: string;
  evaluationStage?: 'QUEUED' | 'RUNNING_AGENTS' | 'WAITING_VERDICT' | 'NO_CONSENSUS' | 'RETRYING' | 'TIE_WAITING_REFUND' | 'SETTLING' | 'COMPLETE';
  evaluationFailureCode?: PairEvaluationFailureCode; evaluationAttempts?: number; retryAt?: number;
  providerRoute?: 'PRIMARY' | 'FALLBACK'; providerModel?: string;
  createdAt: number;
};
export type PairVerdictDetail = {
  schema: 'arena-pair-verdict-v1'; roomId: string; result: 'A_WIN' | 'B_WIN'; winner: 'CREATOR' | 'CHALLENGER';
  summary: string; scoreCreator: number; scoreChallenger: number; safetyClass: string;
  dimensions: Array<{ dimensionId: string; winner: 'CREATOR' | 'CHALLENGER' | 'TIE'; reason: string }>;
  policyFindingsCreator: string[]; policyFindingsChallenger: string[];
  evidence: { creatorVersion: string; challengerVersion: string; scenarioDigest: string; responseDigestCreator: string; responseDigestChallenger: string; rubricVersion: string };
  judge: { networkChainId: number; address: string; transactionHash: string };
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
      .sort((a, b) => b.createdAt - a.createdAt).map((row) => this.withProviderRoute(row));
  }

  listOpen(): PairRoom[] { return this.list().filter((room) => room.state === 'OPEN'); }

  listForPrincipal(principal: string): PairRoom[] {
    if (!principal) throw new Error('unauthorized');
    return this.list().filter((room) => room.creator === principal || room.challenger === principal);
  }

  get(roomId: string): PairRoom | null {
    if (!DIGEST.test(roomId)) throw new Error('invalid room ID');
    const row = this.runtime.get<PairRoom>(STORE, roomId);
    return row && row.state !== 'PENDING' ? this.withProviderRoute(row) : null;
  }

  private withProviderRoute(row: PairRoom): PairRoom {
    const room = structuredClone(row);
    if (room.state !== 'JOINED' && room.state !== 'SETTLED' && room.state !== 'REFUNDABLE') return room;
    const attemptId = sha(`arena-pair-attempt-v1|${room.roomId}|1`);
    const a = this.runtime.get<{ model?: string; route?: 'PRIMARY' | 'FALLBACK' }>('evaluation-tournament-provider-runs', `${attemptId}:A`);
    const b = this.runtime.get<{ model?: string; route?: 'PRIMARY' | 'FALLBACK' }>('evaluation-tournament-provider-runs', `${attemptId}:B`);
    if (a?.model && a.model === b?.model && a.route === 'PRIMARY' && b?.route === 'PRIMARY' && /^[^\s]{1,160}$/.test(a.model)) {
      room.providerRoute = 'PRIMARY'; room.providerModel = a.model;
    }
    const decision = this.runtime.get<{ model?: string }>('evaluation-tournament-provider-route', attemptId);
    if (typeof decision?.model === 'string' && /^[^\s]{1,160}$/.test(decision.model)) {
      room.providerRoute = 'FALLBACK';
      room.providerModel = decision.model;
    }
    return room;
  }

  verdict(principal: string, roomId: string): PairVerdictDetail {
    const room = this.requireRoom(roomId);
    if (principal !== room.creator && principal !== room.challenger) throw new Error('unauthorized pair verdict');
    if (room.state !== 'SETTLED' || !room.challengerVersion || !room.verdictTx) throw new Error('pair verdict is not final');
    const matchId = sha(`arena-pair-match-v1|${room.roomId}`);
    const attemptId = sha(`arena-pair-attempt-v1|${room.roomId}|1`);
    const runId = sha(`arena-comparison-run-v1|${matchId}|${attemptId}`);
    const run = this.runtime.get<any>('evaluation-comparison-runs', runId);
    const scorecard = run?.scorecard;
    if (run?.schema !== 'arena-comparison-run-v1' || run?.sourceKind !== 'RICH_TOURNAMENT'
      || run?.source?.matchId !== matchId || run?.source?.attemptId !== attemptId
      || run?.agents?.versionIdA !== room.creatorVersion || run?.agents?.versionIdB !== room.challengerVersion
      || run?.judge?.finality !== 'FINALIZED' || run?.judge?.execution !== 'SUCCESS'
      || run?.judge?.transactionHash?.toLowerCase() !== room.verdictTx.toLowerCase()
      || !Number.isSafeInteger(run?.judge?.networkChainId) || !ADDRESS.test(run?.judge?.address)
      || !['A_WIN', 'B_WIN'].includes(run?.result) || scorecard?.status !== 'FINAL' || scorecard?.result !== run.result
      || !Number.isSafeInteger(scorecard?.score_a) || !Number.isSafeInteger(scorecard?.score_b)
      || typeof scorecard?.summary !== 'string' || !scorecard.summary || typeof scorecard?.safety_class !== 'string'
      || !DIGEST.test(run?.evidence?.scenarioDigest) || !DIGEST.test(run?.evidence?.responseDigestA) || !DIGEST.test(run?.evidence?.responseDigestB)
      || run?.evidence?.rubricVersion !== 'AgentComparisonV1') throw new Error('pair verdict evidence is unavailable');
    const expectedDimensions = ['instruction_adherence', 'reasoning_quality', 'action_selection', 'rule_compliance', 'task_completion', 'safety'];
    if (!Array.isArray(scorecard.dimensions) || scorecard.dimensions.length !== expectedDimensions.length) throw new Error('pair verdict dimensions are unavailable');
    const dimensions = scorecard.dimensions.map((row: any, index: number) => {
      if (row?.dimension_id !== expectedDimensions[index] || !['A', 'B', 'TIE'].includes(row?.winner)
        || typeof row?.reason !== 'string' || !row.reason) throw new Error('pair verdict dimensions are unavailable');
      return { dimensionId: row.dimension_id, winner: row.winner === 'A' ? 'CREATOR' as const : row.winner === 'B' ? 'CHALLENGER' as const : 'TIE' as const, reason: row.reason };
    });
    return {
      schema: 'arena-pair-verdict-v1', roomId: room.roomId, result: run.result,
      winner: run.result === 'A_WIN' ? 'CREATOR' : 'CHALLENGER', summary: scorecard.summary,
      scoreCreator: scorecard.score_a, scoreChallenger: scorecard.score_b, safetyClass: scorecard.safety_class,
      dimensions, policyFindingsCreator: findingCodes(scorecard.policy_findings_a), policyFindingsChallenger: findingCodes(scorecard.policy_findings_b),
      evidence: { creatorVersion: room.creatorVersion, challengerVersion: room.challengerVersion, scenarioDigest: run.evidence.scenarioDigest,
        responseDigestCreator: run.evidence.responseDigestA, responseDigestChallenger: run.evidence.responseDigestB, rubricVersion: run.evidence.rubricVersion },
      judge: { networkChainId: run.judge.networkChainId, address: run.judge.address, transactionHash: run.judge.transactionHash },
    };
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
    if (kind === 'REQUEST_CANCEL' && row.evaluationStage && row.evaluationStage !== 'QUEUED') throw new Error('evaluation has already started');
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

function findingCodes(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('pair verdict policy findings are unavailable');
  return value.map((item) => typeof item === 'string' ? item : typeof item?.code === 'string' ? item.code : '').filter(Boolean);
}
