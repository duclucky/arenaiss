import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ComparisonRunRegistry } from "../../packages/evaluation/src/tournament-comparison.ts";
import { TournamentComparisonJudgeAdapter, TournamentEvaluationPairRunner } from "../../packages/evaluation/src/tournament-runner.ts";
import { ComparisonRunTracker, MemoryComparisonSubmissionStore, type ComparisonJudgeSubmission } from "../../packages/genlayer/src/comparison-tracker.ts";
import { TournamentOrchestrator } from "../../packages/orchestrator/src/orchestrator.ts";
import { expectedCredits } from "../../packages/settlement/src/worker.ts";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const dimensions = ["instruction_adherence", "reasoning_quality", "action_selection", "rule_compliance", "task_completion", "safety"];

test("E6 eight-Agent Tournament converges through rich ComparisonRuns without changing Arc payout math", async () => {
  const submissions = new Map<string, ComparisonJudgeSubmission>();
  const port = {
    async submit(value: ComparisonJudgeSubmission) {
      submissions.set(value.attemptId, structuredClone(value));
      return `0x${createHash("sha256").update(value.attemptId).digest("hex")}`;
    },
    async getReceipt() { return { statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" }; },
    async getComparison(_address: string, _matchId: string, attemptId: string) {
      const value = submissions.get(attemptId)!;
      return {
        status: "FINAL", match_id: value.matchId, attempt_id: value.attemptId,
        agent_version_id_a: value.agentVersionIdA, agent_version_id_b: value.agentVersionIdB,
        mode: value.mode, agents_digest_a: value.agentsDigestA, agents_digest_b: value.agentsDigestB,
        scenario_digest: value.scenarioDigest, response_digest_a: value.responseDigestA,
        response_digest_b: value.responseDigestB, rubric_version: value.rubricVersion,
        actions_executed: false, result: "A_WIN", score_a: 75, score_b: 0,
        safety_class: "NEITHER_UNSAFE", dimensions: dimensions.map((dimension_id) => ({
          dimension_id, winner: dimension_id === "safety" ? "TIE" : "A", reason: "bounded fixture evidence",
        })), policy_findings_a: [], policy_findings_b: [], summary: "A wins",
      };
    },
  };
  let providerCalls = 0;
  const provider = {
    async generate(value: any) {
      providerCalls += 1;
      const rawOutput = JSON.stringify({ schema: "arena-evaluation-output-v1", mode: "RESPONSE", decision: "RESPOND", answer: value.input.agent.version_id, observable_rationale: "Observable support.", proposed_actions: [] });
      return { rawOutput, output: {} };
    },
  };
  const tracker = new ComparisonRunTracker(port, new MemoryComparisonSubmissionStore(), new ComparisonRunRegistry(), "0x1111111111111111111111111111111111111111", 61997);
  const orchestrator = new TournamentOrchestrator(
    new TournamentEvaluationPairRunner(provider, { model: "fixture", maxOutputTokens: 1000, temperature: 0 }),
    new TournamentComparisonJudgeAdapter(tracker),
  );
  const entrants = Array.from({ length: 8 }, (_, index) => {
    const agentsMd = `Agent ${index}`;
    return { entrantId: digest(`entrant-${index}`), agentId: digest(`agent-${index}`), agentsVersion: digest(`version-${index}`), agentsMd, agentsCommitment: digest(agentsMd) };
  });
  const result = await orchestrator.run({ tournamentId: digest("tournament"), seedDigest: digest("seed"), entrants, topics: ["Compare both responses."], bracketRevision: 1, retryCap: 3, expiresAt: 2, now: () => 1 });
  assert.equal(result.state, "RANKING_READY");
  if (result.state !== "RANKING_READY") return;
  assert.equal(result.ranking.length, 5);
  assert.equal(result.results.size, 11);
  assert.equal(submissions.size, 11);
  assert.equal(providerCalls, 22);
  assert.deepEqual(expectedCredits("800000", [4000, 2500, 1500, 1000, 1000]), { fee: "80000", credits: ["288000", "180000", "108000", "72000", "72000"], totalLiability: "800000" });
});
