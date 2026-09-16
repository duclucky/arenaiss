import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";
import { buildEvaluationInput, sha256Text, type EvaluationProviderInput, type EvaluationScenario } from "../src/protocol.ts";
import { MemoryEvaluationRunStore, PersistentEvaluationRunStore, EvaluationRunTracker, type EvaluationJudgePort, type EvaluationJudgeSubmission } from "../src/run-tracker.ts";
import { MemorySoloCampaignStore, PersistentSoloCampaignStore, SoloEvaluationRunner, type SoloCampaignInput, type SoloProviderPort } from "../src/solo-runner.ts";

const digest = (char: string) => `sha256:${char.repeat(64)}` as const;
const owner = "0x1111111111111111111111111111111111111111";
const judgeAddress = "0x2222222222222222222222222222222222222222";
const transactionHash = `0x${"ab".repeat(32)}`;

function scenarios(): EvaluationScenario[] {
  return ["evidence", "conflict"].map((name) => ({
    schema: "arena-test-scenario-v1",
    scenarioId: `${name}_01`,
    version: "1.0.0",
    level: "RESPONSE",
    objective: `Handle ${name} safely.`,
    context: "Evidence may be incomplete.",
    constraints: ["State uncertainty."],
    availableActions: [],
    forbiddenActionIds: [],
    confirmationRequiredActionIds: [],
    maxProposedActions: 0,
  }));
}

function campaign(maxProviderAttempts = 2): SoloCampaignInput {
  const agentsMd = "Prefer safe, evidence-backed decisions.";
  return {
    campaignId: digest("a"),
    owner,
    agent: { versionId: digest("b"), commitment: sha256Text(agentsMd), agentsMd },
    testPack: { packId: digest("c"), version: "1.0.0", scenarios: scenarios() },
    runtimePolicy: { model: "fixture-model", maxOutputTokens: 600, temperature: 0, maxProviderAttempts },
    rubricVersion: "AgentEvaluationV5",
  };
}

function providerResult(input: EvaluationProviderInput) {
  const rawOutput = JSON.stringify({
    schema: "arena-evaluation-output-v1",
    mode: input.mode,
    decision: "RESPOND",
    answer: `Answer for ${input.scenario.scenario_id}.`,
    observable_rationale: "The answer follows the evidence-first profile.",
    proposed_actions: [],
  });
  return {
    requestId: `request:${input.scenario.scenario_id}`,
    usageTokens: 100,
    rawOutput,
    output: {
      schema: "arena-evaluation-output-v1" as const,
      mode: "RESPONSE" as const,
      decision: "RESPOND" as const,
      answer: `Answer for ${input.scenario.scenario_id}.`,
      observableRationale: "The answer follows the evidence-first profile.",
      proposedActions: [],
    },
  };
}

class FixtureProvider implements SoloProviderPort {
  calls: Array<{ operationKey: string; input: EvaluationProviderInput }> = [];
  failures: string[] = [];
  async generate(value: { input: EvaluationProviderInput; operationKey: string }) {
    this.calls.push({ operationKey: value.operationKey, input: structuredClone(value.input) });
    const failure = this.failures.shift();
    if (failure) throw new Error(failure);
    return providerResult(value.input);
  }
}

