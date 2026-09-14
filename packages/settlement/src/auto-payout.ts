import { randomUUID } from "node:crypto";
import type { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";

export interface AutomaticPayoutInput {
  tournamentId: string;
  beneficiaries: readonly string[];
}

export interface ArcPayoutPort {
  readCredit(tournamentId: string, beneficiary: string): Promise<string>;
  sendCreditPayout(tournamentId: string, beneficiary: string): Promise<string>;
  readPlatformFeeCredit(tournamentId: string): Promise<string>;
  sendPlatformFeePayout(tournamentId: string): Promise<string>;
  getReceipt(txHash: string): Promise<unknown>;
  readTotalLiability(tournamentId: string): Promise<string>;
  closeTournament(tournamentId: string): Promise<string>;
}

type OperationState = "SUBMITTED" | "COMPLETE" | "FAILED";
type PayoutRecord = { key: string; state: OperationState; attempts: number; txHash?: string };
export type AutomaticPayoutOutcome = {
  state: "PAYOUT_PENDING" | "PARTIAL_FAILURE" | "RECOVERY_REQUIRED" | "COMPLETE";
  failures: string[];
};

export interface AutomaticPayoutStore {
  get(key: string): PayoutRecord | undefined;
  put(record: PayoutRecord): void;
  runOnce<T>(key: string, operation: () => Promise<T>): Promise<T>;
}

export class MemoryAutomaticPayoutStore implements AutomaticPayoutStore {
  private records = new Map<string, PayoutRecord>();
  private active = new Map<string, Promise<unknown>>();

  get(key: string): PayoutRecord | undefined {
    const record = this.records.get(key);
    return record ? structuredClone(record) : undefined;
  }

  put(record: PayoutRecord): void {
    this.records.set(record.key, structuredClone(record));
  }

  runOnce<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const current = this.active.get(key) as Promise<T> | undefined;
    if (current) return current;
    const promise = Promise.resolve().then(operation);
    this.active.set(key, promise);
    void promise.finally(() => {
      if (this.active.get(key) === promise) this.active.delete(key);
    }).catch(() => undefined);
    return promise;
  }
}

export class PersistentAutomaticPayoutStore implements AutomaticPayoutStore {
  private readonly active = new Map<string, Promise<unknown>>();
  private readonly workerId: string;
  private readonly now: () => number;
  private readonly leaseMs: number;

  constructor(
    privateRuntime: SqliteRuntimeStore,
    options: { workerId?: string; now?: () => number; leaseMs?: number } = {},
  ) {
    this.runtime = privateRuntime;
    this.workerId = options.workerId ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? 5 * 60_000;
    if (!this.workerId || !Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1) {
      throw new TypeError("automatic payout lease configuration is invalid");
    }
  }

  private readonly runtime: SqliteRuntimeStore;

  get(key: string): PayoutRecord | undefined {
    return this.runtime.get<PayoutRecord>("automatic-payouts", key);
  }

  put(record: PayoutRecord): void {
    this.runtime.put("automatic-payouts", record.key, record);
  }

  runOnce<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const current = this.active.get(key) as Promise<T> | undefined;
    if (current) return current;
    const claim = this.runtime.claimLease("automatic-payout", key, key, this.workerId, this.now(), this.leaseMs);
    if (claim === "BUSY") return Promise.reject(new Error("automatic payout operation is leased by another worker"));
    const promise = Promise.resolve().then(operation);
    this.active.set(key, promise);
    void promise.finally(() => {
      if (this.active.get(key) === promise) this.active.delete(key);
      this.runtime.releaseLease("automatic-payout", key, this.workerId);
    }).catch(() => undefined);
    return promise;
  }
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(0|[1-9][0-9]*)$/;

function receiptState(receipt: unknown): "PENDING" | "SUCCESS" | "FAILED" {
  const status = (receipt as { status?: unknown } | null | undefined)?.status;
  if (status === undefined || status === null) return "PENDING";
  if (status === 1 || status === "success") return "SUCCESS";
  if (status === 0 || status === "reverted") return "FAILED";
  throw new Error("malformed Arc payout receipt");
}

function requireAmount(value: string, field: string): bigint {
  if (!UINT.test(value)) throw new Error(`${field} is invalid`);
  return BigInt(value);
}

export class AutomaticPayoutWorker {
  private readonly maxAttempts: number;
  private readonly arc: ArcPayoutPort;
  private readonly store: AutomaticPayoutStore;

