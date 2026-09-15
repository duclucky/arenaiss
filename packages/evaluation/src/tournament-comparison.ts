import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";

export type TournamentResult = "A_WIN" | "B_WIN" | "TIE" | "RETRYABLE";

export interface LegacyMatchAttempt {
  matchId: string;
  attemptId: string;
  agentVersionIdA: string;
  agentVersionIdB: string;
  topicDigest: string;
  outputDigestA: string;
  outputDigestB: string;
  rubricVersion: "GeneralResponseV7";
  networkChainId: number;
  judgeAddress: string;
  transactionHash: string;
  finality: "FINALIZED";
  execution: "SUCCESS";
  result: TournamentResult;
}

export interface RichComparisonAttempt {
  matchId: string;
  attemptId: string;
  agentVersionIdA: string;
  agentVersionIdB: string;
  scenarioDigest: string;
  responseDigestA: string;
  responseDigestB: string;
  rubricVersion: "AgentComparisonV1";
  networkChainId: number;
  judgeAddress: string;
  transactionHash: string;
  finality: "SUBMITTED" | "PENDING" | "ACCEPTED" | "FINALIZED";
  execution: "PENDING" | "SUCCESS" | "FAILED";
  result?: TournamentResult;
  scorecard?: Record<string, unknown>;
}

export interface ComparisonRun {
  schema: "arena-comparison-run-v1";
  comparisonRunId: string;
  sourceKind: "LEGACY_TOURNAMENT" | "RICH_TOURNAMENT";
  source: { matchId: string; attemptId: string };
  agents: { versionIdA: string; versionIdB: string };
  evidence: { scenarioDigest: string; responseDigestA: string; responseDigestB: string; rubricVersion: string };
  judge: { networkChainId: number; address: string; transactionHash: string; finality: string; execution: string };
  result?: TournamentResult;
  scorecard?: Record<string, unknown>;
  progressionEligible: boolean;
}

export function comparisonRunId(_matchId: string, _attemptId: string): string {
  requireDigest(_matchId, "match ID");
  requireDigest(_attemptId, "attempt ID");
  return sha256(`arena-comparison-run-v1|${_matchId}|${_attemptId}`);
}

export function projectLegacyMatchAttempt(source: LegacyMatchAttempt): ComparisonRun {
  validateCommon(source);
  if (source.rubricVersion !== "GeneralResponseV7") throw new TypeError("legacy rubric is unsupported");
  requireDigest(source.topicDigest, "topic digest");
  const progressionEligible = source.finality === "FINALIZED" && source.execution === "SUCCESS"
    && (source.result === "A_WIN" || source.result === "B_WIN");
  return {
    schema: "arena-comparison-run-v1",
    comparisonRunId: comparisonRunId(source.matchId, source.attemptId),
    sourceKind: "LEGACY_TOURNAMENT",
    source: { matchId: source.matchId, attemptId: source.attemptId },
    agents: { versionIdA: source.agentVersionIdA, versionIdB: source.agentVersionIdB },
    evidence: { scenarioDigest: source.topicDigest, responseDigestA: source.outputDigestA, responseDigestB: source.outputDigestB, rubricVersion: source.rubricVersion },
    judge: { networkChainId: source.networkChainId, address: source.judgeAddress, transactionHash: source.transactionHash, finality: source.finality, execution: source.execution },
    result: source.result,
    progressionEligible,
  };
}

export function projectRichComparisonAttempt(source: RichComparisonAttempt): ComparisonRun {
  validateCommon(source);
  if (source.rubricVersion !== "AgentComparisonV1") throw new TypeError("rich comparison rubric is unsupported");
  const canonical = source.scorecard;
  const canonicalBindingMatches = canonical?.status === "FINAL"
    && canonical.match_id === source.matchId
    && canonical.attempt_id === source.attemptId
    && canonical.agent_version_id_a === source.agentVersionIdA
    && canonical.agent_version_id_b === source.agentVersionIdB
    && canonical.scenario_digest === source.scenarioDigest
    && canonical.response_digest_a === source.responseDigestA
    && canonical.response_digest_b === source.responseDigestB
    && canonical.rubric_version === source.rubricVersion
    && canonical.result === source.result;
  const progressionEligible = source.finality === "FINALIZED" && source.execution === "SUCCESS"
    && (source.result === "A_WIN" || source.result === "B_WIN") && canonicalBindingMatches;
  return {
    schema: "arena-comparison-run-v1",
    comparisonRunId: comparisonRunId(source.matchId, source.attemptId),
    sourceKind: "RICH_TOURNAMENT",
    source: { matchId: source.matchId, attemptId: source.attemptId },
    agents: { versionIdA: source.agentVersionIdA, versionIdB: source.agentVersionIdB },
    evidence: { scenarioDigest: source.scenarioDigest, responseDigestA: source.responseDigestA, responseDigestB: source.responseDigestB, rubricVersion: source.rubricVersion },
    judge: { networkChainId: source.networkChainId, address: source.judgeAddress, transactionHash: source.transactionHash, finality: source.finality, execution: source.execution },
    ...(source.result ? { result: source.result } : {}),
    ...(source.scorecard ? { scorecard: structuredClone(source.scorecard) } : {}),
    progressionEligible,
  };
}

