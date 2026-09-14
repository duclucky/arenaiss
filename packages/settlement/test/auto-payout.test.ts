import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutomaticPayoutWorker, MemoryAutomaticPayoutStore, PersistentAutomaticPayoutStore, type ArcPayoutPort } from "../src/auto-payout.ts";
import { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";

const id = (char: string) => `0x${char.repeat(64)}`;
const addresses = ["1", "2", "3", "4", "5"].map((char) => `0x${char.repeat(40)}`);

class FakeArcPayout implements ArcPayoutPort {
  credits = new Map(addresses.map((address, index) => [address, String([288000, 180000, 108000, 72000, 72000][index])]));
  fee = "80000";
  sent: string[] = [];
  receipts = new Map<string, unknown>();
  failBeneficiary?: string;
  closeCalls = 0;

  async readCredit(_tournamentId: string, beneficiary: string) { return this.credits.get(beneficiary) ?? "0"; }
  async sendCreditPayout(_tournamentId: string, beneficiary: string) {
    this.sent.push(beneficiary);
    if (beneficiary === this.failBeneficiary) throw new Error("simulated payout failure");
    const hash = id(String(this.sent.length % 10));
    this.credits.set(beneficiary, "0");
    this.receipts.set(hash, { status: "success" });
    return hash;
  }
  async readPlatformFeeCredit() { return this.fee; }
  async sendPlatformFeePayout() {
    this.sent.push("fee");
    const hash = id("a");
    this.fee = "0";
    this.receipts.set(hash, { status: "success" });
    return hash;
  }
  async getReceipt(txHash: string) { return this.receipts.get(txHash); }
  async readTotalLiability() {
    return String([...this.credits.values()].reduce((sum, amount) => sum + BigInt(amount), BigInt(this.fee)));
  }
  async closeTournament() {
    this.closeCalls += 1;
    const hash = id("c");
    this.receipts.set(hash, { status: "success" });
    return hash;
  }
}

test("relayer automatically pays five winners, owner fee, and closes at zero liability", async () => {
  const arc = new FakeArcPayout();
  const worker = new AutomaticPayoutWorker(arc, new MemoryAutomaticPayoutStore());
  assert.deepEqual(await worker.run({ tournamentId: id("f"), beneficiaries: addresses }), { state: "COMPLETE", failures: [] });
  assert.deepEqual(arc.sent, [...addresses, "fee"]);
  assert.equal(await arc.readTotalLiability(id("f")), "0");
  assert.equal(arc.closeCalls, 1);
});

test("one failed recipient does not prevent other winners or owner fee payout", async () => {
  const arc = new FakeArcPayout();
  arc.failBeneficiary = addresses[1];
  const worker = new AutomaticPayoutWorker(arc, new MemoryAutomaticPayoutStore(), { maxAttempts: 1 });
  const outcome = await worker.run({ tournamentId: id("f"), beneficiaries: addresses });
  assert.equal(outcome.state, "PARTIAL_FAILURE");
  assert.deepEqual(outcome.failures, [`credit:${addresses[1]}`]);
  assert.equal(arc.credits.get(addresses[0]), "0");
  assert.equal(arc.credits.get(addresses[1]), "180000");
  assert.equal(arc.credits.get(addresses[4]), "0");
  assert.equal(arc.fee, "0");
  assert.equal(arc.closeCalls, 0);
});

test("rerun reads zero credits and never submits duplicate payout transactions", async () => {
  const arc = new FakeArcPayout();
  const worker = new AutomaticPayoutWorker(arc, new MemoryAutomaticPayoutStore());
  await worker.run({ tournamentId: id("f"), beneficiaries: addresses });
  const sends = [...arc.sent];
  assert.deepEqual(await worker.run({ tournamentId: id("f"), beneficiaries: addresses }), { state: "COMPLETE", failures: [] });
  assert.deepEqual(arc.sent, sends);
  assert.equal(arc.closeCalls, 1);
});

test("pending receipt pauses only completion and resumes without another send", async () => {
  const arc = new FakeArcPayout();
  const original = arc.sendCreditPayout.bind(arc);
  let firstHash = "";
  arc.sendCreditPayout = async (tournamentId, beneficiary) => {
    const hash = await original(tournamentId, beneficiary);
    if (!firstHash) {
      firstHash = hash;
      arc.receipts.delete(hash);
    }
    return hash;
  };
  const worker = new AutomaticPayoutWorker(arc, new MemoryAutomaticPayoutStore());
  assert.equal((await worker.run({ tournamentId: id("f"), beneficiaries: addresses })).state, "PAYOUT_PENDING");
  const sentCount = arc.sent.length;
  arc.receipts.set(firstHash, { status: "success" });
  assert.equal((await worker.run({ tournamentId: id("f"), beneficiaries: addresses })).state, "COMPLETE");
  assert.equal(arc.sent.length, sentCount);
});

test("invalid tournament or beneficiary set rejects before Arc I/O", async () => {
  const arc = new FakeArcPayout();
  const worker = new AutomaticPayoutWorker(arc, new MemoryAutomaticPayoutStore());
  await assert.rejects(() => worker.run({ tournamentId: "bad", beneficiaries: addresses }), /tournament/i);
  await assert.rejects(() => worker.run({ tournamentId: id("f"), beneficiaries: [addresses[0], addresses[0], ...addresses.slice(2)] }), /unique/i);
  await assert.rejects(() => worker.run({ tournamentId: id("f"), beneficiaries: addresses.slice(0, 4) }), /five/i);
  assert.deepEqual(arc.sent, []);
});

test("submitted payout survives SQLite restart without a duplicate send", async () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-auto-payout-"));
  const databasePath = join(directory, "runtime.sqlite");
  const arc = new FakeArcPayout();
  const original = arc.sendCreditPayout.bind(arc);
  let firstHash = "";
  arc.sendCreditPayout = async (tournamentId, beneficiary) => {
    const hash = await original(tournamentId, beneficiary);
    if (!firstHash) {
      firstHash = hash;
      arc.receipts.delete(hash);
    }
    return hash;
  };
  try {
    const firstDatabase = new SqliteRuntimeStore(databasePath);
    const firstWorker = new AutomaticPayoutWorker(arc, new PersistentAutomaticPayoutStore(firstDatabase));
    assert.equal((await firstWorker.run({ tournamentId: id("f"), beneficiaries: addresses })).state, "PAYOUT_PENDING");
    const sentCount = arc.sent.length;
    firstDatabase.close();

    arc.receipts.set(firstHash, { status: "success" });
    const secondDatabase = new SqliteRuntimeStore(databasePath);
    const secondWorker = new AutomaticPayoutWorker(arc, new PersistentAutomaticPayoutStore(secondDatabase));
    assert.equal((await secondWorker.run({ tournamentId: id("f"), beneficiaries: addresses })).state, "COMPLETE");
    assert.equal(arc.sent.length, sentCount);
    secondDatabase.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
