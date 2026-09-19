import assert from "node:assert/strict";
import test from "node:test";

import { BoundedExecutionScheduler, InMemoryTransactionSubmissionCoordinator } from "../src/concurrency.ts";

const signer = `0x${"11".repeat(20)}`;

test("transaction coordinator serializes sends for one normalized nonce lane but releases after hash", async () => {
  const coordinator = new InMemoryTransactionSubmissionCoordinator();
  const lane = { network: "GENLAYER" as const, chainId: 61999, signerAddress: signer.toUpperCase().replace("0X", "0x") };
  const events: string[] = [];
  let releaseFirst!: () => void;
  const first = coordinator.submit(lane, async () => {
    events.push("first:start");
    await new Promise<void>((resolve) => { releaseFirst = resolve; });
    events.push("first:hash");
    return "hash-1";
  });
  const second = coordinator.submit({ ...lane, signerAddress: signer }, async () => {
    events.push("second:start");
    return "hash-2";
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first:start"]);
  assert.deepEqual(coordinator.snapshot(), { activeLanes: 1, queuedSubmissions: 2 });
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["hash-1", "hash-2"]);
  assert.deepEqual(events, ["first:start", "first:hash", "second:start"]);
  assert.deepEqual(coordinator.snapshot(), { activeLanes: 0, queuedSubmissions: 0 });
});

test("transaction coordinator permits different signer/network lanes concurrently", async () => {
  const coordinator = new InMemoryTransactionSubmissionCoordinator();
  let active = 0;
  let peak = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const send = (network: "ARC" | "GENLAYER", signerAddress: string) => coordinator.submit({ network, chainId: 1, signerAddress }, async () => {
    active += 1; peak = Math.max(peak, active); await gate; active -= 1; return "hash";
  });
  const pending = [send("ARC", signer), send("GENLAYER", signer), send("ARC", `0x${"22".repeat(20)}`)];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(peak, 3);
  release();
  await Promise.all(pending);
});

test("bounded scheduler enforces one shared cap and keeps running after rejection", async () => {
  const scheduler = new BoundedExecutionScheduler(3);
  let active = 0;
  let peak = 0;
  const jobs = Array.from({ length: 12 }, (_, index) => scheduler.run(async () => {
    active += 1; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    if (index === 4) throw new Error("expected");
    return index;
  }));
  const results = await Promise.allSettled(jobs);
  assert.equal(peak, 3);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.deepEqual(scheduler.snapshot(), { limit: 3, active: 0, queued: 0 });
});

test("bounded scheduler rejects unsafe limits", () => {
  assert.throws(() => new BoundedExecutionScheduler(0), /between 1 and 30/);
  assert.throws(() => new BoundedExecutionScheduler(31), /between 1 and 30/);
});