export function resultForTournamentProgression(run: ComparisonRun): "A_WIN" | "B_WIN" {
  if (!run.progressionEligible || (run.result !== "A_WIN" && run.result !== "B_WIN")) {
    throw new Error("eligible terminal comparison result is required for progression");
  }
  return run.result;
}

export class ComparisonRunRegistry {
  private readonly memory = new Map<string, ComparisonRun>();
  private readonly runtime?: SqliteRuntimeStore;

  constructor(runtime?: SqliteRuntimeStore) { this.runtime = runtime; }

  put(run: ComparisonRun): ComparisonRun {
    validateProjection(run);
    const existing = this.get(run.comparisonRunId);
    if (existing) {
      if (!isDeepStrictEqual(existing, run)) throw new Error("conflicting immutable comparison projection");
      return existing;
    }
    const value = structuredClone(run);
    this.memory.set(run.comparisonRunId, value);
    this.runtime?.put("evaluation-comparison-runs", run.comparisonRunId, value);
    return structuredClone(value);
  }

  get(id: string): ComparisonRun | undefined {
    requireDigest(id, "comparison run ID");
    const value = this.runtime?.get<ComparisonRun>("evaluation-comparison-runs", id) ?? this.memory.get(id);
    return value ? structuredClone(value) : undefined;
  }
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function requireDigest(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${name} is invalid`);
}

function validateCommon(source: LegacyMatchAttempt | RichComparisonAttempt): void {
  requireDigest(source.matchId, "match ID");
  requireDigest(source.attemptId, "attempt ID");
  requireDigest(source.agentVersionIdA, "Agent A version ID");
  requireDigest(source.agentVersionIdB, "Agent B version ID");
  const scenarioDigest = "topicDigest" in source ? source.topicDigest : source.scenarioDigest;
  const responseDigestA = "outputDigestA" in source ? source.outputDigestA : source.responseDigestA;
  const responseDigestB = "outputDigestB" in source ? source.outputDigestB : source.responseDigestB;
  requireDigest(scenarioDigest, "scenario digest");
  requireDigest(responseDigestA, "response A digest");
  requireDigest(responseDigestB, "response B digest");
  if (!Number.isSafeInteger(source.networkChainId) || source.networkChainId <= 0) throw new TypeError("network chain ID is invalid");
  if (!ADDRESS.test(source.judgeAddress) || !TX.test(source.transactionHash)) throw new TypeError("judge evidence is invalid");
  if (source.result !== undefined && !["A_WIN", "B_WIN", "TIE", "RETRYABLE"].includes(source.result)) throw new TypeError("comparison result is invalid");
}

function validateProjection(run: ComparisonRun): void {
  if (run?.schema !== "arena-comparison-run-v1") throw new TypeError("comparison projection schema is invalid");
  if (run.comparisonRunId !== comparisonRunId(run.source?.matchId, run.source?.attemptId)) throw new TypeError("comparison projection identity is invalid");
  if (run.sourceKind !== "LEGACY_TOURNAMENT" && run.sourceKind !== "RICH_TOURNAMENT") throw new TypeError("comparison source kind is invalid");
  requireDigest(run.agents?.versionIdA, "Agent A version ID");
  requireDigest(run.agents?.versionIdB, "Agent B version ID");
  requireDigest(run.evidence?.scenarioDigest, "scenario digest");
  requireDigest(run.evidence?.responseDigestA, "response A digest");
  requireDigest(run.evidence?.responseDigestB, "response B digest");
  if (!ADDRESS.test(run.judge?.address) || !TX.test(run.judge?.transactionHash)) throw new TypeError("comparison judge evidence is invalid");
  if (run.progressionEligible && run.result !== "A_WIN" && run.result !== "B_WIN") throw new TypeError("eligible comparison result is invalid");
}
