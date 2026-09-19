export type TransactionNetwork = "ARC" | "GENLAYER";

export interface TransactionSubmissionLane {
  network: TransactionNetwork;
  chainId: number;
  signerAddress: string;
}

export interface TransactionSubmissionSnapshot {
  activeLanes: number;
  queuedSubmissions: number;
}

export interface TransactionSubmissionCoordinator {
  submit<T>(lane: TransactionSubmissionLane, send: () => Promise<T>): Promise<T>;
  snapshot(): TransactionSubmissionSnapshot;
}

type LaneState = { tail: Promise<void>; queued: number };

export class InMemoryTransactionSubmissionCoordinator implements TransactionSubmissionCoordinator {
  private readonly lanes = new Map<string, LaneState>();

  async submit<T>(lane: TransactionSubmissionLane, send: () => Promise<T>): Promise<T> {
    const key = transactionLaneKey(lane);
    let state = this.lanes.get(key);
    if (!state) {
      state = { tail: Promise.resolve(), queued: 0 };
      this.lanes.set(key, state);
    }
    state.queued += 1;
    const previous = state.tail;
    let release!: () => void;
    state.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await send();
    } finally {
      state.queued -= 1;
      release();
      if (state.queued === 0 && this.lanes.get(key) === state) this.lanes.delete(key);
    }
  }

  snapshot(): TransactionSubmissionSnapshot {
    let queuedSubmissions = 0;
    for (const state of this.lanes.values()) queuedSubmissions += state.queued;
    return { activeLanes: this.lanes.size, queuedSubmissions };
  }
}

export const sharedTransactionSubmissionCoordinator = new InMemoryTransactionSubmissionCoordinator();

export interface ExecutionSchedulerSnapshot {
  limit: number;
  active: number;
  queued: number;
}

export interface ExecutionScheduler {
  run<T>(operation: () => Promise<T>): Promise<T>;
  snapshot(): ExecutionSchedulerSnapshot;
}

export class BoundedExecutionScheduler implements ExecutionScheduler {
  private readonly waiters: Array<() => void> = [];
  private readonly limit: number;
  private active = 0;

  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30) throw new TypeError("execution scheduler limit must be between 1 and 30");
    this.limit = limit;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  snapshot(): ExecutionSchedulerSnapshot {
    return { limit: this.limit, active: this.active, queued: this.waiters.length };
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }
}

function transactionLaneKey(lane: TransactionSubmissionLane): string {
  if (!Number.isSafeInteger(lane.chainId) || lane.chainId <= 0) throw new TypeError("transaction lane chainId is invalid");
  const signer = lane.signerAddress.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(signer)) throw new TypeError("transaction lane signerAddress is invalid");
  return `${lane.network}:${lane.chainId}:${signer}`;
}
