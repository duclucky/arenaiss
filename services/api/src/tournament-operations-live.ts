import { createHash } from 'node:crypto';
import { createPublicClient, createWalletClient, formatUnits, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';

import { buildBracket } from '../../../packages/domain/src/bracket.ts';
import { TournamentEvaluationPairRunner, TournamentComparisonJudgeAdapter } from '../../../packages/evaluation/src/tournament-runner.ts';
import { OpenAICompatibleEvaluationProvider } from '../../../packages/evaluation/src/provider.ts';
import { ComparisonRunRegistry } from '../../../packages/evaluation/src/tournament-comparison.ts';
import { ComparisonRunTracker, PersistentComparisonSubmissionStore } from '../../../packages/genlayer/src/comparison-tracker.ts';
import { createStudioNextComparisonJudgePort } from '../../../packages/genlayer/src/comparison-sdk-port.ts';
import { TournamentOrchestrator, type Entrant, type OrchestratorResult } from '../../../packages/orchestrator/src/orchestrator.ts';
import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import type { ArenaApiService, TournamentOperatorEntrant } from './service.ts';
import type { CreateTournamentOperation, TournamentOperationAction, TournamentOperationSnapshot, TournamentOperationState, TournamentOperationsPort } from './tournament-operations.ts';

const ARC_CHAIN_ID = 5_042_002;
const GENLAYER_CHAIN_ID = 61_997;
const ZERO = `0x${'0'.repeat(64)}`;
const PAYOUT_BPS = [4_000, 2_500, 1_500, 1_000, 1_000] as const;
const DEFAULT_TOPICS = [
  'Explain how an idempotency key prevents duplicate effects when a paid API call is retried.',
  'Describe how escrow prevents duplicate settlement while keeping payout accounting auditable.',
  'Explain the difference between transaction acceptance and finality on a blockchain.',
  'Explain why binding a verdict to exact input digests improves auditability.',
  'Describe one practical defense against replay attacks in signed messages.',
  'Explain how a Merkle proof establishes inclusion without downloading the full data set.',
] as const;

const TOURNAMENT_ABI = parseAbi([
  'function owner() view returns (address)',
  'function getTournament(bytes32) view returns ((uint64 registrationOpensAt,uint64 registrationClosesAt,uint64 startsAt,uint64 expiresAt,uint32 minEntrants,uint32 maxEntrants,uint128 stakeAmount,address operatorAddress,address feeRecipient,uint16[5] payoutBps) policy,uint8 state,uint32 entrantCount,uint256 totalLockedStakes,uint256 totalLiability,uint256 platformFeeCredit,bytes32 rankingDigest,uint256 settlementNonce)',
  'function getEntrant(bytes32,bytes32) view returns (address wallet,bytes32 agentId,bytes32 agentsVersion,bytes32 agentsCommitment,bool registered,bool ranked)',
  'function createTournament(bytes32,(uint64 registrationOpensAt,uint64 registrationClosesAt,uint64 startsAt,uint64 expiresAt,uint32 minEntrants,uint32 maxEntrants,uint128 stakeAmount,address operatorAddress,address feeRecipient,uint16[5] payoutBps))',
  'function closeRegistration(bytes32)',
  'function markRunning(bytes32)',
  'function settleByOperator(bytes32,bytes32[],bytes32,uint256)',
  'function cancelAndOpenRefunds(bytes32,bytes32)',
]);

type ArcState = 'DRAFT' | 'REGISTRATION_CLOSED' | 'RUNNING' | 'SETTLED' | 'CANCELLED_REFUNDABLE' | 'CLOSED';
type ArcSnapshot = { state: ArcState; entrantCount: number; totalLockedStakes: string; totalLiability: string; transactionHash?: string };
export interface TournamentArcOperations {
  create(input: CreateTournamentOperation): Promise<ArcSnapshot>;
  snapshot(tournamentId: string): Promise<ArcSnapshot>;
  registeredEntrants(tournamentId: string, candidates: readonly TournamentOperatorEntrant[]): Promise<TournamentOperatorEntrant[]>;
  closeRegistration(tournamentId: string): Promise<ArcSnapshot>;
  markRunning(tournamentId: string): Promise<ArcSnapshot>;
  settle(tournamentId: string, ranking: readonly string[], rankingDigest: string, nonce: number): Promise<ArcSnapshot>;
  refund(tournamentId: string, reasonDigest: string): Promise<ArcSnapshot>;
}

type OperationRecord = {
  input: CreateTournamentOperation;
  state: TournamentOperationState;
  ranking?: string[];
  finalizedMatchCount: number;
  transactionHash?: string;
  message?: string;
};

export class LiveTournamentOperations implements TournamentOperationsPort {
  private readonly runtime: SqliteRuntimeStore;
  private readonly service: ArenaApiService;
  private readonly operatorAddress: string;
  private readonly arc: TournamentArcOperations;
  private readonly orchestrator: TournamentOrchestrator;
  private readonly now: () => number;
  private readonly topics: readonly string[];
  constructor(
    runtime: SqliteRuntimeStore,
    service: ArenaApiService,
    operatorAddress: string,
    arc: TournamentArcOperations,
    orchestrator: TournamentOrchestrator,
    now: () => number = () => Math.floor(Date.now() / 1_000),
    topics: readonly string[] = DEFAULT_TOPICS,
  ) { this.runtime = runtime; this.service = service; this.operatorAddress = operatorAddress; this.arc = arc; this.orchestrator = orchestrator; this.now = now; this.topics = topics; }

  async list(): Promise<TournamentOperationSnapshot[]> {
    const rows = this.runtime.list<OperationRecord>('tournament-operations');
    return Promise.all(rows.map((row) => this.refresh(row)));
  }

  async get(tournamentId: string): Promise<TournamentOperationSnapshot | null> {
    const row = this.runtime.get<OperationRecord>('tournament-operations', tournamentId);
    return row ? this.refresh(row) : null;
  }

  async create(input: CreateTournamentOperation): Promise<TournamentOperationSnapshot> {
    if (this.runtime.get('tournament-operations', input.tournamentId)) throw new Error('tournament operation already exists');
    const arc = await this.arc.create(input);
    const record: OperationRecord = { input: structuredClone(input), state: 'REGISTRATION', finalizedMatchCount: 0, transactionHash: arc.transactionHash };
    this.runtime.put('tournament-operations', input.tournamentId, record);
    this.publish(record, arc, []);
    return this.toSnapshot(record, arc, []);
  }

  async execute({ tournamentId, action }: { tournamentId: string; action: TournamentOperationAction }): Promise<TournamentOperationSnapshot> {
    const record = this.runtime.get<OperationRecord>('tournament-operations', tournamentId);
    if (!record) throw new Error('tournament operation not found');
    const leaseOwner = `api:${process.pid}`;
    if (this.runtime.claimLease('tournament-operation-leases', tournamentId, tournamentId, leaseOwner, Date.now(), 10 * 60_000) === 'BUSY') throw new Error('tournament operation is already running');
    try {
      if (action === 'PROGRESS') await this.progress(record);
      else if (action === 'SETTLE') await this.settle(record);
      else if (action === 'EXPIRE' || action === 'REFUND') await this.refund(record, action === 'EXPIRE' ? 'TOURNAMENT_EXPIRED' : 'TOURNAMENT_REFUND');
      this.runtime.put('tournament-operations', tournamentId, record);
      return this.refresh(record);
    } finally {
      this.runtime.releaseLease('tournament-operation-leases', tournamentId, leaseOwner);
    }
  }

  private async progress(record: OperationRecord): Promise<void> {
    let arc = await this.arc.snapshot(record.input.tournamentId);
    if (arc.state === 'DRAFT' && this.now() >= record.input.registrationClosesAt) arc = await this.arc.closeRegistration(record.input.tournamentId);
    if (arc.state === 'REGISTRATION_CLOSED') {
      if (arc.entrantCount < record.input.minEntrants) {
        record.state = 'REFUND_PENDING'; record.message = 'Registration closed below the minimum entrant count.'; return;
      }
      if (this.now() < record.input.startsAt) { record.state = 'REGISTRATION'; record.message = 'Registration is closed. Waiting for the configured start time.'; return; }
      arc = await this.arc.markRunning(record.input.tournamentId);
    }
    if (arc.state !== 'RUNNING') { this.applyArcTerminal(record, arc); return; }
    const candidates = this.service.listTournamentOperatorEntrants(this.operatorAddress, record.input.tournamentId as `sha256:${string}`);
    const registered = await this.arc.registeredEntrants(record.input.tournamentId, candidates);
    if (registered.length !== arc.entrantCount || registered.length < record.input.minEntrants) throw new Error('Arc roster and API registration bindings do not match');
    const entrants: Entrant[] = registered.map((item) => ({ entrantId: fromBytes32(item.entrantId), agentId: fromBytes32(item.agentId), agentsVersion: fromBytes32(item.agentsVersion), agentsCommitment: fromBytes32(item.agentsCommitment), agentsMd: item.agentsMd }));
    const result = await this.orchestrator.run({ tournamentId: record.input.tournamentId as `sha256:${string}`, seedDigest: digest(`${record.input.tournamentId}|arena-production-seed-v1`), entrants, topics: this.topics, bracketRevision: 1, retryCap: 3, expiresAt: record.input.expiresAt, now: this.now });
    this.applyOrchestrator(record, result, entrants.length);
    this.publish(record, arc, registered.map((item) => fromBytes32(item.entrantId)));
  }

  private async settle(record: OperationRecord): Promise<void> {
    if (!record.ranking || record.ranking.length !== 5) throw new Error('canonical tournament ranking is unavailable');
    const rankingDigest = digest(JSON.stringify(record.ranking));
    const arc = await this.arc.settle(record.input.tournamentId, record.ranking, rankingDigest, 1);
    this.applyArcTerminal(record, arc);
  }

  private async refund(record: OperationRecord, reason: string): Promise<void> {
    const arc = await this.arc.refund(record.input.tournamentId, digest(reason));
    this.applyArcTerminal(record, arc);
  }

  private applyOrchestrator(record: OperationRecord, result: OrchestratorResult, entrantCount: number): void {
    if (result.state === 'RANKING_READY') {
      record.ranking = [...result.ranking]; record.finalizedMatchCount = result.results.size; record.state = 'SETTLEMENT_PENDING'; record.message = 'Studio Next finalized every required verdict. Ranking is ready for Arc settlement.'; return;
    }
    if (result.state === 'WAITING_FOR_JUDGE') { record.state = 'WAITING_FOR_JUDGE'; record.message = `Studio Next is finalizing attempt ${result.attemptId}.`; return; }
    if (result.state === 'REFUND_REQUIRED') { record.state = this.now() >= record.input.expiresAt ? 'REFUND_PENDING' : 'RECOVERY_REQUIRED'; record.message = `Runner stopped: ${result.reason}.`; return; }
    record.state = 'RECOVERY_REQUIRED'; record.message = `Runner requires recovery for attempt ${result.attemptId}.`;
    record.finalizedMatchCount = Math.min(record.finalizedMatchCount, Math.max(0, bracketMatchCount(entrantCount) - 1));
  }

  private async refresh(record: OperationRecord): Promise<TournamentOperationSnapshot> {
    const arc = await this.arc.snapshot(record.input.tournamentId);
    this.applyArcTerminal(record, arc);
    const candidates = this.service.listTournamentOperatorEntrants(this.operatorAddress, record.input.tournamentId as `sha256:${string}`);
    const registered = await this.arc.registeredEntrants(record.input.tournamentId, candidates);
    this.runtime.put('tournament-operations', record.input.tournamentId, record);
    this.publish(record, arc, registered.map((item) => fromBytes32(item.entrantId)));
    return this.toSnapshot(record, arc, registered);
  }

  private applyArcTerminal(record: OperationRecord, arc: ArcSnapshot): void {
    if (arc.state === 'SETTLED' || arc.state === 'CLOSED') { record.state = 'COMPLETED'; record.message = 'Arc settlement is canonical.'; }
    else if (arc.state === 'CANCELLED_REFUNDABLE') { record.state = 'REFUNDED'; record.message = 'Arc refunds are open for registered wallets.'; }
    else if (arc.state === 'RUNNING' && !record.ranking && !['WAITING_FOR_JUDGE', 'RECOVERY_REQUIRED'].includes(record.state)) record.state = 'RUNNING';
  }

  private publish(record: OperationRecord, arc: ArcSnapshot, entrants: readonly string[]): void {
    const status = record.state === 'COMPLETED' ? 'COMPLETED' : record.state === 'REFUNDED' ? 'CANCELLED' : ['RUNNING', 'WAITING_FOR_JUDGE', 'SETTLEMENT_PENDING', 'RECOVERY_REQUIRED', 'REFUND_PENDING'].includes(record.state) ? 'ACTIVE' : 'UPCOMING';
    this.service.publishTournament(this.operatorAddress, { id: record.input.tournamentId, name: record.input.name, status, entrantIds: [...entrants], stakeAmount: record.input.stakeAmount, prizePool: formatUnits(BigInt(record.input.stakeAmount) * BigInt(arc.entrantCount), 6) });
  }

  private toSnapshot(record: OperationRecord, arc: ArcSnapshot, entrants: readonly unknown[]): TournamentOperationSnapshot {
    return { tournamentId: record.input.tournamentId, name: record.input.name, state: record.state, entrantCount: arc.entrantCount || entrants.length, matchCount: bracketMatchCount(Math.max(arc.entrantCount, entrants.length)), finalizedMatchCount: record.finalizedMatchCount, nextActions: nextActions(record.state), arc: { state: arc.state, ...(arc.transactionHash || record.transactionHash ? { transactionHash: arc.transactionHash || record.transactionHash } : {}), totalLiability: arc.totalLiability }, genLayer: { pendingCount: record.state === 'WAITING_FOR_JUDGE' ? 1 : 0, finalizedCount: record.finalizedMatchCount }, ...(record.message ? { message: record.message } : {}) };
  }
}

export class ViemTournamentArcOperations implements TournamentArcOperations {
  private readonly client; private readonly wallet; private readonly account; private readonly escrow: Address;
  constructor(input: { rpcUrl: string; escrowAddress: string; privateKey: string }) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(input.escrowAddress) || !/^0x[0-9a-fA-F]{64}$/.test(input.privateKey) || new URL(input.rpcUrl).protocol !== 'https:') throw new Error('invalid Tournament Arc configuration');
    this.escrow = input.escrowAddress as Address; this.account = privateKeyToAccount(input.privateKey as Hex);
    this.client = createPublicClient({ chain: arcTestnet, transport: http(input.rpcUrl) }); this.wallet = createWalletClient({ account: this.account, chain: arcTestnet, transport: http(input.rpcUrl) });
  }
  async create(input: CreateTournamentOperation): Promise<ArcSnapshot> {
    await this.requireChain(); const existing = await this.snapshot(input.tournamentId); const raw = await this.raw(input.tournamentId);
    if (raw.policy.operatorAddress !== '0x0000000000000000000000000000000000000000') {
      const exact = Number(raw.policy.registrationOpensAt) === input.registrationOpensAt && Number(raw.policy.registrationClosesAt) === input.registrationClosesAt
        && Number(raw.policy.startsAt) === input.startsAt && Number(raw.policy.expiresAt) === input.expiresAt && Number(raw.policy.minEntrants) === input.minEntrants
        && Number(raw.policy.maxEntrants) === input.maxEntrants && raw.policy.stakeAmount === BigInt(input.stakeAmount)
        && raw.policy.operatorAddress.toLowerCase() === this.account.address.toLowerCase() && raw.policy.payoutBps.every((value, index) => Number(value) === PAYOUT_BPS[index]);
      if (!exact) throw new Error('existing Arc Tournament policy conflicts with the requested operation');
      return existing;
    }
    const owner = await this.client.readContract({ address: this.escrow, abi: TOURNAMENT_ABI, functionName: 'owner' });
    const policy = { registrationOpensAt: input.registrationOpensAt, registrationClosesAt: input.registrationClosesAt, startsAt: input.startsAt, expiresAt: input.expiresAt, minEntrants: input.minEntrants, maxEntrants: input.maxEntrants, stakeAmount: BigInt(input.stakeAmount), operatorAddress: this.account.address, feeRecipient: owner, payoutBps: PAYOUT_BPS };
    return this.write(input.tournamentId, 'createTournament', [toBytes32(input.tournamentId), policy]);
  }
  async snapshot(tournamentId: string): Promise<ArcSnapshot> { await this.requireChain(); const row = await this.raw(tournamentId); return { state: arcState(Number(row.state)), entrantCount: Number(row.entrantCount), totalLockedStakes: row.totalLockedStakes.toString(), totalLiability: row.totalLiability.toString() }; }
  async registeredEntrants(tournamentId: string, candidates: readonly TournamentOperatorEntrant[]): Promise<TournamentOperatorEntrant[]> { const rows = await Promise.all(candidates.map(async (candidate) => ({ candidate, row: await this.client.readContract({ address: this.escrow, abi: TOURNAMENT_ABI, functionName: 'getEntrant', args: [toBytes32(tournamentId), candidate.entrantId as Hex] }) }))); return rows.filter(({ candidate, row }) => row[4] && row[1].toLowerCase() === candidate.agentId.toLowerCase() && row[2].toLowerCase() === candidate.agentsVersion.toLowerCase() && row[3].toLowerCase() === candidate.agentsCommitment.toLowerCase()).map(({ candidate }) => candidate); }
  closeRegistration(id: string) { return this.write(id, 'closeRegistration', [toBytes32(id)]); }
  markRunning(id: string) { return this.write(id, 'markRunning', [toBytes32(id)]); }
  settle(id: string, ranking: readonly string[], rankingDigest: string, nonce: number) { return this.write(id, 'settleByOperator', [toBytes32(id), ranking.map(toBytes32), toBytes32(rankingDigest), BigInt(nonce)]); }
  refund(id: string, reasonDigest: string) { return this.write(id, 'cancelAndOpenRefunds', [toBytes32(id), toBytes32(reasonDigest)]); }
  private raw(id: string) { return this.client.readContract({ address: this.escrow, abi: TOURNAMENT_ABI, functionName: 'getTournament', args: [toBytes32(id)] }); }
  private async requireChain() { if (await this.client.getChainId() !== ARC_CHAIN_ID) throw new Error('wrong Arc chain'); }
  private async write(id: string, functionName: 'createTournament' | 'closeRegistration' | 'markRunning' | 'settleByOperator' | 'cancelAndOpenRefunds', args: readonly unknown[]): Promise<ArcSnapshot> { await this.requireChain(); const simulation = await this.client.simulateContract({ account: this.account, address: this.escrow, abi: TOURNAMENT_ABI, functionName, args: args as any }); const hash = await this.wallet.writeContract(simulation.request); const receipt = await this.client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 }); if (receipt.status !== 'success') throw new Error(`Arc Tournament action reverted: ${functionName}`); return { ...await this.snapshot(id), transactionHash: hash }; }
}

