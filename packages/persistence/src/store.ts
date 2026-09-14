import { isDigest } from "../../protocol/src/canonical.ts";
import type { Digest } from "../../protocol/src/canonical.ts";

export type TournamentState = "REGISTRATION" | "ACTIVE" | "COMPLETE" | "CANCELLED";
export type EntrantState = "ACCEPTED" | "WITHDRAWN" | "ELIMINATED";
export type MatchState = "PENDING" | "SUBMITTED" | "DECIDED" | "BLOCKED";
export type AttemptState = "CREATED" | "SUBMITTED" | "FINALIZED" | "RETRYABLE" | "FAILED";

export interface TournamentRecord {
  tournamentId: Digest;
  policy: any;
  state: TournamentState;
  createdAt: number;
}

export interface EntrantRecord {
  entrantId: Digest;
  tournamentId: Digest;
  walletAddress: string;
  agentId: string;
  agentsDigest: Digest;
  state: EntrantState;
  createdAt: number;
}

export interface MatchRecord {
  matchId: Digest;
  tournamentId: Digest;
  stage: string;
  roundNumber: number;
  slotA: string;
  slotB: string;
  state: MatchState;
  createdAt: number;
}

export interface AttemptRecord {
  attemptId: Digest;
  matchId: Digest;
  attemptNumber: number;
  topicDigest: Digest;
  outputADigest: Digest;
  outputBDigest: Digest;
  state: AttemptState;
  createdAt: number;
}

export interface OutboxEvent {
  eventId: Digest;
  kind: string;
  aggregateId: Digest;
  operationKey: string;
  payload: any;
  createdAt: number;
}

