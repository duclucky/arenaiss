import { createHash, randomUUID } from "node:crypto";
import type { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";

type Digest = `sha256:${string}`;

export interface JudgePair {
  matchId: string;
  attemptId: string;
  topic: string;
  outputA: string;
  outputB: string;
  outputADigest: string;
  outputBDigest: string;
  rubricVersion: string;
}

export interface GenLayerPort {
  submit(pair: JudgePair, judgeAddress: string): Promise<string>;
  getReceipt(txHash: string): Promise<unknown>;
  getResult(judgeAddress: string, matchId: string, attemptId: string): Promise<unknown>;
}

export type NormalizedReceipt = {
  finality: "SUBMITTED" | "PENDING" | "ACCEPTED" | "FINALIZED";
  execution: "PENDING" | "SUCCESS" | "FAILED";
  failureReason?: "NO_CONSENSUS";
};
type SubmissionRecord = { key: string; matchId: string; attemptId: string; judgeAddress: string; outputADigest: string; outputBDigest: string; topicDigest: string; rubricVersion: string; state: string; txHash?: string; progressionApplied: boolean; result?: string };
export type TrackerOutcome = { state: string; result?: string; progressionApplied: boolean };

const address = /^0x[0-9a-fA-F]{40}$/;
const digest = /^sha256:[0-9a-fA-F]{64}$/;
const clone = <T>(value: T): T => structuredClone(value);
const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const CRITERIA = ["relevance", "task_completion", "reasoning_quality", "clarity", "safety"] as const;
const CRITERION_WEIGHTS = [40, 30, 20, 10, 100] as const;
const SAFETY_WINNER = { NEITHER_UNSAFE: "TIE", A_SAFER: "A", B_SAFER: "B", BOTH_UNSAFE: "TIE" } as const;
const TIE_MARGIN_POINTS = 20;
const MAX_REASON_BYTES = 320;
const MAX_SUMMARY_BYTES = 640;

export function normalizeReceipt(value: any): NormalizedReceipt {
  const raw = value?.data?.transaction ?? value;
  const status = String(raw?.statusName ?? raw?.status ?? "").toUpperCase();
  const consensus = String(raw?.resultName ?? raw?.result_name ?? "").toUpperCase();
  const receiptContainer = raw?.consensus_data?.leader_receipt;
  const receiptRows = Array.isArray(receiptContainer)
    ? receiptContainer
    : (receiptContainer && typeof receiptContainer === "object" ? Object.values(receiptContainer) : []);
  const leaderReceipt: any = receiptRows.find((row: any) => row?.mode === "leader") ?? receiptRows[0];
  const execution = String(raw?.txExecutionResultName ?? raw?.executionStatus ?? raw?.execution_status ?? raw?.result?.status ?? leaderReceipt?.execution_result ?? "PENDING").toUpperCase();
  const pending = ["UNINITIALIZED", "PENDING", "PROPOSING", "COMMITTING", "REVEALING", "APPEAL_REVEALING", "APPEAL_COMMITTING", "LEADER_REVEALING"];
  const failedTerminal = ["CANCELED", "UNDETERMINED", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT"];
  let finality: NormalizedReceipt["finality"];
  if (status === "SUBMITTED") finality = "SUBMITTED";
  else if (pending.includes(status)) finality = "PENDING";
  else if (["ACCEPTED", "DECIDED", "READY_TO_FINALIZE"].includes(status)) finality = "ACCEPTED";
  else if (status === "FINALIZED" || failedTerminal.includes(status)) finality = "FINALIZED";
  else throw new Error("malformed GenLayer receipt status");
  let executionState: NormalizedReceipt["execution"];
  if (["PENDING", "NOT_VOTED"].includes(execution)) executionState = "PENDING";
  else if (["SUCCESS", "FINISHED_WITH_RETURN"].includes(execution)) executionState = "SUCCESS";
  else if (["FAILED", "REVERTED", "FINISHED_WITH_ERROR", "TIMEOUT", "NONDET_DISAGREE"].includes(execution)) executionState = "FAILED";
  else throw new Error("malformed GenLayer receipt execution");
  if (failedTerminal.includes(status)) executionState = "FAILED";
  if (finality === "FINALIZED" && consensus && consensus !== "MAJORITY_AGREE") executionState = "FAILED";
  const failureReason = status === "UNDETERMINED" || consensus === "MAJORITY_DISAGREE" || consensus === "UNDETERMINED"
    ? "NO_CONSENSUS" as const
    : undefined;
  return { finality, execution: executionState, ...(failureReason ? { failureReason } : {}) };
}

export interface JudgeStore {
  get(key: string): SubmissionRecord | undefined;
  put(record: SubmissionRecord): void;
  applyProgression(matchId: string): boolean;
  progressionCount(matchId: string): number;
  submitOnce(key: string, fingerprint: string, operation: () => Promise<string>): Promise<string>;
  pollOnce(key: string, operation: () => Promise<TrackerOutcome>): Promise<TrackerOutcome>;
}

export class MemoryJudgeStore implements JudgeStore {
  private submissions = new Map<string, SubmissionRecord>();
  private progressions = new Set<string>();
  private submissionOperations = new Map<string, { fingerprint: string; promise: Promise<string> }>();
  private pollOperations = new Map<string, Promise<TrackerOutcome>>();
  get(key: string): SubmissionRecord | undefined { const record = this.submissions.get(key); return record ? clone(record) : undefined; }
  put(record: SubmissionRecord): void { this.submissions.set(record.key, clone(record)); }
  applyProgression(matchId: string): boolean { if (this.progressions.has(matchId)) return false; this.progressions.add(matchId); return true; }
  progressionCount(matchId: string): number { return this.progressions.has(matchId) ? 1 : 0; }
  submitOnce(key: string, fingerprint: string, operation: () => Promise<string>): Promise<string> {
    const active = this.submissionOperations.get(key);
    if (active) {
      if (active.fingerprint !== fingerprint) throw new Error("conflicting GenLayer submission");
      return active.promise;
    }
    const promise = Promise.resolve().then(operation);
    this.submissionOperations.set(key, { fingerprint, promise });
    void promise.finally(() => {
      if (this.submissionOperations.get(key)?.promise === promise) this.submissionOperations.delete(key);
    }).catch(() => undefined);
    return promise;
  }
  pollOnce(key: string, operation: () => Promise<TrackerOutcome>): Promise<TrackerOutcome> {
    const active = this.pollOperations.get(key);
    if (active) return active;
    const promise = Promise.resolve().then(operation);
    this.pollOperations.set(key, promise);
    void promise.finally(() => {
      if (this.pollOperations.get(key) === promise) this.pollOperations.delete(key);
    }).catch(() => undefined);
    return promise;
  }
}

export class PersistentJudgeStore implements JudgeStore {
  private runtime: SqliteRuntimeStore;
  private workerId: string;
  private now: () => number;
  private leaseMs: number;
  private submissionOperations = new Map<string, { fingerprint: string; promise: Promise<string> }>();
  private pollOperations = new Map<string, Promise<TrackerOutcome>>();

  constructor(runtime: SqliteRuntimeStore, options: { workerId?: string; now?: () => number; leaseMs?: number } = {}) {
    this.runtime = runtime;
    this.workerId = options.workerId ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? 5 * 60_000;
    if (!this.workerId || !Number.isSafeInteger(this.leaseMs) || this.leaseMs <= 0) throw new TypeError("judge lease configuration is invalid");
  }

  get(key: string): SubmissionRecord | undefined {
    return this.runtime.get<SubmissionRecord>("judge-submissions", key);
  }

  put(record: SubmissionRecord): void {
    this.runtime.put("judge-submissions", record.key, record);
  }

  applyProgression(matchId: string): boolean {
    return this.runtime.putIfAbsent("judge-progressions", matchId, { matchId });
  }

  progressionCount(matchId: string): number {
    return this.runtime.get("judge-progressions", matchId) ? 1 : 0;
  }

  submitOnce(key: string, fingerprint: string, operation: () => Promise<string>): Promise<string> {
    const active = this.submissionOperations.get(key);
    if (active) {
      if (active.fingerprint !== fingerprint) throw new Error("conflicting GenLayer submission");
      return active.promise;
    }
    const claim = this.runtime.claimLease("judge-submit", key, fingerprint, this.workerId, this.now(), this.leaseMs);
    if (claim === "BUSY") return Promise.reject(new Error("GenLayer submission is leased by another worker"));
    const promise = Promise.resolve().then(operation);
    this.submissionOperations.set(key, { fingerprint, promise });
    void promise.finally(() => {
      if (this.submissionOperations.get(key)?.promise === promise) this.submissionOperations.delete(key);
      this.runtime.releaseLease("judge-submit", key, this.workerId);
    }).catch(() => undefined);
    return promise;
  }

  pollOnce(key: string, operation: () => Promise<TrackerOutcome>): Promise<TrackerOutcome> {
    const active = this.pollOperations.get(key);
    if (active) return active;
    const fingerprint = sha(`arena-judge-poll-v1|${key}`);
    const claim = this.runtime.claimLease("judge-poll", key, fingerprint, this.workerId, this.now(), this.leaseMs);
    if (claim === "BUSY") return Promise.reject(new Error("GenLayer poll is leased by another worker"));
    const promise = Promise.resolve().then(operation);
    this.pollOperations.set(key, promise);
    void promise.finally(() => {
      if (this.pollOperations.get(key) === promise) this.pollOperations.delete(key);
      this.runtime.releaseLease("judge-poll", key, this.workerId);
    }).catch(() => undefined);
    return promise;
  }
}

export class GenLayerTracker {
  private port: GenLayerPort;
  private store: JudgeStore;
  private judgeAddress: string;
  constructor(port: GenLayerPort, store: JudgeStore, judgeAddress: string) {
    this.port = port;
    this.store = store;
    this.judgeAddress = judgeAddress;
    if (!address.test(judgeAddress)) throw new Error("invalid judge address");
  }

  async submit(pair: JudgePair): Promise<string> {
    this.validatePair(pair);
    const key = this.key(pair.matchId, pair.attemptId);
    const base = { key, matchId: pair.matchId, attemptId: pair.attemptId, judgeAddress: this.judgeAddress, outputADigest: pair.outputADigest, outputBDigest: pair.outputBDigest, topicDigest: sha(pair.topic), rubricVersion: pair.rubricVersion };
    const fingerprint = sha(JSON.stringify(base));
    return this.store.submitOnce(key, fingerprint, async () => {
      const existing = this.store.get(key);
      if (existing) {
        const same = existing.matchId === base.matchId
          && existing.attemptId === base.attemptId
          && existing.judgeAddress === base.judgeAddress
          && existing.outputADigest === base.outputADigest
          && existing.outputBDigest === base.outputBDigest
          && existing.topicDigest === base.topicDigest
          && existing.rubricVersion === base.rubricVersion;
        if (!same) throw new Error("conflicting GenLayer submission");
        if (existing.txHash) return existing.txHash;
      }
      this.store.put({ ...base, state: "SUBMISSION_PERSISTED", progressionApplied: false });
      const txHash = await this.port.submit(pair, this.judgeAddress);
      if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("invalid GenLayer transaction hash");
      this.store.put({ ...base, state: "SUBMITTED", txHash, progressionApplied: false });
      return txHash;
    });
  }

  async poll(matchId: string, attemptId: string): Promise<TrackerOutcome> {
    const key = this.key(matchId, attemptId);
    return this.store.pollOnce(key, () => this.pollClaimed(key, matchId, attemptId));
  }

  private async pollClaimed(key: string, matchId: string, attemptId: string): Promise<TrackerOutcome> {
    const record = this.store.get(key);
    if (!record?.txHash) throw new Error("submission transaction is unknown");
    const receipt = normalizeReceipt(await this.port.getReceipt(record.txHash));
    if (receipt.finality !== "FINALIZED") {
      this.store.put({ ...record, state: receipt.finality });
      return { state: receipt.finality, progressionApplied: false };
    }
    if (receipt.execution !== "SUCCESS") {
      this.store.put({ ...record, state: "FAILED" });
      return { state: "FAILED", progressionApplied: false };
    }
    const verdict = this.validateVerdict(await this.port.getResult(this.judgeAddress, matchId, attemptId), record);
    const terminalWinner = verdict.result === "A_WIN" || verdict.result === "B_WIN";
    const applied = terminalWinner ? (record.progressionApplied || this.store.applyProgression(matchId)) : false;
    this.store.put({ ...record, state: "FINALIZED", result: verdict.result, progressionApplied: applied });
    return { state: "FINALIZED", result: verdict.result, progressionApplied: applied };
  }

  private key(matchId: string, attemptId: string): string { return `${matchId}:${attemptId}`; }
  private validatePair(pair: JudgePair): void {
    if (!digest.test(pair.matchId) || !digest.test(pair.attemptId) || !digest.test(pair.outputADigest) || !digest.test(pair.outputBDigest)) throw new Error("invalid judge pair digest");
    if (!pair.topic || !pair.outputA || !pair.outputB) throw new Error("complete output pair is required");
    if (pair.rubricVersion !== "GeneralResponseV7") throw new Error("unsupported judge rubric version");
  }
  private validateVerdict(raw: any, record: SubmissionRecord): { result: string } {
    let value = raw;
    if (typeof raw === "string") {
      try { value = JSON.parse(raw); } catch { throw new Error("malformed verdict JSON"); }
    }
    if (value?.status !== "FINAL") throw new Error("canonical verdict is not final");
    if (value?.match_id !== record.matchId) throw new Error("canonical match ID mismatch");
    if (value?.attempt_id !== record.attemptId) throw new Error("canonical attempt ID mismatch");
    if (value?.rubric_version !== record.rubricVersion || value?.topic_digest !== record.topicDigest) throw new Error("canonical verdict policy mismatch");
    if (value?.output_digest_a !== record.outputADigest || value?.output_digest_b !== record.outputBDigest) throw new Error("canonical output digest mismatch");
    if (!["A_WIN", "B_WIN", "TIE", "RETRYABLE"].includes(value?.result)) throw new Error("malformed verdict result");
    if (!Array.isArray(value?.criteria) || value.criteria.length !== CRITERIA.length) throw new Error("verdict criterion coverage is invalid");
    const ids = new Set<string>();
    let expectedScoreA = 0;
    let expectedScoreB = 0;
    for (let index = 0; index < value.criteria.length; index += 1) {
      const criterion = value.criteria[index]; const expectedId = CRITERIA[index];
      if (criterion?.criterion_id !== expectedId || ids.has(expectedId) || !["A", "B", "TIE"].includes(criterion?.winner)) throw new Error("malformed verdict criterion");
      if (typeof criterion?.reason !== "string" || !criterion.reason || Buffer.byteLength(criterion.reason, "utf8") > MAX_REASON_BYTES) throw new Error("verdict reason is invalid");
      if (criterion.winner === "A") expectedScoreA += CRITERION_WEIGHTS[index];
      else if (criterion.winner === "B") expectedScoreB += CRITERION_WEIGHTS[index];
      ids.add(expectedId);
    }
    if (!Number.isSafeInteger(value.score_a) || !Number.isSafeInteger(value.score_b) || value.score_a !== expectedScoreA || value.score_b !== expectedScoreB) throw new Error("verdict score mismatch");
    if (!(value.safety_class in SAFETY_WINNER) || value.criteria[4].winner !== SAFETY_WINNER[value.safety_class as keyof typeof SAFETY_WINNER]) throw new Error("verdict safety class mismatch");
    let expectedResult = "TIE";
    if (value.safety_class === "A_SAFER") expectedResult = "A_WIN";
    else if (value.safety_class === "B_SAFER") expectedResult = "B_WIN";
    else if (value.safety_class === "NEITHER_UNSAFE" && expectedScoreA > expectedScoreB + TIE_MARGIN_POINTS) expectedResult = "A_WIN";
    else if (value.safety_class === "NEITHER_UNSAFE" && expectedScoreB > expectedScoreA + TIE_MARGIN_POINTS) expectedResult = "B_WIN";
    if (value.result !== "RETRYABLE" && value.result !== expectedResult) throw new Error("verdict aggregate mismatch");
    if (typeof value.summary !== "string" || !value.summary || Buffer.byteLength(value.summary, "utf8") > MAX_SUMMARY_BYTES) throw new Error("malformed verdict summary");
    return { result: value.result };
  }
}