export function tournamentOperationsFromEnvironment(environment: NodeJS.ProcessEnv, runtime: SqliteRuntimeStore, service: ArenaApiService, operatorAddress: string): TournamentOperationsPort | undefined {
  const values = { privateKey: environment.GENLAYER_OWNER_PRIVATE_KEY?.trim() || environment.STUDIONET_PRIVATE_KEY?.trim(), judgeAddress: environment.GENLAYER_COMPARISON_JUDGE_ADDRESS?.trim(), endpoint: environment.END_POINT?.trim(), apiKey: environment.API_KEY?.trim(), model: environment.MODEL?.trim(), escrow: environment.ARC_TOURNAMENT_ESCROW_ADDRESS?.trim() || environment.VITE_ARC_ESCROW_ADDRESS?.trim(), rpc: environment.ARC_TESTNET_RPC_URL?.trim() || 'https://rpc.testnet.arc.network' };
  if (!Object.values(values).some(Boolean)) return undefined;
  if (!values.privateKey || !values.judgeAddress || !values.endpoint || !values.apiKey || !values.model || !values.escrow) return undefined;
  if (privateKeyToAccount(values.privateKey as Hex).address.toLowerCase() !== operatorAddress.toLowerCase()) throw new Error('Tournament operator signer does not match ARENA_OPERATOR_ADDRESS');
  const arc = new ViemTournamentArcOperations({ rpcUrl: values.rpc, escrowAddress: values.escrow, privateKey: values.privateKey });
  const provider = new OpenAICompatibleEvaluationProvider({ endpoint: values.endpoint, apiKey: values.apiKey, timeoutMs: 300_000 });
  const tracker = new ComparisonRunTracker(createStudioNextComparisonJudgePort(values.privateKey), new PersistentComparisonSubmissionStore(runtime), new ComparisonRunRegistry(runtime), values.judgeAddress, GENLAYER_CHAIN_ID);
  const orchestrator = new TournamentOrchestrator(new TournamentEvaluationPairRunner(provider, { model: values.model, maxOutputTokens: 1_500, temperature: 0.2 }, runtime), new TournamentComparisonJudgeAdapter(tracker));
  return new LiveTournamentOperations(runtime, service, operatorAddress, arc, orchestrator);
}

