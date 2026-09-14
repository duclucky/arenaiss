import { createHash, randomUUID } from "node:crypto";
import type { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";

export interface SettlementInput {
  tournamentId: string;
  rankedEntrants: readonly string[];
  settlementNonce: string;
  grossPool: string;
  payoutBps: readonly number[];
}

export type SettlementView = { fee: string; credits: readonly string[]; totalLiability: string };
export interface ArcSettlementPort {
  sendSettlement(input: { tournamentId: string; rankedEntrants: readonly string[]; rankingDigest: string; settlementNonce: string }): Promise<string>;
  getReceipt(txHash: string): Promise<unknown>;
  readSettlement(tournamentId: string): Promise<SettlementView>;
}

type RecordState = "PERSISTED" | "SUBMITTED" | "PENDING" | "COMPLETE" | "SETTLEMENT_REJECTED" | "RECOVERY_REQUIRED";
type SettlementRecord = { tournamentId: string; inputDigest: string; rankingDigest: string; state: RecordState; txHash?: string };
export type SettlementOutcome = { state: RecordState };
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

function normalizeArcReceipt(receipt: unknown): "PENDING" | "SUCCESS" | "FAILED" {
  const status = (receipt as { status?: unknown } | null | undefined)?.status;
  if (status === undefined || status === null) return "PENDING";
  if (status === 1 || status === "success") return "SUCCESS";
  if (status === 0 || status === "reverted") return "FAILED";
  throw new Error("malformed Arc transaction receipt");
}

export interface SettlementStore {
  get(tournamentId: string): SettlementRecord | undefined;
  put(record: SettlementRecord): void;
  submitOnce(tournamentId: string, inputDigest: string, operation: () => Promise<string>): Promise<string>;
  reconcileOnce(tournamentId: string, operation: () => Promise<SettlementOutcome>): Promise<SettlementOutcome>;
}

export function expectedCredits(grossPool: string, payoutBps: readonly number[]): SettlementView {
  if (!/^(0|[1-9][0-9]*)$/.test(grossPool)) throw new Error("gross pool is invalid");
  if (payoutBps.length !== 5 || payoutBps.some((bps) => !Number.isSafeInteger(bps) || bps < 0) || payoutBps.reduce((sum, bps) => sum + bps, 0) !== 10_000) throw new Error("payout BPS are invalid");
  const gross = BigInt(grossPool); const fee = gross * 1_000n / 10_000n; const net = gross - fee;
  const credits = payoutBps.map((bps) => net * BigInt(bps) / 10_000n);
  const remainder = net - credits.reduce((sum, credit) => sum + credit, 0n);
  credits[0] += remainder;
  return { fee: fee.toString(), credits: credits.map(String), totalLiability: gross.toString() };
}

export class MemorySettlementStore implements SettlementStore {
  private records = new Map<string, SettlementRecord>();
  private settlementOperations = new Map<string, { inputDigest: string; promise: Promise<string> }>();
  private reconcileOperations = new Map<string, Promise<SettlementOutcome>>();
  get(tournamentId: string): SettlementRecord | undefined { const record = this.records.get(tournamentId); return record ? structuredClone(record) : undefined; }
  put(record: SettlementRecord): void { this.records.set(record.tournamentId, structuredClone(record)); }
  submitOnce(tournamentId: string, inputDigest: string, operation: () => Promise<string>): Promise<string> {
    const active = this.settlementOperations.get(tournamentId);
    if (active) {
      if (active.inputDigest !== inputDigest) throw new Error("conflicting settlement operation");
      return active.promise;
    }
    const promise = Promise.resolve().then(operation);
    this.settlementOperations.set(tournamentId, { inputDigest, promise });
    void promise.finally(() => {
      if (this.settlementOperations.get(tournamentId)?.promise === promise) this.settlementOperations.delete(tournamentId);
    }).catch(() => undefined);
    return promise;
  }
  reconcileOnce(tournamentId: string, operation: () => Promise<SettlementOutcome>): Promise<SettlementOutcome> {
    const active = this.reconcileOperations.get(tournamentId);
    if (active) return active;
    const promise = Promise.resolve().then(operation);
    this.reconcileOperations.set(tournamentId, promise);
    void promise.finally(() => {
      if (this.reconcileOperations.get(tournamentId) === promise) this.reconcileOperations.delete(tournamentId);
    }).catch(() => undefined);
    return promise;
  }
}

export class PersistentSettlementStore implements SettlementStore {
  private runtime: SqliteRuntimeStore;
  private workerId: string;
  private now: () => number;
  private leaseMs: number;
  private settlementOperations = new Map<string, { inputDigest: string; promise: Promise<string> }>();
  private reconcileOperations = new Map<string, Promise<SettlementOutcome>>();

  constructor(runtime: SqliteRuntimeStore, options: { workerId?: string; now?: () => number; leaseMs?: number } = {}) {
    this.runtime = runtime;
    this.workerId = options.workerId ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? 5 * 60_000;
    if (!this.workerId || !Number.isSafeInteger(this.leaseMs) || this.leaseMs <= 0) throw new TypeError("settlement lease configuration is invalid");
  }

  get(tournamentId: string): SettlementRecord | undefined {
    return this.runtime.get<SettlementRecord>("settlements", tournamentId);
  }

  put(record: SettlementRecord): void {
    this.runtime.put("settlements", record.tournamentId, record);
  }

  submitOnce(tournamentId: string, inputDigest: string, operation: () => Promise<string>): Promise<string> {
    const active = this.settlementOperations.get(tournamentId);
    if (active) {
      if (active.inputDigest !== inputDigest) throw new Error("conflicting settlement operation");
      return active.promise;
    }
    const claim = this.runtime.claimLease("settlement-submit", tournamentId, inputDigest, this.workerId, this.now(), this.leaseMs);
    if (claim === "BUSY") return Promise.reject(new Error("settlement operation is leased by another worker"));
    const promise = Promise.resolve().then(operation);
    this.settlementOperations.set(tournamentId, { inputDigest, promise });
    void promise.finally(() => {
      if (this.settlementOperations.get(tournamentId)?.promise === promise) this.settlementOperations.delete(tournamentId);
      this.runtime.releaseLease("settlement-submit", tournamentId, this.workerId);
    }).catch(() => undefined);
    return promise;
  }

  reconcileOnce(tournamentId: string, operation: () => Promise<SettlementOutcome>): Promise<SettlementOutcome> {
    const active = this.reconcileOperations.get(tournamentId);
    if (active) return active;
    const fingerprint = `reconcile:${tournamentId}`;
    const claim = this.runtime.claimLease("settlement-reconcile", tournamentId, fingerprint, this.workerId, this.now(), this.leaseMs);
    if (claim === "BUSY") return Promise.reject(new Error("settlement reconciliation is leased by another worker"));
    const promise = Promise.resolve().then(operation);
    this.reconcileOperations.set(tournamentId, promise);
    void promise.finally(() => {
      if (this.reconcileOperations.get(tournamentId) === promise) this.reconcileOperations.delete(tournamentId);
      this.runtime.releaseLease("settlement-reconcile", tournamentId, this.workerId);
    }).catch(() => undefined);
    return promise;
  }
}

export class SettlementWorker {
  private arc: ArcSettlementPort;
  private store: SettlementStore;
  constructor(arc: ArcSettlementPort, store: SettlementStore) { this.arc = arc; this.store = store; }

  async submit(input: SettlementInput): Promise<string> {
    const normalized = this.validate(input);
    return this.store.submitOnce(input.tournamentId, normalized.inputDigest, async () => {
      const existing = this.store.get(input.tournamentId);
      if (existing) {
        if (existing.inputDigest !== normalized.inputDigest) throw new Error("conflicting settlement operation");
        if (existing.txHash) return existing.txHash;
      }
      this.store.put({ tournamentId: input.tournamentId, inputDigest: normalized.inputDigest, rankingDigest: normalized.rankingDigest, state: "PERSISTED" });
      const txHash = await this.arc.sendSettlement({ tournamentId: input.tournamentId, rankedEntrants: input.rankedEntrants, rankingDigest: normalized.rankingDigest, settlementNonce: input.settlementNonce });
      if (!BYTES32.test(txHash)) throw new Error("invalid Arc transaction hash");
      this.store.put({ tournamentId: input.tournamentId, inputDigest: normalized.inputDigest, rankingDigest: normalized.rankingDigest, state: "SUBMITTED", txHash });
      return txHash;
    });
  }

  async reconcile(input: SettlementInput): Promise<SettlementOutcome> {
    const normalized = this.validate(input);
    return this.store.reconcileOnce(input.tournamentId, () => this.reconcileClaimed(input, normalized));
  }

  private async reconcileClaimed(input: SettlementInput, normalized: { inputDigest: string; rankingDigest: string }): Promise<SettlementOutcome> {
    const record = this.store.get(input.tournamentId);
    if (!record?.txHash || record.inputDigest !== normalized.inputDigest) throw new Error("settlement transaction is unknown or conflicting");
    const receiptState = normalizeArcReceipt(await this.arc.getReceipt(record.txHash));
    if (receiptState === "PENDING") { this.store.put({ ...record, state: "PENDING" }); return { state: "PENDING" }; }
    if (receiptState === "FAILED") { this.store.put({ ...record, state: "SETTLEMENT_REJECTED" }); return { state: "SETTLEMENT_REJECTED" }; }
    const actual = await this.arc.readSettlement(input.tournamentId); const expected = expectedCredits(input.grossPool, input.payoutBps);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) { this.store.put({ ...record, state: "RECOVERY_REQUIRED" }); return { state: "RECOVERY_REQUIRED" }; }
    this.store.put({ ...record, state: "COMPLETE" }); return { state: "COMPLETE" };
  }

  private validate(input: SettlementInput): { inputDigest: string; rankingDigest: string } {
    if (Object.prototype.hasOwnProperty.call(input, "payoutAmounts")) throw new Error("caller-supplied payout amounts are forbidden");
    if (!BYTES32.test(input.tournamentId) || /^0x0{64}$/i.test(input.tournamentId)) throw new Error("tournament ID is invalid");
    if (input.rankedEntrants.length !== 5 || input.rankedEntrants.some((id) => !BYTES32.test(id) || /^0x0{64}$/i.test(id)) || new Set(input.rankedEntrants).size !== 5) throw new Error("ranking must contain five unique non-zero entrants");
    if (!/^[1-9][0-9]*$/.test(input.settlementNonce)) throw new Error("settlement nonce is invalid");
    expectedCredits(input.grossPool, input.payoutBps);
    const rankingDigest = `0x${createHash("sha256").update(JSON.stringify(input.rankedEntrants)).digest("hex")}`;
    const inputDigest = createHash("sha256").update(JSON.stringify({ ...input, rankedEntrants: [...input.rankedEntrants], payoutBps: [...input.payoutBps] })).digest("hex");
    return { inputDigest, rankingDigest };
  }
}
