import { createHash } from "node:crypto";

import {
  ComparisonRunRegistry,
  projectRichComparisonAttempt,
  type ComparisonRun,
  type TournamentResult,
} from "../../evaluation/src/tournament-comparison.ts";
import type { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";
import { normalizeReceipt } from "./tracker.ts";

export interface ComparisonJudgeSubmission {
  matchId: string;
  attemptId: string;
  agentVersionIdA: string;
  agentVersionIdB: string;
  mode: "RESPONSE" | "ACTION_DECISION";
  agentsMdA: string;
  agentsMdB: string;
  scenarioJson: string;
  responseJsonA: string;
  responseJsonB: string;
  agentsDigestA: string;
  agentsDigestB: string;
  scenarioDigest: string;
  responseDigestA: string;
  responseDigestB: string;
  rubricVersion: "AgentComparisonV1";
}

export interface ComparisonJudgePort {
  submit(value: ComparisonJudgeSubmission, judgeAddress: string): Promise<string>;
  getReceipt(transactionHash: string): Promise<unknown>;
  getComparison(judgeAddress: string, matchId: string, attemptId: string): Promise<unknown>;
}

type SubmissionRecord = {
  key: string;
  fingerprint: string;
  submission: ComparisonJudgeSubmission;
  transactionHash?: string;
  state: string;
};

export interface ComparisonSubmissionStore {
  get(key: string): SubmissionRecord | undefined;
  put(record: SubmissionRecord): void;
}

export class MemoryComparisonSubmissionStore implements ComparisonSubmissionStore {
  private readonly records = new Map<string, SubmissionRecord>();
  get(key: string): SubmissionRecord | undefined { const value = this.records.get(key); return value ? structuredClone(value) : undefined; }
  put(record: SubmissionRecord): void { this.records.set(record.key, structuredClone(record)); }
}

export class PersistentComparisonSubmissionStore implements ComparisonSubmissionStore {
  private readonly runtime: SqliteRuntimeStore;
  constructor(runtime: SqliteRuntimeStore) { this.runtime = runtime; }
  get(key: string): SubmissionRecord | undefined { return this.runtime.get<SubmissionRecord>("comparison-submissions", key); }
  put(record: SubmissionRecord): void { this.runtime.put("comparison-submissions", record.key, record); }
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const DIMENSIONS = ["instruction_adherence", "reasoning_quality", "action_selection", "rule_compliance", "task_completion", "safety"];

export class ComparisonRunTracker {
  private readonly port: ComparisonJudgePort;
  private readonly store: ComparisonSubmissionStore;
  private readonly registry: ComparisonRunRegistry;
  private readonly judgeAddress: string;
  private readonly networkChainId: number;
  constructor(
    port: ComparisonJudgePort,
    store: ComparisonSubmissionStore,
    registry: ComparisonRunRegistry,
    judgeAddress: string,
    networkChainId: number,
  ) {
    this.port = port;
    this.store = store;
    this.registry = registry;
    this.judgeAddress = judgeAddress;
    this.networkChainId = networkChainId;
    if (!ADDRESS.test(judgeAddress) || !Number.isSafeInteger(networkChainId) || networkChainId <= 0) throw new TypeError("comparison judge network is invalid");
  }

  async submit(submission: ComparisonJudgeSubmission): Promise<string> {
    this.validateSubmission(submission);
    const key = this.key(submission.matchId, submission.attemptId);
    const fingerprint = sha256(JSON.stringify({ judgeAddress: this.judgeAddress, networkChainId: this.networkChainId, submission }));
    const existing = this.store.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("conflicting comparison submission");
      if (existing.transactionHash) return existing.transactionHash;
    }
    this.store.put({ key, fingerprint, submission: structuredClone(submission), state: "SUBMISSION_PERSISTED" });
    const transactionHash = await this.port.submit(submission, this.judgeAddress);
    if (!TX.test(transactionHash)) throw new Error("invalid comparison transaction hash");
    this.store.put({ key, fingerprint, submission: structuredClone(submission), transactionHash, state: "SUBMITTED" });
    return transactionHash;
  }

  async poll(matchId: string, attemptId: string): Promise<{ state: string; run?: ComparisonRun }> {
    const key = this.key(matchId, attemptId);
    const record = this.store.get(key);
    if (!record?.transactionHash) throw new Error("comparison transaction is unknown");
    const receipt = normalizeReceipt(await this.port.getReceipt(record.transactionHash));
    if (receipt.finality !== "FINALIZED" || receipt.execution === "PENDING") {
      const state = receipt.finality === "FINALIZED" ? "PENDING" : receipt.finality;
      this.store.put({ ...record, state });
      return { state };
    }
    if (receipt.execution === "FAILED") {
      this.store.put({ ...record, state: "FAILED" });
      return { state: "FAILED" };
    }
    const scorecard = this.validateCanonical(await this.port.getComparison(this.judgeAddress, matchId, attemptId), record.submission);
    const run = this.registry.put(projectRichComparisonAttempt({
      matchId, attemptId,
      agentVersionIdA: record.submission.agentVersionIdA,
      agentVersionIdB: record.submission.agentVersionIdB,
      scenarioDigest: record.submission.scenarioDigest,
      responseDigestA: record.submission.responseDigestA,
      responseDigestB: record.submission.responseDigestB,
      rubricVersion: "AgentComparisonV1",
      networkChainId: this.networkChainId,
      judgeAddress: this.judgeAddress,
      transactionHash: record.transactionHash,
      finality: "FINALIZED",
      execution: "SUCCESS",
      result: scorecard.result as TournamentResult,
      scorecard,
    }));
    this.store.put({ ...record, state: "FINALIZED" });
    return { state: "FINALIZED", run };
  }

  private key(matchId: string, attemptId: string): string { return `${matchId}:${attemptId}`; }

  private validateSubmission(value: ComparisonJudgeSubmission): void {
    for (const [name, item] of Object.entries({ matchId: value.matchId, attemptId: value.attemptId, agentVersionIdA: value.agentVersionIdA, agentVersionIdB: value.agentVersionIdB, agentsDigestA: value.agentsDigestA, agentsDigestB: value.agentsDigestB, scenarioDigest: value.scenarioDigest, responseDigestA: value.responseDigestA, responseDigestB: value.responseDigestB })) {
      if (!DIGEST.test(item)) throw new TypeError(`${name} is invalid`);
    }
    if (value.rubricVersion !== "AgentComparisonV1" || !["RESPONSE", "ACTION_DECISION"].includes(value.mode)) throw new TypeError("comparison policy is invalid");
    if (sha256(value.agentsMdA) !== value.agentsDigestA || sha256(value.agentsMdB) !== value.agentsDigestB || sha256(value.scenarioJson) !== value.scenarioDigest || sha256(value.responseJsonA) !== value.responseDigestA || sha256(value.responseJsonB) !== value.responseDigestB) throw new TypeError("comparison evidence digest mismatch");
  }

  private validateCanonical(raw: unknown, submission: ComparisonJudgeSubmission): Record<string, unknown> {
    let value: any = raw;
    if (typeof raw === "string") { try { value = JSON.parse(raw); } catch { throw new Error("canonical comparison JSON is malformed"); } }
    if (!value || value.status !== "FINAL") throw new Error("canonical comparison is not final");
    const pairs: Array<[unknown, unknown]> = [
      [value.match_id, submission.matchId], [value.attempt_id, submission.attemptId],
      [value.agent_version_id_a, submission.agentVersionIdA], [value.agent_version_id_b, submission.agentVersionIdB],
      [value.mode, submission.mode], [value.agents_digest_a, submission.agentsDigestA], [value.agents_digest_b, submission.agentsDigestB],
      [value.scenario_digest, submission.scenarioDigest], [value.response_digest_a, submission.responseDigestA], [value.response_digest_b, submission.responseDigestB],
      [value.rubric_version, submission.rubricVersion],
    ];
    if (pairs.some(([actual, expected]) => actual !== expected)) throw new Error("canonical comparison binding mismatch");
    if (!["A_WIN", "B_WIN", "TIE"].includes(value.result) || value.actions_executed !== false) throw new Error("canonical comparison result is invalid");
    if (!Array.isArray(value.dimensions) || value.dimensions.length !== DIMENSIONS.length || value.dimensions.some((row: any, index: number) => row?.dimension_id !== DIMENSIONS[index] || !["A", "B", "TIE"].includes(row?.winner))) throw new Error("canonical comparison dimensions are invalid");
    if (!Array.isArray(value.policy_findings_a) || !Array.isArray(value.policy_findings_b)) throw new Error("canonical comparison policy findings are invalid");
    return structuredClone(value);
  }
}

function sha256(value: string): string { return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`; }
