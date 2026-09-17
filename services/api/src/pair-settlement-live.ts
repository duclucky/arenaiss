import { createHash } from 'node:crypto';
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';

import { TournamentEvaluationPairRunner, TournamentComparisonJudgeAdapter } from '../../../packages/evaluation/src/tournament-runner.ts';
import { OpenAICompatibleEvaluationProvider } from '../../../packages/evaluation/src/provider.ts';
import { ComparisonRunRegistry } from '../../../packages/evaluation/src/tournament-comparison.ts';
import { ComparisonRunTracker, PersistentComparisonSubmissionStore } from '../../../packages/genlayer/src/comparison-tracker.ts';
import { createStudioNextComparisonJudgePort } from '../../../packages/genlayer/src/comparison-sdk-port.ts';
import type { InferenceInput } from '../../../packages/orchestrator/src/orchestrator.ts';
import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import type { ArenaApiService } from './service.ts';
import { ArcPairChainPort } from './pair-arc.ts';
import type { PairRoom } from './pair-rooms.ts';
import { PairSettlementWorker, type PairOutcome, type PairOutcomePort, type PairSettlementArcPort } from './pair-settlement.ts';

const ARC_ABI = parseAbi(['function settle(bytes32,address,bytes32)', 'function expireRoom(bytes32)']);
const TOPIC = 'A payment API times out after a charge request. Explain the safe retry plan, the evidence needed to determine whether payment occurred, and how to avoid a duplicate charge.';
function digest(value: string): `sha256:${string}` { return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`; }
function bytes32(value: string): Hex { if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error('invalid pair digest'); return `0x${value.slice(7)}`; }

export class LivePairOutcome implements PairOutcomePort {
  private readonly inference: TournamentEvaluationPairRunner;
  private readonly judge: TournamentComparisonJudgeAdapter;
  private readonly tracker: ComparisonRunTracker;
  private readonly agents: ArenaApiService;

  constructor(runtime: SqliteRuntimeStore, agents: ArenaApiService, input: { privateKey: string; judgeAddress: string; endpoint: string; apiKey: string; model: string; fallbackEndpoint?: string; fallbackApiKey?: string; fallbackModel?: string }) {
    const provider = new OpenAICompatibleEvaluationProvider({ endpoint: input.endpoint, fallbackEndpoint: input.fallbackEndpoint, apiKey: input.apiKey, fallbackApiKey: input.fallbackApiKey, fallbackModel: input.fallbackModel, timeoutMs: 300_000 });
    this.inference = new TournamentEvaluationPairRunner(provider, { model: input.model, maxOutputTokens: 1_500, temperature: 0.2 }, runtime);
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
    try { pair = await this.inference.run(context); }
    catch { return { state: 'RETRY_LATER', failureCode: 'PROVIDER_ERROR' }; }
    if (pair.state !== 'OUTPUTS_READY' || !pair.outputA || !pair.outputB || !pair.outputADigest || !pair.outputBDigest) return { state: 'RETRY_LATER', failureCode: 'PROVIDER_ERROR' };
    try {
      const judgment = await this.judge.judge({ ...context, outputA: pair.outputA, outputB: pair.outputB, outputADigest: pair.outputADigest, outputBDigest: pair.outputBDigest, failureCode: pair.failureCode! });
      if (judgment.state === 'FAILED') return { state: 'RETRY_LATER', failureCode: 'GENLAYER_ERROR' };
      if (judgment.state !== 'FINALIZED') return { state: 'WAITING', failureCode: 'VERDICT_PENDING' };
      const canonical = await this.tracker.poll(context.matchId, context.attemptId);
      if (canonical.state !== 'FINALIZED' || !canonical.run || canonical.run.judge.finality !== 'FINALIZED' || canonical.run.judge.execution !== 'SUCCESS'
        || canonical.run.source.matchId !== context.matchId || canonical.run.source.attemptId !== context.attemptId
        || canonical.run.agents.versionIdA !== a.agentsVersion || canonical.run.agents.versionIdB !== b.agentsVersion
        || canonical.run.result !== judgment.result || !['A_WIN', 'B_WIN', 'TIE'].includes(canonical.run.result)) return { state: 'RETRY_LATER', failureCode: 'GENLAYER_ERROR' };
      return { state: 'FINAL', result: canonical.run.result as 'A_WIN' | 'B_WIN' | 'TIE', transactionHash: canonical.run.judge.transactionHash };
    } catch (error) {
      return { state: 'RETRY_LATER', failureCode: isGenLayerBusy(error) ? 'GENLAYER_BUSY' : 'GENLAYER_ERROR' };
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

  constructor(chain: ArcPairChainPort, privateKey: string, expectedOperator: string, rpcUrl?: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('pair operator key is invalid');
    this.account = privateKeyToAccount(privateKey as Hex);
    if (this.account.address.toLowerCase() !== expectedOperator.toLowerCase()) throw new Error('pair operator signer mismatch');
    this.chain = chain;
    this.escrow = chain.escrowAddress as Address;
    this.client = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl ?? 'https://rpc.testnet.arc.network') });
    this.wallet = createWalletClient({ chain: arcTestnet, account: this.account, transport: http(rpcUrl ?? 'https://rpc.testnet.arc.network') });
  }

  async getRoom(roomId: string) { await this.chain.assertReady(); return this.chain.getRoom(roomId); }
  settle(roomId: string, winner: string, verdictDigest: string) { return this.write('settle', [bytes32(roomId), winner as Address, bytes32(verdictDigest)]); }
  expire(roomId: string) { return this.write('expireRoom', [bytes32(roomId)]); }

  private async write(functionName: 'settle' | 'expireRoom', args: readonly unknown[]): Promise<string> {
    await this.chain.assertReady();
    const simulated = await this.client.simulateContract({ account: this.account, address: this.escrow, abi: ARC_ABI, functionName, args: args as any });
    const hash = await this.wallet.writeContract(simulated.request);
    const receipt = await this.client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error(`pair Arc ${functionName} transaction reverted`);
    return hash;
  }
}

export function pairSettlementFromEnvironment(environment: NodeJS.ProcessEnv, runtime: SqliteRuntimeStore, agents: ArenaApiService, chain: ArcPairChainPort, operator: string): PairSettlementWorker | undefined {
  const privateKey = environment.GENLAYER_OWNER_PRIVATE_KEY?.trim() || environment.STUDIONET_PRIVATE_KEY?.trim();
  const judgeAddress = environment.GENLAYER_COMPARISON_JUDGE_ADDRESS?.trim();
  const endpoint = environment.END_POINT?.trim();
  const apiKey = environment.API_KEY?.trim();
  const model = environment.MODEL?.trim();
  if (!privateKey || !judgeAddress || !endpoint || !apiKey || !model) return undefined;
  const arc = new LivePairSettlementArc(chain, privateKey, operator, environment.ARC_TESTNET_RPC_URL?.trim());
  const outcome = new LivePairOutcome(runtime, agents, { privateKey, judgeAddress, endpoint, apiKey, model,
    fallbackEndpoint: environment.FALLBACK_END_POINT?.trim(), fallbackApiKey: environment.FALLBACK_API_KEY?.trim(), fallbackModel: environment.FALLBACK_MODEL?.trim() });
  return new PairSettlementWorker(runtime, arc, outcome);
}
