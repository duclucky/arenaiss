import { createHash } from "node:crypto";

import type { ComparisonRunTracker } from "../../genlayer/src/comparison-tracker.ts";
import type { InferenceInput, OrchestratorInference, OrchestratorJudge, PairOutput } from "../../orchestrator/src/orchestrator.ts";
import type { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";
import { classifyEvaluationProviderError, type EvaluationProviderResult } from "./provider.ts";
import { buildEvaluationInput, sha256Text, type EvaluationProviderInput, type EvaluationScenario } from "./protocol.ts";
import { resultForTournamentProgression } from "./tournament-comparison.ts";

export interface TournamentEvaluationProvider {
  generate(value: { model: string; input: EvaluationProviderInput; maxOutputTokens: number; temperature: number; operationKey: string; route?: "PRIMARY" | "FALLBACK" }): Promise<EvaluationProviderResult>;
  getFallbackModel?(): string | undefined;
}

export interface TournamentEvaluationPolicy {
  model: string;
  maxOutputTokens: number;
  temperature: number;
}

type ProviderRecord = { fingerprint: string; rawOutput: string; responseDigest: string; model?: string; route?: "PRIMARY" | "FALLBACK" };
type RouteDecision = { fingerprint: string; model: string };

export class TournamentEvaluationPairRunner implements OrchestratorInference {
  private readonly memory = new Map<string, ProviderRecord>();
  private readonly routeMemory = new Map<string, RouteDecision>();
  private readonly active = new Map<string, Promise<PairOutput>>();
  constructor(privateProvider: TournamentEvaluationProvider, privatePolicy: TournamentEvaluationPolicy, runtime?: SqliteRuntimeStore) {
    this.provider = privateProvider;
    this.policy = privatePolicy;
    this.runtime = runtime;
    if (!privatePolicy.model || !Number.isSafeInteger(privatePolicy.maxOutputTokens) || privatePolicy.maxOutputTokens < 1 || !Number.isFinite(privatePolicy.temperature) || privatePolicy.temperature < 0 || privatePolicy.temperature > 2) throw new TypeError("Tournament evaluation policy is invalid");
  }
  private readonly provider: TournamentEvaluationProvider;
  private readonly policy: TournamentEvaluationPolicy;
  private readonly runtime?: SqliteRuntimeStore;

  run(input: InferenceInput): Promise<PairOutput> {
    const fingerprint = sha256(JSON.stringify({ tournamentId: input.tournamentId, matchId: input.matchId, attemptId: input.attemptId, topic: input.topic, agentA: { version: input.agentA.agentsVersion, commitment: input.agentA.agentsCommitment }, agentB: { version: input.agentB.agentsVersion, commitment: input.agentB.agentsCommitment }, policy: this.policy }));
    const active = this.active.get(input.attemptId);
    if (active) return active;
    const promise = this.runPair(input, fingerprint);
    this.active.set(input.attemptId, promise);
    void promise.finally(() => { if (this.active.get(input.attemptId) === promise) this.active.delete(input.attemptId); }).catch(() => undefined);
    return promise;
  }

  private async runPair(input: InferenceInput, fingerprint: string): Promise<PairOutput> {
    const scenario = tournamentScenario(input);
    const fallbackModel = this.provider.getFallbackModel?.();
    const decision = this.runtime?.get<RouteDecision>("evaluation-tournament-provider-route", input.attemptId) ?? this.routeMemory.get(input.attemptId);
    if (decision && (decision.fingerprint !== fingerprint || decision.model !== fallbackModel)) throw new Error("conflicting Tournament fallback model binding");
    if (decision) return (await this.runRoute(input, fingerprint, scenario, "FALLBACK", decision.model)).output;

    const primary = await this.runRoute(input, fingerprint, scenario, "PRIMARY", this.policy.model);
    if (!fallbackModel || !primary.timedOut || primary.otherFailure) return primary.output;
    const selected = { fingerprint, model: fallbackModel };
    this.routeMemory.set(input.attemptId, selected);
    this.runtime?.put("evaluation-tournament-provider-route", input.attemptId, selected);
    return (await this.runRoute(input, fingerprint, scenario, "FALLBACK", fallbackModel)).output;
  }

  private async runRoute(input: InferenceInput, fingerprint: string, scenario: EvaluationScenario, route: "PRIMARY" | "FALLBACK", model: string): Promise<{ output: PairOutput; timedOut: boolean; otherFailure: boolean }> {
    const routeFingerprint = route === "PRIMARY" ? fingerprint : sha256(`${fingerprint}|FALLBACK|${model}`);
    const rows = await Promise.allSettled((["A", "B"] as const).map(async (side) => {
      const key = route === "PRIMARY" ? `${input.attemptId}:${side}` : `${input.attemptId}:fallback:${side}`;
      const stored = this.runtime?.get<ProviderRecord>("evaluation-tournament-provider-runs", key) ?? this.memory.get(key);
      if (stored) {
        if (stored.fingerprint !== routeFingerprint || (stored.model && stored.model !== model) || (stored.route && stored.route !== route)) throw new Error("conflicting Tournament comparison provider binding");
        return { side, ...stored };
      }
      const agent = side === "A" ? input.agentA : input.agentB;
      const runId = sha256(["arena-tournament-evaluation-v1", input.attemptId, side].join("|"));
      const providerInput = buildEvaluationInput({ runId: runId as `sha256:${string}`, agentVersionId: agent.agentsVersion, agentsMd: agent.agentsMd, agentsCommitment: agent.agentsCommitment, scenario });
      const result = await this.provider.generate({ model, input: providerInput, maxOutputTokens: this.policy.maxOutputTokens, temperature: this.policy.temperature, operationKey: `tournament:${input.attemptId}:${side}`, route });
      if ((result.model && result.model !== model) || (result.route && result.route !== route) || (route === "FALLBACK" && (!result.model || !result.route))) throw new Error("Tournament provider returned a different model route");
      const record: ProviderRecord = { fingerprint: routeFingerprint, rawOutput: result.rawOutput, responseDigest: sha256Text(result.rawOutput), model, route };
      this.memory.set(key, structuredClone(record));
      this.runtime?.put("evaluation-tournament-provider-runs", key, record);
      return { side, ...record };
    }));
    const failures = rows.filter((row): row is PromiseRejectedResult => row.status === "rejected");
    const timedOut = failures.some((row) => classifyEvaluationProviderError(row.reason) === "PROVIDER_TIMEOUT");
    const otherFailure = failures.some((row) => classifyEvaluationProviderError(row.reason) !== "PROVIDER_TIMEOUT");
    const successes = rows.filter((row): row is PromiseFulfilledResult<{ side: "A" | "B" } & ProviderRecord> => row.status === "fulfilled").map((row) => row.value);
    const a = successes.find((row) => row.side === "A"); const b = successes.find((row) => row.side === "B");
    const output: PairOutput = !a || !b
      ? { state: "PARTIAL_PAIR", ...(failures.length ? { failureCode: classifyEvaluationProviderError(failures[0].reason) } : {}), ...(a ? { outputA: a.rawOutput, outputADigest: a.responseDigest as `sha256:${string}` } : {}), ...(b ? { outputB: b.rawOutput, outputBDigest: b.responseDigest as `sha256:${string}` } : {}) }
      : { state: "OUTPUTS_READY", outputA: a.rawOutput, outputB: b.rawOutput, outputADigest: a.responseDigest as `sha256:${string}`, outputBDigest: b.responseDigest as `sha256:${string}` };
    return { output, timedOut, otherFailure };
  }
}

export class TournamentComparisonJudgeAdapter implements OrchestratorJudge {
  constructor(privateTracker: ComparisonRunTracker) { this.tracker = privateTracker; }
  private readonly tracker: ComparisonRunTracker;
  async judge(input: InferenceInput & Required<Omit<PairOutput, "state">>) {
    const scenarioJson = JSON.stringify(toProviderScenario(tournamentScenario(input)));
    await this.tracker.submit({ matchId: input.matchId, attemptId: input.attemptId, agentVersionIdA: input.agentA.agentsVersion, agentVersionIdB: input.agentB.agentsVersion, mode: "RESPONSE", agentsMdA: input.agentA.agentsMd, agentsMdB: input.agentB.agentsMd, scenarioJson, responseJsonA: input.outputA, responseJsonB: input.outputB, agentsDigestA: input.agentA.agentsCommitment, agentsDigestB: input.agentB.agentsCommitment, scenarioDigest: sha256Text(scenarioJson), responseDigestA: input.outputADigest, responseDigestB: input.outputBDigest, rubricVersion: "AgentComparisonV1" });
    const outcome = await this.tracker.poll(input.matchId, input.attemptId);
    if (outcome.state !== "FINALIZED" || !outcome.run) return { state: outcome.state as "SUBMITTED" | "PENDING" | "ACCEPTED" | "FAILED" };
    if (outcome.run.result === "TIE" || outcome.run.result === "RETRYABLE") return { state: "FINALIZED" as const, result: outcome.run.result };
    return { state: "FINALIZED" as const, result: resultForTournamentProgression(outcome.run) };
  }
}

export function tournamentScenario(input: InferenceInput): EvaluationScenario {
  return { schema: "arena-test-scenario-v1", scenarioId: `tournament-${input.matchId.slice(7, 39)}`, version: "1.0.0", level: "RESPONSE", objective: input.topic, context: "", constraints: [], availableActions: [], forbiddenActionIds: [], confirmationRequiredActionIds: [], maxProposedActions: 0 };
}

function toProviderScenario(value: EvaluationScenario): EvaluationProviderInput["scenario"] {
  return buildEvaluationInput({ runId: sha256("arena-scenario-canonicalization") as `sha256:${string}`, agentVersionId: sha256("arena-scenario-agent") as `sha256:${string}`, agentsMd: "scenario canonicalizer", agentsCommitment: sha256Text("scenario canonicalizer"), scenario: value }).scenario;
}

function sha256(value: string): string { return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`; }
