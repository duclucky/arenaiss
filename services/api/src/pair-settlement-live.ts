import { createHash, randomUUID } from 'node:crypto';
import { createPublicClient, createWalletClient, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';

import { TournamentEvaluationPairRunner, TournamentComparisonJudgeAdapter } from '../../../packages/evaluation/src/tournament-runner.ts';
import { OpenAICompatibleEvaluationProvider, providerConfigurationFromEnvironment } from '../../../packages/evaluation/src/provider.ts';
import { ComparisonRunRegistry } from '../../../packages/evaluation/src/tournament-comparison.ts';
import { ComparisonRunTracker, PersistentComparisonSubmissionStore } from '../../../packages/genlayer/src/comparison-tracker.ts';
import { createStudioNextComparisonJudgePort } from '../../../packages/genlayer/src/comparison-sdk-port.ts';
import type { InferenceInput } from '../../../packages/orchestrator/src/orchestrator.ts';
import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import type { ArenaApiService } from './service.ts';
import type { ManagedIdentityService } from './managed-identity.ts';
import { ArcPairChainPort } from './pair-arc.ts';
import type { PairEvaluationFailureCode, PairRoom } from './pair-rooms.ts';
import { PairSettlementWorker, type PairOutcome, type PairOutcomePort, type PairSettlementArcPort } from './pair-settlement.ts';
import { arcReadTransport, arcWriteTransport } from './arc-rpc.ts';
import { sharedTransactionSubmissionCoordinator, type TransactionSubmissionCoordinator } from '../../../packages/operations/src/concurrency.ts';

const ARC_ABI = parseAbi(['function settle(bytes32,address,bytes32)', 'function expireRoom(bytes32)']);
const TOPIC = 'A payment API times out after a charge request. Explain the safe retry plan, the evidence needed to determine whether payment occurred, and how to avoid a duplicate charge.';
function digest(value: string): `sha256:${string}` { return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`; }
function bytes32(value: string): Hex { if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error('invalid pair digest'); return `0x${value.slice(7)}`; }

type PairArcPublicClient = {
  simulateContract(input: any): Promise<{ request: any }>;
  waitForTransactionReceipt(input: any): Promise<{ status: string }>;
};
type PairArcWalletClient = { writeContract(input: any): Promise<Hex> };

export class LivePairOutcome implements PairOutcomePort {
  private readonly inference: TournamentEvaluationPairRunner;
  private readonly legacyInference?: TournamentEvaluationPairRunner;
  private readonly runtime: SqliteRuntimeStore;
  private readonly cheapModel?: string;
  private readonly openaiModel: string;
  private readonly judge: TournamentComparisonJudgeAdapter;
  private readonly tracker: ComparisonRunTracker;
  private readonly agents: ArenaApiService;

  constructor(runtime: SqliteRuntimeStore, agents: ArenaApiService, input: { privateKey: string; judgeAddress: string; endpoint: string; apiKey: string; model: string; fallbackEndpoint?: string; fallbackApiKey?: string; fallbackModel?: string; primaryFormat?: 'openai' | 'compatible'; fallbackFormat?: 'openai' | 'compatible' }) {
    this.runtime = runtime; this.cheapModel = input.fallbackModel; this.openaiModel = input.model;
    const provider = new OpenAICompatibleEvaluationProvider({ endpoint: input.endpoint, fallbackEndpoint: input.fallbackEndpoint, apiKey: input.apiKey, fallbackApiKey: input.fallbackApiKey, fallbackModel: input.fallbackModel, primaryFormat: input.primaryFormat, fallbackFormat: input.fallbackFormat, timeoutMs: 300_000 });
    this.inference = new TournamentEvaluationPairRunner(provider, { model: input.model, maxOutputTokens: 1_500, temperature: 0.2 }, runtime);
    if (input.fallbackEndpoint && input.fallbackApiKey && input.fallbackModel) {
      const legacyProvider = new OpenAICompatibleEvaluationProvider({ endpoint: input.fallbackEndpoint, apiKey: input.fallbackApiKey, fallbackEndpoint: input.endpoint, fallbackApiKey: input.apiKey, fallbackModel: input.model, timeoutMs: 300_000 });
      this.legacyInference = new TournamentEvaluationPairRunner(legacyProvider, { model: input.fallbackModel, maxOutputTokens: 1_500, temperature: 0.2 }, runtime);
    }
    this.tracker = new ComparisonRunTracker(createStudioNextComparisonJudgePort(input.privateKey), new PersistentComparisonSubmissionStore(runtime), new ComparisonRunRegistry(runtime), input.judgeAddress, 61_997);
    this.judge = new TournamentComparisonJudgeAdapter(this.tracker);
    this.agents = agents;
  }

  async resolve(room: PairRoom): Promise<PairOutcome> {
    if (room.state !== 'JOINED' || !room.challenger || !room.challengerAgentId || !room.challengerVersion || !room.joinTx) throw new Error('pair room has no confirmed second deposit');
    const a = this.agents.getAgentVersion(room.creator, room.creatorAgentId as `sha256:${string}`, room.creatorVersion as `sha256:${string}`);
    const b = this.agents.getAgentVersion(room.challenger, room.challengerAgentId as `sha256:${string}`, room.challengerVersion as `sha256:${string}`);
    const context: InferenceInput = {
      tournamentId: room.roomId as `sha256:${string}`,
      matchId: digest(`arena-pair-match-v1|${room.roomId}`),
      attemptId: digest(`arena-pair-attempt-v1|${room.roomId}|1`),
      topic: TOPIC,
      agentA: { entrantId: digest(`${room.roomId}|creator`), agentId: a.agentId, agentsVersion: a.agentsVersion, agentsMd: a.agentsMd, agentsCommitment: a.agentsCommitment },
      agentB: { entrantId: digest(`${room.roomId}|challenger`), agentId: b.agentId, agentsVersion: b.agentsVersion, agentsMd: b.agentsMd, agentsCommitment: b.agentsCommitment },
    };
    let pair: Awaited<ReturnType<TournamentEvaluationPairRunner['run']>>;
    const firstSide = this.runtime.get<{ model?: string }>('evaluation-tournament-provider-runs', `${context.attemptId}:A`);
    const secondSide = this.runtime.get<{ model?: string }>('evaluation-tournament-provider-runs', `${context.attemptId}:B`);
    const decision = this.runtime.get<{ model?: string }>('evaluation-tournament-provider-route', context.attemptId);
    const legacy = (this.cheapModel && (firstSide?.model === this.cheapModel || secondSide?.model === this.cheapModel)) || decision?.model === this.openaiModel;
    try { pair = await (legacy && this.legacyInference ? this.legacyInference : this.inference).run(context); }
    catch { return { state: 'RETRY_LATER', failureCode: 'PROVIDER_ERROR' }; }
    if (pair.state !== 'OUTPUTS_READY' || !pair.outputA || !pair.outputB || !pair.outputADigest || !pair.outputBDigest) return { state: 'RETRY_LATER', failureCode: 'PROVIDER_ERROR' };
    const judgeInput = { ...context, outputA: pair.outputA, outputB: pair.outputB, outputADigest: pair.outputADigest, outputBDigest: pair.outputBDigest, failureCode: pair.failureCode! };
    try {
      await this.judge.submit(judgeInput);
    } catch (error) {
      return { state: 'RETRY_LATER', failureCode: isGenLayerBusy(error) ? 'GENLAYER_BUSY' : 'GENLAYER_ERROR' };
    }
    const transactionHash = this.tracker.transactionHash(context.matchId, context.attemptId);
    try {
      const judgment = await this.judge.poll(judgeInput);
      if (judgment.state === 'FAILED') return {
        state: 'RETRY_LATER',
        failureCode: judgment.failureReason === 'NO_CONSENSUS' ? 'GENLAYER_NO_CONSENSUS' : 'GENLAYER_ERROR',
        ...(transactionHash ? { transactionHash } : {}),
      };
      if (judgment.state !== 'FINALIZED') return { state: 'WAITING', failureCode: 'VERDICT_PENDING', ...(transactionHash ? { transactionHash } : {}) };
      const canonical = await this.tracker.poll(context.matchId, context.attemptId);
      if (canonical.state !== 'FINALIZED' || !canonical.run || canonical.run.judge.finality !== 'FINALIZED' || canonical.run.judge.execution !== 'SUCCESS'
        || canonical.run.source.matchId !== context.matchId || canonical.run.source.attemptId !== context.attemptId
        || canonical.run.agents.versionIdA !== a.agentsVersion || canonical.run.agents.versionIdB !== b.agentsVersion
        || canonical.run.result !== judgment.result || !['A_WIN', 'B_WIN', 'TIE'].includes(canonical.run.result)) return { state: 'RETRY_LATER', failureCode: 'GENLAYER_ERROR' };
      return { state: 'FINAL', result: canonical.run.result as 'A_WIN' | 'B_WIN' | 'TIE', transactionHash: canonical.run.judge.transactionHash };
    } catch (error) {
      return { state: 'RETRY_LATER', failureCode: isGenLayerBusy(error) ? 'GENLAYER_BUSY' : 'GENLAYER_ERROR', ...(transactionHash ? { transactionHash } : {}) };
    }
  }
}

function isGenLayerBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /server busy|execution slots? occupied|too many requests|\b429\b|capacity/i.test(message);
}

export class LivePairSettlementArc implements PairSettlementArcPort {
  private readonly chain: ArcPairChainPort;
  private readonly client;
  private readonly wallet;
  private readonly account;
  private readonly escrow: Address;
  private readonly transactions: TransactionSubmissionCoordinator;
  private readonly refunds?: PairAutomaticRefundPort;

  constructor(chain: ArcPairChainPort, privateKey: string, expectedOperator: string, rpcUrl?: string,
    refunds?: PairAutomaticRefundPort, clients?: { publicClient: PairArcPublicClient; walletClient: PairArcWalletClient }, transactions: TransactionSubmissionCoordinator = sharedTransactionSubmissionCoordinator) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('pair operator key is invalid');
    this.account = privateKeyToAccount(privateKey as Hex);
    if (this.account.address.toLowerCase() !== expectedOperator.toLowerCase()) throw new Error('pair operator signer mismatch');
    this.chain = chain;
    this.escrow = chain.escrowAddress as Address;
    this.client = clients?.publicClient ?? createPublicClient({ chain: arcTestnet, transport: arcReadTransport(rpcUrl) });
    this.wallet = clients?.walletClient ?? createWalletClient({ chain: arcTestnet, account: this.account, transport: arcWriteTransport(rpcUrl) });
    this.transactions = transactions;
    this.refunds = refunds;
  }

  async getRoom(roomId: string) { await this.chain.assertReady(); return this.chain.getRoom(roomId); }
  settle(roomId: string, winner: string, verdictDigest: string) { return this.write('settle', [bytes32(roomId), winner as Address, bytes32(verdictDigest)]); }
  expire(roomId: string) { return this.write('expireRoom', [bytes32(roomId)]); }
  refund(room: PairRoom, failureCode?: PairEvaluationFailureCode) {
    if (!this.refunds) throw new Error('automatic pair refunds are unavailable');
    return this.refunds.refund(room, failureCode);
  }

  private async write(functionName: 'settle' | 'expireRoom', args: readonly unknown[]): Promise<string> {
    await this.chain.assertReady();
    const simulated = await this.client.simulateContract({ account: this.account, address: this.escrow, abi: ARC_ABI, functionName, args: args as any });
    const hash = await this.transactions.submit({ network: 'ARC', chainId: 5_042_002, signerAddress: this.account.address }, () => this.wallet.writeContract(simulated.request));
    const receipt = await this.client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error(`pair Arc ${functionName} transaction reverted`);
    return hash;
  }

}

type PairAutomaticRefundPort = { refund(room: PairRoom, failureCode?: PairEvaluationFailureCode): Promise<string> };
type PairRefundIdentityPort = {
  pairActionForPrincipal(principal: string, input: { escrowAddress: string; roomId: string; kind: 'REQUEST_CANCEL' | 'WITHDRAW'; executionKey: string }): Promise<{ txHash?: string }>;
};

export class LivePairAutomaticRefund implements PairAutomaticRefundPort {
  private readonly runtime: SqliteRuntimeStore;
  private readonly identities: PairRefundIdentityPort;
  private readonly escrowAddress: string;

  constructor(runtime: SqliteRuntimeStore, identities: PairRefundIdentityPort, escrowAddress: string) {
    this.runtime = runtime;
    this.identities = identities;
    this.escrowAddress = escrowAddress;
  }

  async refund(room: PairRoom, failureCode?: PairEvaluationFailureCode): Promise<string> {
    if (!room.challenger) throw new Error('joined pair room has no challenger identity');
    this.runtime.putIfAbsent('pair-room-automatic-refunds', room.roomId, { failureCode, createdAt: Date.now() });
    const creator = await this.identities.pairActionForPrincipal(room.creator, this.action(room, room.creator, 'REQUEST_CANCEL'));
    const challenger = await this.identities.pairActionForPrincipal(room.challenger, this.action(room, room.challenger, 'REQUEST_CANCEL'));
    const refundTx = challenger.txHash ?? creator.txHash;
    if (!refundTx || !/^0x[0-9a-fA-F]{64}$/.test(refundTx)) throw new Error('automatic pair refund transaction is unavailable');
    const deliveries = await Promise.allSettled([
      this.deliver(room, room.creator),
      this.deliver(room, room.challenger),
    ]);
    this.runtime.put('pair-room-automatic-refund-deliveries', room.roomId, deliveries.map((result) => result.status === 'fulfilled'
      ? { status: 'DELIVERED', txHash: result.value }
      : { status: 'CLAIM_REQUIRED' }));
    return refundTx;
  }

  private async deliver(room: PairRoom, principal: string): Promise<string> {
    const result = await this.identities.pairActionForPrincipal(principal, this.action(room, principal, 'WITHDRAW'));
    if (!result.txHash || !/^0x[0-9a-fA-F]{64}$/.test(result.txHash)) throw new Error('automatic pair refund delivery transaction is unavailable');
    return result.txHash;
  }

  private action(room: PairRoom, principal: string, kind: 'REQUEST_CANCEL' | 'WITHDRAW') {
    const key = `${room.roomId}:${kind}:${principal}`;
    this.runtime.putIfAbsent('pair-room-automatic-refund-keys', key, { executionKey: randomUUID() });
    const stored = this.runtime.get<{ executionKey: string }>('pair-room-automatic-refund-keys', key)!;
    return { escrowAddress: this.escrowAddress, roomId: room.roomId, kind, executionKey: stored.executionKey };
  }
}

export function pairSettlementFromEnvironment(environment: NodeJS.ProcessEnv, runtime: SqliteRuntimeStore, agents: ArenaApiService, identities: ManagedIdentityService, chain: ArcPairChainPort, operator: string): PairSettlementWorker | undefined {
  const privateKey = environment.GENLAYER_OWNER_PRIVATE_KEY?.trim() || environment.STUDIONET_PRIVATE_KEY?.trim();
  const judgeAddress = environment.GENLAYER_COMPARISON_JUDGE_ADDRESS?.trim();
  const routing = providerConfigurationFromEnvironment(environment);
  if (!privateKey || !judgeAddress || !routing) return undefined;
  const refunds = new LivePairAutomaticRefund(runtime, identities, chain.escrowAddress);
  const arc = new LivePairSettlementArc(chain, privateKey, operator, environment.ARC_TESTNET_RPC_URL?.trim(), refunds);
  const outcome = new LivePairOutcome(runtime, agents, { privateKey, judgeAddress, ...routing.provider, model: routing.model });
  return new PairSettlementWorker(runtime, arc, outcome);
}