  constructor(
    arc: ArcPayoutPort,
    store: AutomaticPayoutStore,
    options: { maxAttempts?: number } = {},
  ) {
    this.arc = arc;
    this.store = store;
    this.maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1) {
      throw new TypeError("automatic payout max attempts is invalid");
    }
  }

  async run(input: AutomaticPayoutInput): Promise<AutomaticPayoutOutcome> {
    this.validate(input);
    const failures: string[] = [];
    let pending = false;

    for (const beneficiary of input.beneficiaries) {
      const label = `credit:${beneficiary}`;
      const state = await this.processValueOperation(
        `${input.tournamentId}:${label}`,
        () => this.arc.readCredit(input.tournamentId, beneficiary),
        () => this.arc.sendCreditPayout(input.tournamentId, beneficiary),
      );
      if (state === "FAILED") failures.push(label);
      if (state === "PENDING") pending = true;
    }

    const feeLabel = "platform-fee";
    const feeState = await this.processValueOperation(
      `${input.tournamentId}:${feeLabel}`,
      () => this.arc.readPlatformFeeCredit(input.tournamentId),
      () => this.arc.sendPlatformFeePayout(input.tournamentId),
    );
    if (feeState === "FAILED") failures.push(feeLabel);
    if (feeState === "PENDING") pending = true;

    if (pending) return { state: "PAYOUT_PENDING", failures };
    if (failures.length > 0) return { state: "PARTIAL_FAILURE", failures };

    const liability = requireAmount(await this.arc.readTotalLiability(input.tournamentId), "total liability");
    if (liability !== 0n) return { state: "RECOVERY_REQUIRED", failures: ["total-liability"] };

    const closeState = await this.processClose(input.tournamentId);
    if (closeState === "PENDING") return { state: "PAYOUT_PENDING", failures: [] };
    if (closeState === "FAILED") return { state: "PARTIAL_FAILURE", failures: ["close"] };
    return { state: "COMPLETE", failures: [] };
  }

  private async processValueOperation(
    key: string,
    readAmount: () => Promise<string>,
    send: () => Promise<string>,
  ): Promise<"PENDING" | "FAILED" | "COMPLETE"> {
    if (requireAmount(await readAmount(), "payout credit") === 0n) {
      const existing = this.store.get(key);
      this.store.put({ key, state: "COMPLETE", attempts: existing?.attempts ?? 0, txHash: existing?.txHash });
      return "COMPLETE";
    }
    return this.processTransaction(key, send, async () => requireAmount(await readAmount(), "payout credit") === 0n);
  }

  private async processClose(tournamentId: string): Promise<"PENDING" | "FAILED" | "COMPLETE"> {
    const key = `${tournamentId}:close`;
    if (this.store.get(key)?.state === "COMPLETE") return "COMPLETE";
    return this.processTransaction(key, () => this.arc.closeTournament(tournamentId), async () => true);
  }

  private async processTransaction(
    key: string,
    send: () => Promise<string>,
    canonicalEffectApplied: () => Promise<boolean>,
  ): Promise<"PENDING" | "FAILED" | "COMPLETE"> {
    return this.store.runOnce(key, async () => {
      let record = this.store.get(key);
      if (record?.state === "COMPLETE") return "COMPLETE";
      if (record?.state === "SUBMITTED" && record.txHash) {
        const observed = receiptState(await this.arc.getReceipt(record.txHash));
        if (observed === "PENDING") return "PENDING";
        if (observed === "SUCCESS") {
          if (!(await canonicalEffectApplied())) return "FAILED";
          this.store.put({ ...record, state: "COMPLETE" });
          return "COMPLETE";
        }
        record = { ...record, state: "FAILED" };
        this.store.put(record);
      }
      const attempts = record?.attempts ?? 0;
      if (attempts >= this.maxAttempts) return "FAILED";
      try {
        const txHash = await send();
        if (!BYTES32.test(txHash)) throw new Error("invalid Arc payout transaction hash");
        record = { key, state: "SUBMITTED", attempts: attempts + 1, txHash };
        this.store.put(record);
        const observed = receiptState(await this.arc.getReceipt(txHash));
        if (observed === "PENDING") return "PENDING";
        if (observed === "FAILED" || !(await canonicalEffectApplied())) {
          this.store.put({ ...record, state: "FAILED" });
          return "FAILED";
        }
        this.store.put({ ...record, state: "COMPLETE" });
        return "COMPLETE";
      } catch {
        this.store.put({ key, state: "FAILED", attempts: attempts + 1 });
        return "FAILED";
      }
    });
  }

  private validate(input: AutomaticPayoutInput): void {
    if (!BYTES32.test(input.tournamentId) || /^0x0{64}$/i.test(input.tournamentId)) {
      throw new TypeError("tournament ID is invalid");
    }
    if (input.beneficiaries.length !== 5) throw new TypeError("automatic payout requires exactly five beneficiaries");
    if (input.beneficiaries.some((address) => !ADDRESS.test(address) || /^0x0{40}$/i.test(address))) {
      throw new TypeError("automatic payout beneficiary is invalid");
    }
    if (new Set(input.beneficiaries.map((address) => address.toLowerCase())).size !== 5) {
      throw new TypeError("automatic payout beneficiaries must be unique");
    }
  }
}
