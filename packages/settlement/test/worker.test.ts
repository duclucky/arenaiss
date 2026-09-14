import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettlementWorker, MemorySettlementStore, PersistentSettlementStore, expectedCredits, type ArcSettlementPort } from "../src/worker.ts";
import { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";

const id = (char: string) => `0x${char.repeat(64)}`;
const arcTxHash = id("b");
const ranking = [id("1"), id("2"), id("3"), id("4"), id("5")];
const input = { tournamentId: id("a"), rankedEntrants: ranking, settlementNonce: "1", grossPool: "800000", payoutBps: [4000, 2500, 1500, 1000, 1000] };

class FakeArc implements ArcSettlementPort {
  sends = 0;
  receipt: any = { status: 1 };
  view: any = expectedCredits(input.grossPool, input.payoutBps);
  async sendSettlement() { this.sends += 1; return arcTxHash; }
  async getReceipt() { return this.receipt; }
  async readSettlement() { return this.view; }
}

test("expected accounting derives exact 10 percent fee and deterministic credits", () => {
  assert.deepEqual(expectedCredits("800000", [4000, 2500, 1500, 1000, 1000]), { fee: "80000", credits: ["288000", "180000", "108000", "72000", "72000"], totalLiability: "800000" });
});

test("operation is persisted before send and duplicate worker reuses tx", async () => {
  const arc = new FakeArc(); const store = new MemorySettlementStore(); const worker = new SettlementWorker(arc, store);
  assert.equal(await worker.submit(input), arcTxHash); assert.equal(await worker.submit(input), arcTxHash); assert.equal(arc.sends, 1);
  assert.equal(store.get(input.tournamentId)?.state, "SUBMITTED");
});

test("concurrent duplicate workers share one Arc settlement send", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  class SlowArc extends FakeArc {
    override async sendSettlement() {
      await gate;
      return super.sendSettlement();
    }
  }
  const arc = new SlowArc();
  const store = new MemorySettlementStore();
  const first = new SettlementWorker(arc, store).submit(input);
  const second = new SettlementWorker(arc, store).submit(input);
  release();
  assert.deepEqual(await Promise.all([first, second]), [arcTxHash, arcTxHash]);
  assert.equal(arc.sends, 1);
});

test("concurrent conflicting settlement is rejected before a second Arc send", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  class SlowArc extends FakeArc {
    override async sendSettlement() {
      await gate;
      return super.sendSettlement();
    }
  }
  const arc = new SlowArc();
  const store = new MemorySettlementStore();
  const first = new SettlementWorker(arc, store).submit(input);
  const conflicting = new SettlementWorker(arc, store).submit({ ...input, settlementNonce: "2" });
  await assert.rejects(() => conflicting, /conflicting settlement operation/i);
  release();
  assert.equal(await first, arcTxHash);
  assert.equal(arc.sends, 1);
});

test("receipt success plus exact Arc view completes once", async () => {
  const arc = new FakeArc(); const worker = new SettlementWorker(arc, new MemorySettlementStore()); await worker.submit(input);
  assert.equal((await worker.reconcile(input)).state, "COMPLETE");
});

test("failed receipt or accounting mismatch enters controlled recovery", async () => {
  const arc = new FakeArc(); const worker = new SettlementWorker(arc, new MemorySettlementStore()); await worker.submit(input);
  arc.receipt = { status: 0 }; assert.equal((await worker.reconcile(input)).state, "SETTLEMENT_REJECTED");
  arc.receipt = { status: 1 }; arc.view = { ...expectedCredits(input.grossPool, input.payoutBps), fee: "1" };
  assert.equal((await worker.reconcile(input)).state, "RECOVERY_REQUIRED");
});

test("viem receipt success completes and a missing receipt remains pending", async () => {
  const successArc = new FakeArc();
  successArc.receipt = { status: "success" };
  const successWorker = new SettlementWorker(successArc, new MemorySettlementStore());
  await successWorker.submit(input);
  assert.deepEqual(await successWorker.reconcile(input), { state: "COMPLETE" });

  const pendingArc = new FakeArc();
  pendingArc.receipt = undefined;
  const pendingWorker = new SettlementWorker(pendingArc, new MemorySettlementStore());
  await pendingWorker.submit(input);
  assert.deepEqual(await pendingWorker.reconcile(input), { state: "PENDING" });
});

test("malformed Arc transaction hash is rejected", async () => {
  const arc = new FakeArc();
  arc.sendSettlement = async () => "0xarc";
  const worker = new SettlementWorker(arc, new MemorySettlementStore());
  await assert.rejects(() => worker.submit(input), /transaction hash/i);
});

test("invalid ranking and caller-supplied payout fields reject before Arc I/O", async () => {
  const arc = new FakeArc(); const worker = new SettlementWorker(arc, new MemorySettlementStore());
  await assert.rejects(() => worker.submit({ ...input, rankedEntrants: [ranking[0], ranking[0], ...ranking.slice(2)] }), /unique/);
  await assert.rejects(() => worker.submit({ ...input, payoutAmounts: [1, 2, 3, 4, 5] } as any), /payout amount/i);
  assert.equal(arc.sends, 0);
});

test("Arc settlement transaction and completion survive worker restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-settlement-"));
  const path = join(directory, "runtime.sqlite");
  const arc = new FakeArc();
  try {
    const firstDatabase = new SqliteRuntimeStore(path);
    await new SettlementWorker(arc, new PersistentSettlementStore(firstDatabase)).submit(input);
    firstDatabase.close();

    const restartedDatabase = new SqliteRuntimeStore(path);
    const restarted = new SettlementWorker(arc, new PersistentSettlementStore(restartedDatabase));
    assert.equal(await restarted.submit(input), arcTxHash);
    assert.deepEqual(await restarted.reconcile(input), { state: "COMPLETE" });
    assert.deepEqual(await restarted.reconcile(input), { state: "COMPLETE" });
    assert.equal(arc.sends, 1);
    restartedDatabase.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a durable reconcile lease prevents stale Arc receipt races", async () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-settlement-reconcile-"));
  const path = join(directory, "runtime.sqlite");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const arc = new FakeArc();
  arc.receipt = undefined;
  const originalGetReceipt = arc.getReceipt.bind(arc);
  let block = true;
  arc.getReceipt = async () => {
    if (block) await gate;
    return originalGetReceipt();
  };
  const firstDatabase = new SqliteRuntimeStore(path);
  const secondDatabase = new SqliteRuntimeStore(path);
  try {
    const first = new SettlementWorker(arc, new PersistentSettlementStore(firstDatabase));
    const second = new SettlementWorker(arc, new PersistentSettlementStore(secondDatabase));
    await first.submit(input);
    const pending = first.reconcile(input);
    const safetyRelease = setTimeout(release, 50);
    await assert.rejects(() => second.reconcile(input), /leased/i);
    clearTimeout(safetyRelease);
    release();
    assert.deepEqual(await pending, { state: "PENDING" });
    block = false;
    arc.receipt = { status: "success" };
    assert.deepEqual(await second.reconcile(input), { state: "COMPLETE" });
  } finally {
    release();
    firstDatabase.close();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
