import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferencePairRunner, MemoryInferenceStore, PersistentInferenceStore, type ModelProvider } from "../src/pair-runner.ts";
import { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const base = {
  tournamentId: digest("t"), matchId: digest("m"), attemptId: digest("a"), topic: "Explain account abstraction",
  agentA: { agentId: digest("agent-a"), agentsVersion: digest("v1-a"), agentsMd: "You are concise.", agentsCommitment: digest("You are concise.") },
  agentB: { agentId: digest("agent-b"), agentsVersion: digest("v1-b"), agentsMd: "You use examples.", agentsCommitment: digest("You use examples.") },
  policy: { version: "model-policy-v1", model: "fixture-model", wrapper: "Answer the tournament topic.", maxOutputBytes: 8192, temperature: 0.2, maxCostMicros: 1000, maxCostPerCallMicros: 100 },
};

class FixtureProvider implements ModelProvider {
  calls: Array<{ request: unknown; operationKey: string }> = [];
  private failSide?: "A" | "B";
  constructor(failSide?: "A" | "B") { this.failSide = failSide; }
  async generate(request: any, operationKey: string) {
    this.calls.push({ request, operationKey });
    if (operationKey.endsWith(`:${this.failSide}`)) throw new Error("PROVIDER_TRANSIENT");
    return { requestId: `provider-${this.calls.length}`, output: `output:${request.agentsMd}`, usageTokens: 10, costMicros: 25 };
  }
}

test("pair uses identical policy/topic and differs only by bound AGENTS.md identity", async () => {
  const provider = new FixtureProvider();
  const result = await new InferencePairRunner(provider, new MemoryInferenceStore()).runPair(base);
  assert.equal(result.state, "OUTPUTS_READY");
  assert.equal(provider.calls.length, 2);
  const [a, b] = provider.calls.map((call: any) => call.request);
  assert.deepEqual({ ...a, agentsMd: "" }, { ...b, agentsMd: "" });
  assert.notEqual(a.agentsMd, b.agentsMd);
  assert.match(result.outputADigest!, /^sha256:[0-9a-f]{64}$/);
});

test("duplicate worker reuses known responses and does not issue paid calls twice", async () => {
  const provider = new FixtureProvider(); const store = new MemoryInferenceStore(); const runner = new InferencePairRunner(provider, store);
  assert.deepEqual(await runner.runPair(base), await runner.runPair(base));
  assert.equal(provider.calls.length, 2);
  assert.equal(store.totalCostMicros(base.tournamentId), 50);
});

test("concurrent duplicate workers share one paid pair operation", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  class SlowProvider extends FixtureProvider {
    override async generate(request: any, operationKey: string) {
      await gate;
      return super.generate(request, operationKey);
    }
  }
  const provider = new SlowProvider();
  const store = new MemoryInferenceStore();
  const first = new InferencePairRunner(provider, store).runPair(base);
  const second = new InferencePairRunner(provider, store).runPair(base);
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.deepEqual(left, right);
  assert.equal(provider.calls.length, 2);
  assert.equal(store.totalCostMicros(base.tournamentId), 50);
});

test("completed attempt rejects a conflicting pair payload", async () => {
  const provider = new FixtureProvider();
  const store = new MemoryInferenceStore();
  const runner = new InferencePairRunner(provider, store);
  assert.equal((await runner.runPair(base)).state, "OUTPUTS_READY");
  await assert.rejects(() => runner.runPair({ ...base, topic: "A different topic" }), /conflicting inference pair/i);
  assert.equal(provider.calls.length, 2);
});

test("one-sided success is PARTIAL_PAIR and never OUTPUTS_READY", async () => {
  const result = await new InferencePairRunner(new FixtureProvider("B"), new MemoryInferenceStore()).runPair(base);
  assert.equal(result.state, "PARTIAL_PAIR");
  assert.equal(result.outputB, undefined);
});

test("commitment mismatch and exhausted budget reject before provider I/O", async () => {
  const provider = new FixtureProvider();
  await assert.rejects(() => new InferencePairRunner(provider, new MemoryInferenceStore()).runPair({ ...base, agentA: { ...base.agentA, agentsCommitment: digest("wrong") } }), /commitment/i);
  await assert.rejects(() => new InferencePairRunner(provider, new MemoryInferenceStore()).runPair({ ...base, policy: { ...base.policy, maxCostMicros: 10 } }), /budget/i);
  assert.equal(provider.calls.length, 0);
});

test("whole-pair retry requires a new attempt identity", async () => {
  const store = new MemoryInferenceStore(); const failed = new InferencePairRunner(new FixtureProvider("B"), store);
  assert.equal((await failed.runPair(base)).state, "PARTIAL_PAIR");
  await assert.rejects(() => new InferencePairRunner(new FixtureProvider(), store).runPair(base), /partial.*new attempt/i);
  assert.equal((await new InferencePairRunner(new FixtureProvider(), store).runPair({ ...base, attemptId: digest("a2") })).state, "OUTPUTS_READY");
});

test("completed paid outputs and cost survive an inference worker restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-inference-"));
  const path = join(directory, "runtime.sqlite");
  try {
    const firstDatabase = new SqliteRuntimeStore(path);
    const firstProvider = new FixtureProvider();
    const first = await new InferencePairRunner(firstProvider, new PersistentInferenceStore(firstDatabase)).runPair(base);
    assert.equal(first.state, "OUTPUTS_READY");
    assert.equal(firstProvider.calls.length, 2);
    firstDatabase.close();

    const restartedDatabase = new SqliteRuntimeStore(path);
    const restartedProvider = new FixtureProvider();
    const restartedStore = new PersistentInferenceStore(restartedDatabase);
    assert.deepEqual(await new InferencePairRunner(restartedProvider, restartedStore).runPair(base), first);
    assert.equal(restartedProvider.calls.length, 0);
    assert.equal(restartedStore.totalCostMicros(base.tournamentId), 50);
    restartedDatabase.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a durable inference lease blocks another process from duplicating paid calls", async () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-inference-lease-"));
  const path = join(directory, "runtime.sqlite");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  class SlowProvider extends FixtureProvider {
    override async generate(request: any, operationKey: string) {
      await gate;
      return super.generate(request, operationKey);
    }
  }
  const firstDatabase = new SqliteRuntimeStore(path);
  const secondDatabase = new SqliteRuntimeStore(path);
  try {
    const provider = new SlowProvider();
    const first = new InferencePairRunner(provider, new PersistentInferenceStore(firstDatabase)).runPair(base);
    await assert.rejects(
      () => new InferencePairRunner(provider, new PersistentInferenceStore(secondDatabase)).runPair(base),
      /leased/i,
    );
    release();
    assert.equal((await first).state, "OUTPUTS_READY");
    assert.equal(provider.calls.length, 2);
  } finally {
    release();
    firstDatabase.close();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
