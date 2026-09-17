import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenLayerTracker, MemoryJudgeStore, PersistentJudgeStore, normalizeReceipt, type GenLayerPort } from "../src/tracker.ts";
import { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";

const id = (char: string) => `sha256:${char.repeat(64)}`;
const pair = { matchId: id("a"), attemptId: id("b"), topic: "Topic", outputA: "A", outputB: "B", outputADigest: id("c"), outputBDigest: id("d"), rubricVersion: "GeneralResponseV7" };
const criteria = ["relevance", "task_completion", "reasoning_quality", "clarity", "safety"];
const contractResult = () => ({
  status: "FINAL", match_id: pair.matchId, attempt_id: pair.attemptId,
  rubric_version: "GeneralResponseV7", topic_digest: "sha256:7e61847d61d65d9e3ac15c6281f7bfe0d80b8d79d3b53125e9fc2bfc25bb81e8",
  output_digest_a: pair.outputADigest, output_digest_b: pair.outputBDigest,
  result: "A_WIN", score_a: 100, score_b: 0, safety_class: "NEITHER_UNSAFE",
  criteria: criteria.map((criterion_id) => ({ criterion_id, winner: criterion_id === "safety" ? "TIE" : "A", reason: `${criterion_id} reason` })),
  summary: "A wins the task comparison.",
});

class FixturePort implements GenLayerPort {
  submissions = 0;
  receipt: unknown = { status: "FINALIZED", executionStatus: "SUCCESS" };
  result: any = contractResult();
  async submit() { this.submissions += 1; return `0x${"ab".repeat(32)}`; }
  async getReceipt() { return this.receipt; }
  async getResult() { return this.result; }
}

test("raw and normalized receipt shapes map to one lifecycle", () => {
  assert.deepEqual(normalizeReceipt({ status: "finalized", execution_status: "success" }), { finality: "FINALIZED", execution: "SUCCESS" });
  assert.deepEqual(normalizeReceipt({ data: { transaction: { status: "ACCEPTED", result: { status: "PENDING" } } } }), { finality: "ACCEPTED", execution: "PENDING" });
  assert.deepEqual(normalizeReceipt({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" }), { finality: "FINALIZED", execution: "SUCCESS" });
  assert.deepEqual(normalizeReceipt({ statusName: "FINALIZED", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }), { finality: "FINALIZED", execution: "SUCCESS" });
  assert.deepEqual(normalizeReceipt({ statusName: "FINALIZED", resultName: "MAJORITY_DISAGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }), { finality: "FINALIZED", execution: "FAILED" });
  assert.deepEqual(normalizeReceipt({ status: "FINALIZED", result_name: "MAJORITY_DISAGREE", execution_status: "SUCCESS" }), { finality: "FINALIZED", execution: "FAILED" });
  assert.deepEqual(normalizeReceipt({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_ERROR" }), { finality: "FINALIZED", execution: "FAILED" });
  assert.deepEqual(normalizeReceipt({ statusName: "PROPOSING", txExecutionResultName: "NOT_VOTED" }), { finality: "PENDING", execution: "PENDING" });
  assert.deepEqual(normalizeReceipt({ statusName: "PENDING" }), { finality: "PENDING", execution: "PENDING" });
  assert.deepEqual(normalizeReceipt({ statusName: "UNINITIALIZED" }), { finality: "PENDING", execution: "PENDING" });
  assert.deepEqual(normalizeReceipt({
    status: 7,
    statusName: "FINALIZED",
    result: 6,
    consensus_data: {
      leader_receipt: [{ mode: "leader", execution_result: "SUCCESS", result: { status: "return" } }],
    },
  }), { finality: "FINALIZED", execution: "SUCCESS" });
  assert.deepEqual(normalizeReceipt({
    statusName: "FINALIZED",
    consensus_data: { leader_receipt: { 0: { mode: "leader", execution_result: "SUCCESS" }, 1: { mode: "validator", execution_result: "SUCCESS" } } },
  }), { finality: "FINALIZED", execution: "SUCCESS" });
  assert.throws(() => normalizeReceipt({ status: "wat" }), /receipt/i);
});

test("submission is persisted and duplicate worker reuses the same transaction", async () => {
  const port = new FixturePort(); const store = new MemoryJudgeStore(); const tracker = new GenLayerTracker(port, store, "0x1111111111111111111111111111111111111111");
  assert.equal(await tracker.submit(pair), `0x${"ab".repeat(32)}`); assert.equal(await tracker.submit(pair), `0x${"ab".repeat(32)}`); assert.equal(port.submissions, 1);
});

test("concurrent duplicate workers share one GenLayer submission", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  class SlowPort extends FixturePort {
    override async submit() {
      await gate;
      return super.submit();
    }
  }
  const port = new SlowPort();
  const store = new MemoryJudgeStore();
  const first = new GenLayerTracker(port, store, "0x1111111111111111111111111111111111111111").submit(pair);
  const second = new GenLayerTracker(port, store, "0x1111111111111111111111111111111111111111").submit(pair);
  release();
  assert.deepEqual(await Promise.all([first, second]), [`0x${"ab".repeat(32)}`, `0x${"ab".repeat(32)}`]);
  assert.equal(port.submissions, 1);
});

test("completed submission rejects conflicting bytes for the same attempt", async () => {
  const port = new FixturePort();
  const store = new MemoryJudgeStore();
  const tracker = new GenLayerTracker(port, store, "0x1111111111111111111111111111111111111111");
  await tracker.submit(pair);
  await assert.rejects(() => tracker.submit({ ...pair, outputADigest: id("e") }), /conflicting GenLayer submission/i);
  assert.equal(port.submissions, 1);
});

test("only finalized execution success plus matching canonical result advances once", async () => {
  const port = new FixturePort(); const store = new MemoryJudgeStore(); const tracker = new GenLayerTracker(port, store, "0x1111111111111111111111111111111111111111");
  await tracker.submit(pair);
  assert.equal((await tracker.poll(pair.matchId, pair.attemptId)).state, "FINALIZED");
  assert.equal((await tracker.poll(pair.matchId, pair.attemptId)).progressionApplied, true);
  assert.equal(store.progressionCount(pair.matchId), 1);
});

test("accepted, failed execution and wrong canonical IDs never advance", async () => {
  const port = new FixturePort(); const store = new MemoryJudgeStore(); const tracker = new GenLayerTracker(port, store, "0x1111111111111111111111111111111111111111");
  await tracker.submit(pair); port.receipt = { status: "ACCEPTED", executionStatus: "PENDING" };
  assert.equal((await tracker.poll(pair.matchId, pair.attemptId)).state, "ACCEPTED");
  port.receipt = { status: "FINALIZED", executionStatus: "FAILED" };
  assert.equal((await tracker.poll(pair.matchId, pair.attemptId)).state, "FAILED");
  port.receipt = { status: "FINALIZED", executionStatus: "SUCCESS" }; port.result.match_id = id("f");
  await assert.rejects(() => tracker.poll(pair.matchId, pair.attemptId), /canonical.*match/i);
  assert.equal(store.progressionCount(pair.matchId), 0);
});

test("malformed criterion or result enum is rejected", async () => {
  const port = new FixturePort(); const tracker = new GenLayerTracker(port, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111");
  await tracker.submit(pair); port.result.criteria[0].winner = "C";
  await assert.rejects(() => tracker.poll(pair.matchId, pair.attemptId), /verdict/i);
});

test("valid-shape verdict with invalid settlement meaning is rejected", async () => {
  const cases: Array<{ name: string; mutate: (result: any) => void; error: RegExp }> = [
    { name: "score", mutate: (result) => { result.score_a = 99; }, error: /score/i },
    { name: "safety", mutate: (result) => { result.safety_class = "A_SAFER"; }, error: /safety/i },
    { name: "aggregate", mutate: (result) => { result.result = "B_WIN"; }, error: /aggregate/i },
    { name: "reason bound", mutate: (result) => { result.criteria[0].reason = "r".repeat(321); }, error: /reason/i },
    { name: "summary bound", mutate: (result) => { result.summary = "s".repeat(641); }, error: /summary/i },
  ];
  for (const fixture of cases) {
    const port = new FixturePort();
    fixture.mutate(port.result);
    const tracker = new GenLayerTracker(port, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111");
    await tracker.submit(pair);
    await assert.rejects(() => tracker.poll(pair.matchId, pair.attemptId), fixture.error, fixture.name);
  }
});

test("deployed ArenaMatchJudge snake_case view schema is the tracker boundary", async () => {
  const port = new FixturePort(); const tracker = new GenLayerTracker(port, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111");
  await tracker.submit(pair);
  const outcome = await tracker.poll(pair.matchId, pair.attemptId);
  assert.deepEqual(outcome, { state: "FINALIZED", result: "A_WIN", progressionApplied: true });

  const missing = new FixturePort(); missing.result.criteria.pop();
  const missingTracker = new GenLayerTracker(missing, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111");
  await missingTracker.submit(pair);
  await assert.rejects(() => missingTracker.poll(pair.matchId, pair.attemptId), /criterion coverage/i);

  const swappedDigest = new FixturePort(); swappedDigest.result.output_digest_a = pair.outputBDigest;
  const digestTracker = new GenLayerTracker(swappedDigest, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111");
  await digestTracker.submit(pair);
  await assert.rejects(() => digestTracker.poll(pair.matchId, pair.attemptId), /output digest/i);
});

test("malformed transaction hash is rejected and never becomes a tracked submission", async () => {
  const port = new FixturePort(); port.submit = async () => "0xtx";
  const tracker = new GenLayerTracker(port, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111");
  await assert.rejects(() => tracker.submit(pair), /transaction hash/i);
});

test("GenLayer transaction and progression survive tracker restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-judge-"));
  const path = join(directory, "runtime.sqlite");
  const port = new FixturePort();
  try {
    const firstDatabase = new SqliteRuntimeStore(path);
    await new GenLayerTracker(port, new PersistentJudgeStore(firstDatabase), "0x1111111111111111111111111111111111111111").submit(pair);
    firstDatabase.close();

    const restartedDatabase = new SqliteRuntimeStore(path);
    const restartedStore = new PersistentJudgeStore(restartedDatabase);
    const restarted = new GenLayerTracker(port, restartedStore, "0x1111111111111111111111111111111111111111");
    assert.equal(await restarted.submit(pair), `0x${"ab".repeat(32)}`);
    assert.deepEqual(await restarted.poll(pair.matchId, pair.attemptId), { state: "FINALIZED", result: "A_WIN", progressionApplied: true });
    assert.deepEqual(await restarted.poll(pair.matchId, pair.attemptId), { state: "FINALIZED", result: "A_WIN", progressionApplied: true });
    assert.equal(port.submissions, 1);
    assert.equal(restartedStore.progressionCount(pair.matchId), 1);
    restartedDatabase.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a durable poll lease prevents stale finality from racing another tracker", async () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-judge-poll-"));
  const path = join(directory, "runtime.sqlite");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const port = new FixturePort();
  port.receipt = { status: "PENDING", executionStatus: "PENDING" };
  const originalGetReceipt = port.getReceipt.bind(port);
  let block = true;
  port.getReceipt = async () => {
    if (block) await gate;
    return originalGetReceipt();
  };
  const firstDatabase = new SqliteRuntimeStore(path);
  const secondDatabase = new SqliteRuntimeStore(path);
  try {
    const first = new GenLayerTracker(port, new PersistentJudgeStore(firstDatabase), "0x1111111111111111111111111111111111111111");
    const second = new GenLayerTracker(port, new PersistentJudgeStore(secondDatabase), "0x1111111111111111111111111111111111111111");
    await first.submit(pair);
    const pending = first.poll(pair.matchId, pair.attemptId);
    const safetyRelease = setTimeout(release, 50);
    await assert.rejects(() => second.poll(pair.matchId, pair.attemptId), /leased/i);
    clearTimeout(safetyRelease);
    release();
    assert.equal((await pending).state, "PENDING");
    block = false;
    port.receipt = { status: "FINALIZED", executionStatus: "SUCCESS" };
    assert.equal((await second.poll(pair.matchId, pair.attemptId)).state, "FINALIZED");
  } finally {
    release();
    firstDatabase.close();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
