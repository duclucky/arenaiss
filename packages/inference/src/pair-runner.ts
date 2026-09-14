import { createHash, randomUUID } from "node:crypto";
import type { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";

type Digest = `sha256:${string}`;
type Side = "A" | "B";

export interface AgentInput {
  agentId: Digest;
  agentsVersion: Digest;
  agentsMd: string;
  agentsCommitment: Digest;
}

export interface GenerationPolicy {
  version: string;
  model: string;
  wrapper: string;
  maxOutputBytes: number;
  temperature: number;
  maxCostMicros: number;
  maxCostPerCallMicros: number;
}

export interface PairInput {
  tournamentId: Digest;
  matchId: Digest;
  attemptId: Digest;
  topic: string;
  agentA: AgentInput;
  agentB: AgentInput;
  policy: GenerationPolicy;
}

export interface CanonicalModelRequest {
  policyVersion: string;
  model: string;
  wrapper: string;
  topic: string;
  agentsMd: string;
  maxOutputBytes: number;
  temperature: number;
}

export interface ProviderResult {
  requestId?: string;
  output: string;
  usageTokens: number;
  costMicros: number;
}

export interface ModelProvider {
  generate(request: CanonicalModelRequest, operationKey: string): Promise<ProviderResult>;
}

type RunState = "PERSISTED" | "SUCCESS" | "TRANSIENT_FAILURE" | "PERMANENT_FAILURE";
type InferenceRun = {
  operationKey: string;
  pairFingerprint: Digest;
  tournamentId: Digest;
  matchId: Digest;
  attemptId: Digest;
  side: Side;
  state: RunState;
  request?: CanonicalModelRequest;
  providerRequestId?: string;
  output?: string;
  outputDigest?: Digest;
  usageTokens?: number;
  costMicros?: number;
};

export type PairResult = {
  state: "OUTPUTS_READY" | "PARTIAL_PAIR";
  attemptId: Digest;
  outputA?: string;
  outputB?: string;
  outputADigest?: Digest;
  outputBDigest?: Digest;
};

export interface InferenceStore {
  get(operationKey: string): InferenceRun | undefined;
  put(run: InferenceRun): void;
  addCost(tournamentId: Digest, amount: number): void;
  totalCostMicros(tournamentId: Digest): number;
  forAttempt(attemptId: Digest): InferenceRun[];
  runPairOnce(attemptId: Digest, fingerprint: Digest, operation: () => Promise<PairResult>): Promise<PairResult>;
}

const sha256 = (value: string): Digest => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const clone = <T>(value: T): T => structuredClone(value);

export class MemoryInferenceStore implements InferenceStore {
  private runs = new Map<string, InferenceRun>();
  private costs = new Map<string, number>();
  private pairOperations = new Map<string, { fingerprint: Digest; promise: Promise<PairResult> }>();

  get(operationKey: string): InferenceRun | undefined { const value = this.runs.get(operationKey); return value ? clone(value) : undefined; }
  put(run: InferenceRun): void { this.runs.set(run.operationKey, clone(run)); }
  addCost(tournamentId: Digest, amount: number): void { this.costs.set(tournamentId, this.totalCostMicros(tournamentId) + amount); }
  totalCostMicros(tournamentId: Digest): number { return this.costs.get(tournamentId) ?? 0; }
  forAttempt(attemptId: Digest): InferenceRun[] { return [...this.runs.values()].filter((run) => run.attemptId === attemptId).map(clone); }

  runPairOnce(attemptId: Digest, fingerprint: Digest, operation: () => Promise<PairResult>): Promise<PairResult> {
    const active = this.pairOperations.get(attemptId);
    if (active) {
      if (active.fingerprint !== fingerprint) throw new Error("conflicting inference pair operation");
      return active.promise;
    }
    const promise = Promise.resolve().then(operation);
    this.pairOperations.set(attemptId, { fingerprint, promise });
    void promise.finally(() => {
      if (this.pairOperations.get(attemptId)?.promise === promise) this.pairOperations.delete(attemptId);
    }).catch(() => undefined);
    return promise;
  }
}

export class PersistentInferenceStore implements InferenceStore {
  private runtime: SqliteRuntimeStore;
  private workerId: string;
  private now: () => number;
  private leaseMs: number;
  private pairOperations = new Map<string, { fingerprint: Digest; promise: Promise<PairResult> }>();

  constructor(runtime: SqliteRuntimeStore, options: { workerId?: string; now?: () => number; leaseMs?: number } = {}) {
    this.runtime = runtime;
    this.workerId = options.workerId ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? 5 * 60_000;
    if (!this.workerId || !Number.isSafeInteger(this.leaseMs) || this.leaseMs <= 0) throw new TypeError("inference lease configuration is invalid");
  }

  get(operationKey: string): InferenceRun | undefined {
    return this.runtime.get<InferenceRun>("inference-runs", operationKey);
  }

  put(run: InferenceRun): void {
    this.runtime.put("inference-runs", run.operationKey, run);
  }

  addCost(tournamentId: Digest, amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError("inference cost is invalid");
    this.runtime.increment("inference-cost", tournamentId, amount);
  }

  totalCostMicros(tournamentId: Digest): number {
    return this.runtime.counter("inference-cost", tournamentId);
  }

  forAttempt(attemptId: Digest): InferenceRun[] {
    return this.runtime.list<InferenceRun>("inference-runs").filter((run) => run.attemptId === attemptId);
  }

  runPairOnce(attemptId: Digest, fingerprint: Digest, operation: () => Promise<PairResult>): Promise<PairResult> {
    const active = this.pairOperations.get(attemptId);
    if (active) {
      if (active.fingerprint !== fingerprint) throw new Error("conflicting inference pair operation");
      return active.promise;
    }
    const claim = this.runtime.claimLease("inference-pairs", attemptId, fingerprint, this.workerId, this.now(), this.leaseMs);
    if (claim === "BUSY") return Promise.reject(new Error("inference pair operation is leased by another worker"));
    const promise = Promise.resolve().then(operation);
    this.pairOperations.set(attemptId, { fingerprint, promise });
    void promise.finally(() => {
      if (this.pairOperations.get(attemptId)?.promise === promise) this.pairOperations.delete(attemptId);
      this.runtime.releaseLease("inference-pairs", attemptId, this.workerId);
    }).catch(() => undefined);
    return promise;
  }
}

export class InferencePairRunner {
  private provider: ModelProvider;
  private store: InferenceStore;
  constructor(provider: ModelProvider, store: InferenceStore) { this.provider = provider; this.store = store; }

  async runPair(input: PairInput): Promise<PairResult> {
    this.validate(input);
    const fingerprint = sha256(JSON.stringify({
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      attemptId: input.attemptId,
      topic: input.topic,
      agentA: { agentId: input.agentA.agentId, agentsVersion: input.agentA.agentsVersion, agentsCommitment: input.agentA.agentsCommitment },
      agentB: { agentId: input.agentB.agentId, agentsVersion: input.agentB.agentsVersion, agentsCommitment: input.agentB.agentsCommitment },
      policy: input.policy,
    }));
    return this.store.runPairOnce(input.attemptId, fingerprint, () => this.runClaimedPair(input, fingerprint));
  }

  private async runClaimedPair(input: PairInput, fingerprint: Digest): Promise<PairResult> {
    const keys = { A: `${input.attemptId}:A`, B: `${input.attemptId}:B` } as const;
    const existing = this.store.forAttempt(input.attemptId);
    if (existing.some((run) => run.pairFingerprint !== fingerprint)) throw new Error("conflicting inference pair operation");
    const hasFailure = existing.some((run) => run.state === "TRANSIENT_FAILURE" || run.state === "PERMANENT_FAILURE");
    if (hasFailure) throw new Error("partial pair requires a new attempt ID");
    const completed = this.completedResult(input.attemptId);
    if (completed) return completed;

    const remaining = input.policy.maxCostMicros - this.store.totalCostMicros(input.tournamentId);
    if (remaining < input.policy.maxCostPerCallMicros * 2) throw new Error("tournament inference budget exhausted");

    const results = await Promise.all((["A", "B"] as const).map(async (side) => {
      const agent = side === "A" ? input.agentA : input.agentB;
      const request: CanonicalModelRequest = {
        policyVersion: input.policy.version,
        model: input.policy.model,
        wrapper: input.policy.wrapper,
        topic: input.topic,
        agentsMd: agent.agentsMd,
        maxOutputBytes: input.policy.maxOutputBytes,
        temperature: input.policy.temperature,
      };
      const prior = this.store.get(keys[side]);
      if (prior?.state === "SUCCESS") return prior;
      const run: InferenceRun = { operationKey: keys[side], pairFingerprint: fingerprint, tournamentId: input.tournamentId, matchId: input.matchId, attemptId: input.attemptId, side, state: "PERSISTED", request };
      this.store.put(run);
      try {
        const response = await this.provider.generate(request, keys[side]);
        if (!response.output || Buffer.byteLength(response.output, "utf8") > input.policy.maxOutputBytes) throw new Error("PROVIDER_PERMANENT");
        if (!Number.isSafeInteger(response.costMicros) || response.costMicros < 0 || response.costMicros > input.policy.maxCostPerCallMicros) throw new Error("PROVIDER_PERMANENT");
        const success: InferenceRun = { ...run, state: "SUCCESS", providerRequestId: response.requestId, output: response.output, outputDigest: sha256(response.output), usageTokens: response.usageTokens, costMicros: response.costMicros };
        this.store.put(success);
        this.store.addCost(input.tournamentId, response.costMicros);
        return success;
      } catch (error) {
        const message = error instanceof Error ? error.message : "PROVIDER_TRANSIENT";
        const failed: InferenceRun = { ...run, state: message.includes("PERMANENT") ? "PERMANENT_FAILURE" : "TRANSIENT_FAILURE" };
        this.store.put(failed);
        return failed;
      }
    }));
    if (results.every((run) => run.state === "SUCCESS")) return this.completedResult(input.attemptId)!;
    const success = results.find((run) => run.state === "SUCCESS");
    return { state: "PARTIAL_PAIR", attemptId: input.attemptId, ...(success?.side === "A" ? { outputA: success.output, outputADigest: success.outputDigest } : {}), ...(success?.side === "B" ? { outputB: success.output, outputBDigest: success.outputDigest } : {}) };
  }

  private completedResult(attemptId: Digest): PairResult | undefined {
    const runs = this.store.forAttempt(attemptId);
    const a = runs.find((run) => run.side === "A" && run.state === "SUCCESS");
    const b = runs.find((run) => run.side === "B" && run.state === "SUCCESS");
    return a && b ? { state: "OUTPUTS_READY", attemptId, outputA: a.output, outputB: b.output, outputADigest: a.outputDigest, outputBDigest: b.outputDigest } : undefined;
  }

  private validate(input: PairInput): void {
    for (const agent of [input.agentA, input.agentB]) {
      if (!agent.agentsMd || sha256(agent.agentsMd) !== agent.agentsCommitment) throw new Error("AGENTS.md commitment mismatch");
    }
    if (!input.topic || !input.policy.version || !input.policy.model || !input.policy.wrapper) throw new Error("generation policy is incomplete");
    if (!Number.isSafeInteger(input.policy.maxOutputBytes) || input.policy.maxOutputBytes <= 0) throw new Error("invalid output bound");
    if (!Number.isSafeInteger(input.policy.maxCostPerCallMicros) || input.policy.maxCostPerCallMicros <= 0) throw new Error("invalid cost bound");
  }
}