export interface Snapshot {
  tournaments: TournamentRecord[];
  entrants: EntrantRecord[];
  matches: MatchRecord[];
  attempts: AttemptRecord[];
  outbox: OutboxEvent[];
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) {
      if (!keysB.includes(k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

function cloneDeep<T>(obj: T): T {
  if (obj === undefined) return undefined as any;
  return JSON.parse(JSON.stringify(obj));
}

function requireDigest(value: unknown, field: string): asserts value is Digest {
  if (!isDigest(value)) throw new TypeError(`${field} digest is invalid`);
}

function requireSnapshotCollections(snapshot: Snapshot): void {
  if (!snapshot || typeof snapshot !== "object") throw new TypeError("snapshot is invalid");
  for (const key of ["tournaments", "entrants", "matches", "attempts", "outbox"] as const) {
    if (!Array.isArray(snapshot[key])) throw new TypeError(`snapshot ${key} must be an array`);
  }
}

function rejectSnapshotDuplicates(snapshot: Snapshot): void {
  const requireUnique = <T>(items: readonly T[], keyOf: (item: T) => string, label: string) => {
    const seen = new Set<string>();
    for (const item of items) {
      const key = keyOf(item);
      if (seen.has(key)) throw new Error(`Duplicate ${label} in snapshot`);
      seen.add(key);
    }
  };

  requireUnique(snapshot.tournaments, record => record.tournamentId, "tournament primary ID");
  requireUnique(snapshot.entrants, record => record.entrantId, "entrant primary ID");
  requireUnique(
    snapshot.entrants,
    record => JSON.stringify([record.tournamentId, record.walletAddress, record.agentId]),
    "entrant composite key",
  );
  requireUnique(snapshot.matches, record => record.matchId, "match primary ID");
  requireUnique(snapshot.attempts, record => record.attemptId, "attempt primary ID");
  requireUnique(
    snapshot.attempts,
    record => JSON.stringify([record.matchId, record.attemptNumber]),
    "attempt composite key",
  );
  requireUnique(snapshot.outbox, record => record.eventId, "outbox event primary ID");
  requireUnique(snapshot.outbox, record => record.operationKey, "outbox operation key");
}

class StoreState {
  tournaments: Map<string, TournamentRecord> = new Map();
  entrants: Map<string, EntrantRecord> = new Map();
  matches: Map<string, MatchRecord> = new Map();
  attempts: Map<string, AttemptRecord> = new Map();
  outbox: Map<string, OutboxEvent> = new Map();

  clone(): StoreState {
    const s = new StoreState();
    s.tournaments = new Map(this.tournaments);
    s.entrants = new Map(this.entrants);
    s.matches = new Map(this.matches);
    s.attempts = new Map(this.attempts);
    s.outbox = new Map(this.outbox);
    return s;
  }
}

export class ArenaStoreTx {
  private state: StoreState;

  constructor(state: StoreState) {
    this.state = state;
  }

  addTournament(record: TournamentRecord) {
    requireDigest(record.tournamentId, "tournament ID");
    const existing = this.state.tournaments.get(record.tournamentId);
    if (existing) {
      if (!deepEqual(existing, record)) throw new Error("Conflict: tournament payload differs");
      return;
    }
    this.state.tournaments.set(record.tournamentId, cloneDeep(record));
  }

  addEntrant(record: EntrantRecord) {
    requireDigest(record.entrantId, "entrant ID");
    requireDigest(record.tournamentId, "entrant tournament ID");
    requireDigest(record.agentsDigest, "agents");
    const existing = this.state.entrants.get(record.entrantId);
    if (existing) {
      if (!deepEqual(existing, record)) throw new Error("Conflict: entrant payload differs");
      return;
    }
    for (const e of this.state.entrants.values()) {
      if (e.tournamentId === record.tournamentId && e.walletAddress === record.walletAddress && e.agentId === record.agentId) {
        throw new Error("Conflict: entrant composite key exists");
      }
    }
    this.state.entrants.set(record.entrantId, cloneDeep(record));
  }

  addMatch(record: MatchRecord) {
    requireDigest(record.matchId, "match ID");
    requireDigest(record.tournamentId, "match tournament ID");
    const existing = this.state.matches.get(record.matchId);
    if (existing) {
      if (!deepEqual(existing, record)) throw new Error("Conflict: match payload differs");
      return;
    }
    this.state.matches.set(record.matchId, cloneDeep(record));
  }

  addAttempt(record: AttemptRecord) {
    requireDigest(record.attemptId, "attempt ID");
    requireDigest(record.matchId, "attempt match ID");
    requireDigest(record.topicDigest, "topic");
    requireDigest(record.outputADigest, "output A");
    requireDigest(record.outputBDigest, "output B");
    const existing = this.state.attempts.get(record.attemptId);
    if (existing) {
      if (!deepEqual(existing, record)) throw new Error("Conflict: attempt payload differs");
      return;
    }
    for (const a of this.state.attempts.values()) {
      if (a.matchId === record.matchId && a.attemptNumber === record.attemptNumber) {
        throw new Error("Conflict: attempt composite key exists");
      }
    }
    this.state.attempts.set(record.attemptId, cloneDeep(record));
  }

  enqueueOutbox(event: OutboxEvent) {
    requireDigest(event.eventId, "outbox event ID");
    requireDigest(event.aggregateId, "outbox aggregate ID");
    const existing = this.state.outbox.get(event.operationKey);
    if (existing) {
      if (!deepEqual(existing, event)) throw new Error("Conflict: outbox payload differs");
      return;
    }
    for (const stored of this.state.outbox.values()) {
      if (stored.eventId === event.eventId) throw new Error("Conflict: outbox event primary ID exists");
    }
    this.state.outbox.set(event.operationKey, cloneDeep(event));
  }
}

export class ArenaStore {
  private state = new StoreState();

  get tournaments(): readonly TournamentRecord[] {
    return Array.from(this.state.tournaments.values()).map(cloneDeep);
  }

  get entrants(): readonly EntrantRecord[] {
    return Array.from(this.state.entrants.values()).map(cloneDeep);
  }

  get matches(): readonly MatchRecord[] {
    return Array.from(this.state.matches.values()).map(cloneDeep);
  }

  get attempts(): readonly AttemptRecord[] {
    return Array.from(this.state.attempts.values()).map(cloneDeep);
  }

  get outbox(): readonly OutboxEvent[] {
    return Array.from(this.state.outbox.values()).map(cloneDeep);
  }

  transact<T>(fn: (tx: ArenaStoreTx) => T): T {
    const staged = this.state.clone();
    const tx = new ArenaStoreTx(staged);
    const result = fn(tx);
    this.state = staged;
    return result;
  }

  snapshot(): Snapshot {
    const sortByPrimary = <T extends Record<string, any>>(items: T[], key: keyof T) => {
      return items.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0));
    };

    return {
      tournaments: sortByPrimary(Array.from(this.state.tournaments.values()), "tournamentId").map(cloneDeep),
      entrants: sortByPrimary(Array.from(this.state.entrants.values()), "entrantId").map(cloneDeep),
      matches: sortByPrimary(Array.from(this.state.matches.values()), "matchId").map(cloneDeep),
      attempts: sortByPrimary(Array.from(this.state.attempts.values()), "attemptId").map(cloneDeep),
      outbox: sortByPrimary(Array.from(this.state.outbox.values()), "eventId").map(cloneDeep),
    };
  }

  static fromSnapshot(snapshot: Snapshot): ArenaStore {
    requireSnapshotCollections(snapshot);
    rejectSnapshotDuplicates(snapshot);
    const store = new ArenaStore();
    store.transact(tx => {
      for (const record of snapshot.tournaments) tx.addTournament(record);
      for (const record of snapshot.entrants) tx.addEntrant(record);
      for (const record of snapshot.matches) tx.addMatch(record);
      for (const record of snapshot.attempts) tx.addAttempt(record);
      for (const event of snapshot.outbox) tx.enqueueOutbox(event);
    });
    return store;
  }
}