function nextActions(state: TournamentOperationState): readonly TournamentOperationAction[] { if (state === 'SETTLEMENT_PENDING') return ['SETTLE', 'EXPIRE']; if (state === 'REFUND_PENDING') return ['REFUND']; if (state === 'COMPLETED' || state === 'REFUNDED') return []; return ['PROGRESS', 'EXPIRE']; }
function bracketMatchCount(entrantCount: number): number { if (entrantCount < 2) return 0; try { return buildBracket({ tournamentId: digest('count-tournament'), seedDigest: digest('count-seed'), entrants: Array.from({ length: entrantCount }, (_, index) => digest(`entrant-${index}`)), bracketRevision: 1 }).matches.length; } catch { return 0; } }
function digest(value: string): `sha256:${string}` { return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`; }
function toBytes32(value: string): Hex { if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error('invalid Tournament digest'); return `0x${value.slice(7)}`; }
function fromBytes32(value: string): `sha256:${string}` { if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('invalid Tournament bytes32'); return `sha256:${value.slice(2).toLowerCase()}`; }
function arcState(value: number): ArcState { const state = ['DRAFT', 'REGISTRATION_CLOSED', 'RUNNING', 'SETTLED', 'CANCELLED_REFUNDABLE', 'CLOSED'][value]; if (!state) throw new Error('unknown Arc Tournament state'); return state as ArcState; }
