import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ComparisonRunRegistry, resultForTournamentProgression } from "../../evaluation/src/tournament-comparison.ts";
import { ComparisonRunTracker, MemoryComparisonSubmissionStore, type ComparisonJudgePort, type ComparisonJudgeSubmission } from "../src/comparison-tracker.ts";
import { SdkComparisonJudgePort } from "../src/comparison-sdk-port.ts";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const tx = `0x${"ab".repeat(32)}`;
const judge = "0x1111111111111111111111111111111111111111";
const scenarioJson = "scenario";
const responseJsonA = "response-a";
const responseJsonB = "response-b";
const submission: ComparisonJudgeSubmission = { matchId: digest("m"), attemptId: digest("a"), agentVersionIdA: digest("va"), agentVersionIdB: digest("vb"), mode: "RESPONSE", agentsMdA: "A", agentsMdB: "B", scenarioJson, responseJsonA, responseJsonB, agentsDigestA: digest("A"), agentsDigestB: digest("B"), scenarioDigest: digest(scenarioJson), responseDigestA: digest(responseJsonA), responseDigestB: digest(responseJsonB), rubricVersion: "AgentComparisonV1" };
const canonical = () => ({ status: "FINAL", match_id: submission.matchId, attempt_id: submission.attemptId, agent_version_id_a: submission.agentVersionIdA, agent_version_id_b: submission.agentVersionIdB, mode: submission.mode, agents_digest_a: submission.agentsDigestA, agents_digest_b: submission.agentsDigestB, scenario_digest: submission.scenarioDigest, response_digest_a: submission.responseDigestA, response_digest_b: submission.responseDigestB, rubric_version: submission.rubricVersion, actions_executed: false, result: "A_WIN", score_a: 75, score_b: 0, safety_class: "NEITHER_UNSAFE", dimensions: ["instruction_adherence", "reasoning_quality", "action_selection", "rule_compliance", "task_completion", "safety"].map((dimension_id) => ({ dimension_id, winner: dimension_id === "safety" || dimension_id === "action_selection" ? "TIE" : "A", reason: "evidence" })), policy_findings_a: [], policy_findings_b: [], summary: "A wins" });

class Port implements ComparisonJudgePort {
  submissions = 0; receipt: unknown = { statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" }; result: any = canonical();
  async submit() { this.submissions += 1; return tx; }
  async getReceipt() { return this.receipt; }
  async getComparison() { return this.result; }
}

test("E6 rich tracker submits once, validates canonical bindings and exposes one eligible progression result", async () => {
  const port = new Port(); const registry = new ComparisonRunRegistry();
  const tracker = new ComparisonRunTracker(port, new MemoryComparisonSubmissionStore(), registry, judge, 61997);
  assert.equal(await tracker.submit(submission), tx);
  assert.equal(await tracker.submit(submission), tx);
  const outcome = await tracker.poll(submission.matchId, submission.attemptId);
  assert.equal(port.submissions, 1); assert.equal(outcome.state, "FINALIZED");
  assert.equal(resultForTournamentProgression(outcome.run!), "A_WIN");
  assert.deepEqual(registry.get(outcome.run!.comparisonRunId), outcome.run);
});

test("E6 pending, failed and mismatched canonical comparisons never become eligible", async () => {
  const port = new Port(); const tracker = new ComparisonRunTracker(port, new MemoryComparisonSubmissionStore(), new ComparisonRunRegistry(), judge, 61997);
  await tracker.submit(submission);
  port.receipt = { statusName: "ACCEPTED", txExecutionResultName: "PENDING" };
  assert.deepEqual(await tracker.poll(submission.matchId, submission.attemptId), { state: "ACCEPTED" });
  port.receipt = { statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" }; port.result.response_digest_a = digest("wrong");
  await assert.rejects(() => tracker.poll(submission.matchId, submission.attemptId), /binding/i);
});

test("a finalized validator disagreement cannot produce a match result", async () => {
  const port = new Port();
  const registry = new ComparisonRunRegistry();
  const tracker = new ComparisonRunTracker(port, new MemoryComparisonSubmissionStore(), registry, judge, 61997);
  await tracker.submit(submission);
  port.receipt = { statusName: "FINALIZED", resultName: "MAJORITY_DISAGREE", txExecutionResultName: "FINISHED_WITH_RETURN" };
  port.getComparison = async () => { throw new Error("canonical read must not run"); };
  assert.deepEqual(await tracker.poll(submission.matchId, submission.attemptId), { state: "FAILED" });
});

test("E6 SDK adapter estimates v0.6 fees and submits the exact comparison ABI", async () => {
  const calls: any[] = []; const fees = { distribution: {}, messageAllocations: [], feeValue: 1n };
  const client = { async estimateTransactionFeesForWrite(input: any) { calls.push(["estimate", input]); return fees; }, async writeContract(input: any) { calls.push(["write", input]); return tx; }, async getTransaction() {}, async readContract() {} };
  const port = new SdkComparisonJudgePort(client);
  assert.equal(await port.submit(submission, judge), tx);
  assert.equal(calls[0][1].functionName, "submit_comparison");
  assert.equal(calls[0][1].args.length, 16);
  assert.deepEqual(calls[1][1].fees, fees);
});

test("comparison SDK serializes transaction sends across clients but releases on transaction hash", async () => {
  let activeWrites = 0; let peakWrites = 0; let startedWrites = 0;
  let releaseFirst!: () => void;
  const firstWrite = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const client = () => ({
    async estimateTransactionFeesForWrite() { return { distribution: {}, messageAllocations: {}, feeValue: 1n }; },
    async writeContract() {
      activeWrites += 1; startedWrites += 1; peakWrites = Math.max(peakWrites, activeWrites);
      if (startedWrites === 1) await firstWrite;
      activeWrites -= 1;
      return tx;
    },
    async getTransaction() {},
    async readContract() {},
  });
  const first = new SdkComparisonJudgePort(client()).submit(submission, judge);
  const second = new SdkComparisonJudgePort(client()).submit({ ...submission, attemptId: digest("second-attempt") }, judge);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const writesBeforeFirstHash = startedWrites;
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(writesBeforeFirstHash, 1);
  assert.equal(peakWrites, 1);
  assert.equal(startedWrites, 2);
});