class FixtureJudge implements EvaluationJudgePort {
  submissions = new Map<string, EvaluationJudgeSubmission>();
  async submit(value: EvaluationJudgeSubmission) { this.submissions.set(value.runId, structuredClone(value)); return transactionHash; }
  async getReceipt() { return { statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" }; }
  async getEvaluation(_address: string, runId: string) {
    const submission = this.submissions.get(runId)!;
    const dimensions = ["instruction_adherence", "reasoning_quality", "action_selection", "rule_compliance", "task_completion", "safety"];
    return {
      status: "FINAL", run_id: runId, agent_version_id: submission.agentVersionId, mode: submission.mode,
      rubric_version: submission.rubricVersion, agents_digest: submission.agentsDigest,
      scenario_digest: submission.scenarioDigest, response_digest: submission.responseDigest,
      dimensions: dimensions.map((dimension_id) => ({
        dimension_id,
        grade: dimension_id === "action_selection" ? "NOT_APPLICABLE" : "GOOD",
        reason: `${dimension_id} is supported.`,
        evidence_refs: [dimension_id === "instruction_adherence" ? "AGENTS_MD" : "RESPONSE"],
      })),
      overall_score: 80, result_class: "PASS", policy_findings: [], summary: "The response is supported.", actions_executed: false,
    };
  }
}

test("multi-scenario SOLO campaign resumes after SQLite restart without duplicate provider or judge calls", async () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-solo-"));
  const path = join(directory, "runtime.sqlite");
  const provider = new FixtureProvider();
  const judge = new FixtureJudge();
  let active: SqliteRuntimeStore | undefined;
  try {
    active = new SqliteRuntimeStore(path);
    let runner = new SoloEvaluationRunner(provider, new EvaluationRunTracker(judge, new PersistentEvaluationRunStore(active), judgeAddress), new PersistentSoloCampaignStore(active));
    runner.start(campaign());
    const first = await runner.advance(digest("a"));
    assert.equal(first.items[0].state, "FINALIZED");
    assert.equal(first.items[1].state, "PENDING");
    active.close(); active = undefined;

    active = new SqliteRuntimeStore(path);
    runner = new SoloEvaluationRunner(provider, new EvaluationRunTracker(judge, new PersistentEvaluationRunStore(active), judgeAddress), new PersistentSoloCampaignStore(active));
    const final = await runner.advance(digest("a"));
    assert.equal(final.state, "FINALIZED");
    assert.deepEqual(final.items.map((item) => item.scorecard?.result_class), ["PASS", "PASS"]);
    assert.equal(provider.calls.length, 2);
    assert.equal(judge.submissions.size, 2);
    assert.notEqual(final.items[0].runIds[0], final.items[1].runIds[0]);
  } finally {
    active?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("transient provider failure gets a new bound attempt while second empty output fails without a score", async () => {
  const provider = new FixtureProvider();
  provider.failures.push("EMPTY_OUTPUT", "EMPTY_OUTPUT");
  const judge = new FixtureJudge();
  const runStore = new MemoryEvaluationRunStore();
  const runner = new SoloEvaluationRunner(provider, new EvaluationRunTracker(judge, runStore, judgeAddress), new MemorySoloCampaignStore());
  runner.start({ ...campaign(2), testPack: { ...campaign(2).testPack, scenarios: [scenarios()[0]] } });
  const retryable = await runner.advance(digest("a"));
  assert.equal(retryable.state, "RUNNING");
  assert.equal(retryable.items[0].state, "RETRYABLE");
  const failed = await runner.advance(digest("a"));
  assert.equal(failed.state, "FAILED");
  assert.equal(failed.items[0].failure, "EMPTY_OUTPUT");
  assert.equal(failed.items[0].failureStage, "PROVIDER");
  assert.equal(failed.items[0].failureCode, "EMPTY_OUTPUT");
  assert.equal(failed.items[0].scorecard, undefined);
  assert.equal(failed.items[0].runIds.length, 2);
  assert.equal(judge.submissions.size, 0);
});

test("an unexpected infrastructure exception can terminally fail the active scenario without inventing a score", () => {
  const runner = new SoloEvaluationRunner(new FixtureProvider(), new EvaluationRunTracker(new FixtureJudge(), new MemoryEvaluationRunStore(), judgeAddress), new MemorySoloCampaignStore());
  runner.start(campaign());
  const failed = runner.failInfrastructure(digest("a"), { stage: "PERSISTENCE", code: "CAMPAIGN_READ_FAILED" });
  assert.equal(failed.state, "FAILED");
  assert.equal(failed.items[0].state, "FAILED");
  assert.equal(failed.items[0].failure, "INFRASTRUCTURE_ERROR");
  assert.equal(failed.items[0].failureStage, "PERSISTENCE");
  assert.equal(failed.items[0].failureCode, "CAMPAIGN_READ_FAILED");
  assert.equal(failed.items[0].scorecard, undefined);
  assert.equal(failed.items[1].state, "PENDING");
  assert.deepEqual(runner.failInfrastructure(digest("a")), failed);
});

test("uncertain GenLayer submission stays active while automatic reconciliation is in progress", async () => {
  let now = 1_000;
  class FailingJudge extends FixtureJudge {
    calls = 0;
    override async submit() { this.calls += 1; throw new Error("secret upstream payload must not persist"); }
    override async getEvaluation(_address: string, runId: string) { return { status: "UNKNOWN", run_id: runId }; }
  }
  const judge = new FailingJudge();
  const tracker = new EvaluationRunTracker(judge, new MemoryEvaluationRunStore(), judgeAddress, {
    now: () => now,
    replayDelayMs: 100,
    recoveryTimeoutMs: 300,
    maxSubmissionAttempts: 2,
  });
  const runner = new SoloEvaluationRunner(new FixtureProvider(), tracker, new MemorySoloCampaignStore());
  runner.start({ ...campaign(), testPack: { ...campaign().testPack, scenarios: [scenarios()[0]] } });
  const held = await runner.advance(digest("a"));
  assert.equal(held.state, "RUNNING");
  assert.equal(held.items[0].state, "JUDGING");
  assert.equal(held.items[0].failureStage, "GENLAYER_FINALITY");
  assert.equal(held.items[0].failureCode, "GENLAYER_RECONCILING");
  assert.equal(JSON.stringify(held).includes("secret upstream payload"), false);
  assert.equal((await runner.advance(digest("a"))).state, "RUNNING");
  assert.equal(judge.calls, 1);

  now += 100;
  assert.equal((await runner.advance(digest("a"))).state, "RUNNING");
  assert.equal(judge.calls, 2);

  now += 200;
  const manual = await runner.advance(digest("a"));
  assert.equal(manual.state, "RECOVERY_REQUIRED");
  assert.equal(manual.items[0].state, "RECOVERY_REQUIRED");
  assert.equal(manual.items[0].failureCode, "GENLAYER_TRANSACTION_UNKNOWN");
  assert.equal(judge.calls, 2);
});

test("SOLO completes when GenLayer stored the run but its submission response was lost", async () => {
  class LostResponseJudge extends FixtureJudge {
    calls = 0;
    override async submit(value: EvaluationJudgeSubmission) {
      this.calls += 1;
      await super.submit(value);
      throw new Error("RPC response lost after submission");
    }
  }
  const judge = new LostResponseJudge();
  const runner = new SoloEvaluationRunner(new FixtureProvider(), new EvaluationRunTracker(judge, new MemoryEvaluationRunStore(), judgeAddress), new MemorySoloCampaignStore());
  runner.start({ ...campaign(), testPack: { ...campaign().testPack, scenarios: [scenarios()[0]] } });

  const final = await runner.advance(digest("a"));
  assert.equal(final.state, "FINALIZED");
  assert.equal(final.items[0].state, "FINALIZED");
  assert.equal(final.items[0].scorecard?.result_class, "PASS");
  assert.equal(judge.calls, 1);
});

test("transient GenLayer receipt errors keep the same run pending and never resubmit", async () => {
  class FlakyReceiptJudge extends FixtureJudge {
    polls = 0;
    submissionsCount = 0;
    override async submit(value: EvaluationJudgeSubmission) { this.submissionsCount += 1; return super.submit(value); }
    override async getReceipt() {
      this.polls += 1;
      if (this.polls === 1) throw new Error("temporary RPC timeout");
      return super.getReceipt();
    }
  }
  const judge = new FlakyReceiptJudge();
  const runner = new SoloEvaluationRunner(new FixtureProvider(), new EvaluationRunTracker(judge, new MemoryEvaluationRunStore(), judgeAddress), new MemorySoloCampaignStore());
  runner.start({ ...campaign(), testPack: { ...campaign().testPack, scenarios: [scenarios()[0]] } });
  const pending = await runner.advance(digest("a"));
  assert.equal(pending.state, "RUNNING");
  assert.equal(pending.items[0].state, "JUDGING");
  assert.equal(pending.items[0].failureCode, "GENLAYER_FINALITY_RETRY");
  const finalized = await runner.advance(digest("a"));
  assert.equal(finalized.state, "FINALIZED");
  assert.equal(judge.submissionsCount, 1);
  assert.deepEqual(finalized.items[0].runIds, pending.items[0].runIds);
});

test("concurrent SOLO advance shares one paid operation", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  class SlowProvider extends FixtureProvider {
    override async generate(value: any) { await gate; return super.generate(value); }
  }
  const provider = new SlowProvider();
  const judge = new FixtureJudge();
  const tracker = new EvaluationRunTracker(judge, new MemoryEvaluationRunStore(), judgeAddress);
  const runner = new SoloEvaluationRunner(provider, tracker, new MemorySoloCampaignStore());
  runner.start({ ...campaign(), testPack: { ...campaign().testPack, scenarios: [scenarios()[0]] } });
  const one = runner.advance(digest("a"));
  const two = runner.advance(digest("a"));
  release();
  const [left, right] = await Promise.all([one, two]);
  assert.deepEqual(left, right);
  assert.equal(provider.calls.length, 1);
  assert.equal(judge.submissions.size, 1);
});

test("resume reconciles a provider failure persisted before the campaign update", async () => {
  class InterruptedStore extends MemorySoloCampaignStore {
    interrupt = true;
    override put(record: any) {
      if (this.interrupt && record.items?.[0]?.state === "RETRYABLE") {
        this.interrupt = false;
        throw new Error("simulated campaign write interruption");
      }
      super.put(record);
    }
  }
  const provider = new FixtureProvider();
  provider.failures.push("PROVIDER_TIMEOUT");
  const judge = new FixtureJudge();
  const store = new InterruptedStore();
  const runner = new SoloEvaluationRunner(provider, new EvaluationRunTracker(judge, new MemoryEvaluationRunStore(), judgeAddress), store);
  runner.start({ ...campaign(), testPack: { ...campaign().testPack, scenarios: [scenarios()[0]] } });
  await assert.rejects(() => runner.advance(digest("a")), /simulated campaign write interruption/);
  const recovered = await runner.advance(digest("a"));
  assert.equal(recovered.items[0].state, "RETRYABLE");
  assert.equal(recovered.items[0].failure, "PROVIDER_TIMEOUT");
  assert.equal(judge.submissions.size, 0);
});

test("pending GenLayer finality resumes the same run without another provider call or submission", async () => {
  class PendingJudge extends FixtureJudge {
    receiptReads = 0;
    override async getReceipt() {
      this.receiptReads += 1;
      return this.receiptReads === 1
        ? { statusName: "ACCEPTED", txExecutionResultName: "NOT_VOTED" }
        : { statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" };
    }
  }
  const provider = new FixtureProvider();
  const judge = new PendingJudge();
  const runner = new SoloEvaluationRunner(provider, new EvaluationRunTracker(judge, new MemoryEvaluationRunStore(), judgeAddress), new MemorySoloCampaignStore());
  runner.start({ ...campaign(), testPack: { ...campaign().testPack, scenarios: [scenarios()[0]] } });
  const pending = await runner.advance(digest("a"));
  assert.equal(pending.items[0].state, "JUDGING");
  const final = await runner.advance(digest("a"));
  assert.equal(final.state, "FINALIZED");
  assert.equal(provider.calls.length, 1);
  assert.equal(judge.submissions.size, 1);
  assert.equal(judge.receiptReads, 2);
});
