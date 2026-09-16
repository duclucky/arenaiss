import { DatabaseSync } from "node:sqlite";

export type LeaseClaim = "CLAIMED" | "BUSY";

type LeaseRow = {
  fingerprint: string;
  owner: string;
  expires_at: number;
};

function requireIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || !value || value.length > 256 || /[\u0000-\u001f]/.test(value)) {
    throw new TypeError(`${field} is invalid`);
  }
}

function requireTime(value: number, field: string, allowZero: boolean): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new TypeError(`${field} time is invalid`);
}

export class SqliteRuntimeStore {
  private database: DatabaseSync;
  private closed = false;

  constructor(path: string) {
    if (typeof path !== "string" || !path) throw new TypeError("database path is invalid");
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS runtime_records (
        namespace TEXT NOT NULL,
        record_key TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (namespace, record_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS runtime_counters (
        namespace TEXT NOT NULL,
        counter_key TEXT NOT NULL,
        value INTEGER NOT NULL,
        PRIMARY KEY (namespace, counter_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS runtime_leases (
        namespace TEXT NOT NULL,
        lease_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        owner TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, lease_key)
      ) STRICT;
    `);
  }

  get<T = unknown>(namespace: string, key: string): T | undefined {
    this.requireOpen();
    requireIdentifier(namespace, "namespace");
    requireIdentifier(key, "key");
    const row = this.database.prepare(
      "SELECT payload FROM runtime_records WHERE namespace = ? AND record_key = ?",
    ).get(namespace, key) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as T : undefined;
  }

  list<T = unknown>(namespace: string): T[] {
    this.requireOpen();
    requireIdentifier(namespace, "namespace");
    const rows = this.database.prepare(
      "SELECT payload FROM runtime_records WHERE namespace = ? ORDER BY record_key",
    ).all(namespace) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as T);
  }

  listNewest<T = unknown>(namespace: string): T[] {
    this.requireOpen();
    requireIdentifier(namespace, "namespace");
    const rows = this.database.prepare(
      "SELECT payload FROM runtime_records WHERE namespace = ? ORDER BY rowid DESC",
    ).all(namespace) as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as T);
  }

  put(namespace: string, key: string, value: unknown): void {
    this.requireOpen();
    requireIdentifier(namespace, "namespace");
    requireIdentifier(key, "key");
    const payload = JSON.stringify(value);
    if (payload === undefined) throw new TypeError("value is not JSON serializable");
    this.database.prepare(`
      INSERT INTO runtime_records (namespace, record_key, payload) VALUES (?, ?, ?)
      ON CONFLICT (namespace, record_key) DO UPDATE SET payload = excluded.payload
    `).run(namespace, key, payload);
  }

  putIfAbsent(namespace: string, key: string, value: unknown): boolean {
    this.requireOpen();
    requireIdentifier(namespace, "namespace");
    requireIdentifier(key, "key");
    const payload = JSON.stringify(value);
    if (payload === undefined) throw new TypeError("value is not JSON serializable");
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO runtime_records (namespace, record_key, payload) VALUES (?, ?, ?)
    `).run(namespace, key, payload);
    return Number(result.changes) === 1;
  }

  delete(namespace: string, key: string): boolean {
    this.requireOpen();
    requireIdentifier(namespace, "namespace");
    requireIdentifier(key, "key");
    const result = this.database.prepare(
      "DELETE FROM runtime_records WHERE namespace = ? AND record_key = ?",
    ).run(namespace, key);
    return Number(result.changes) === 1;
  }

  counter(namespace: string, key: string): number {
    this.requireOpen();
    requireIdentifier(namespace, "namespace");
    requireIdentifier(key, "key");
    const row = this.database.prepare(
      "SELECT value FROM runtime_counters WHERE namespace = ? AND counter_key = ?",
    ).get(namespace, key) as { value: number } | undefined;
    return row?.value ?? 0;
  }

  increment(namespace: string, key: string, amount: number): number {
    this.requireOpen();
    requireIdentifier(namespace, "namespace");
    requireIdentifier(key, "key");
    if (!Number.isSafeInteger(amount)) throw new TypeError("counter amount is invalid");
    return this.transaction(() => {
      const next = this.counter(namespace, key) + amount;
      if (!Number.isSafeInteger(next)) throw new RangeError("counter exceeds safe integer range");
      this.database.prepare(`
        INSERT INTO runtime_counters (namespace, counter_key, value) VALUES (?, ?, ?)
        ON CONFLICT (namespace, counter_key) DO UPDATE SET value = excluded.value
      `).run(namespace, key, next);
      return next;
    });
  }

  claimLease(namespace: string, key: string, fingerprint: string, owner: string, now: number, leaseMs: number): LeaseClaim {
    this.requireOpen();
    requireIdentifier(namespace, "namespace");
    requireIdentifier(key, "key");
    requireIdentifier(fingerprint, "fingerprint");
    requireIdentifier(owner, "owner");
    requireTime(now, "lease start", true);
    requireTime(leaseMs, "lease duration", false);
    const expiresAt = now + leaseMs;
    if (!Number.isSafeInteger(expiresAt)) throw new RangeError("lease expiry time is invalid");

    return this.transaction(() => {
      const existing = this.database.prepare(`
        SELECT fingerprint, owner, expires_at
        FROM runtime_leases WHERE namespace = ? AND lease_key = ?
      `).get(namespace, key) as LeaseRow | undefined;
      if (existing?.fingerprint !== undefined && existing.fingerprint !== fingerprint) {
        throw new Error("conflicting operation lease");
      }
      if (existing && existing.expires_at > now) return "BUSY";
      this.database.prepare(`
        INSERT INTO runtime_leases (namespace, lease_key, fingerprint, owner, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (namespace, lease_key) DO UPDATE SET
          fingerprint = excluded.fingerprint,
          owner = excluded.owner,
          expires_at = excluded.expires_at
      `).run(namespace, key, fingerprint, owner, expiresAt);
      return "CLAIMED";
    });
  }

  releaseLease(namespace: string, key: string, owner: string): boolean {
    this.requireOpen();
    requireIdentifier(namespace, "namespace");
    requireIdentifier(key, "key");
    requireIdentifier(owner, "owner");
    const result = this.database.prepare(
      "DELETE FROM runtime_leases WHERE namespace = ? AND lease_key = ? AND owner = ?",
    ).run(namespace, key, owner);
    return Number(result.changes) === 1;
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private requireOpen(): void {
    if (this.closed) throw new Error("runtime store is closed");
  }
}
