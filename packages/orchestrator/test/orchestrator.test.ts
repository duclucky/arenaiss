import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TournamentOrchestrator, type OrchestratorInference, type OrchestratorJudge } from "../src/orchestrator.ts";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const tournamentId = digest("tournament");
const entrants = Array.from({ length: 8 }, (_, i) => ({ entrantId: digest(`entrant-${i}`), agentId: digest(`agent-${i}`), agentsVersion: digest(`version-${i}`), agentsMd: `Agent ${i}`, agentsCommitment: digest(`Agent ${i}`) }));

class FakeInference implements OrchestratorInference {
  calls: Array<{ matchId: string; attemptId: string; topic: string }> = [];
  partialAt = -1;
  async run(input: any) {
    this.calls.push({ matchId: input.matchId, attemptId: input.attemptId, topic: input.topic });
    if (this.calls.length === this.partialAt) return { state: "PARTIAL_PAIR" as const };
    return { state: "OUTPUTS_READY" as const, outputA: `A:${input.agentA.agentId}`, outputB: `B:${input.agentB.agentId}`, outputADigest: digest(`oa-${input.attemptId}`), outputBDigest: digest(`ob-${input.attemptId}`) };
  }
}

class FakeJudge implements OrchestratorJudge {
  calls = 0;
  tieFirst = false;
  async judge() { this.calls += 1; return { state: "FINALIZED" as const, result: this.tieFirst && this.calls === 1 ? "TIE" as const : "A_WIN" as const }; }
}

test("eight-player tournament completes Top 5 without players online", async () => {
  const inference = new FakeInference(); const judge = new FakeJudge();
  const result = await new TournamentOrchestrator(inference, judge).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1", "t2"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RANKING_READY");
  assert.equal(result.ranking?.length, 5);
  assert.equal(new Set(result.ranking).size, 5);
  assert.equal(inference.calls.length, judge.calls);
});

test("tie retries the whole pair with new attempt and next topic", async () => {
  const inference = new FakeInference(); const judge = new FakeJudge(); judge.tieFirst = true;
  const result = await new TournamentOrchestrator(inference, judge).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1", "t2"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RANKING_READY");
  assert.notEqual(inference.calls[0].attemptId, inference.calls[1].attemptId);
  assert.deepEqual(inference.calls.slice(0, 2).map((call) => call.topic), ["t1", "t2"]);
});

test("partial pair stops before judge submission and requests recovery", async () => {
  const inference = new FakeInference(); inference.partialAt = 1; const judge = new FakeJudge();
  const result = await new TournamentOrchestrator(inference, judge).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1"], bracketRevision: 1, retryCap: 1, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RECOVERY_REQUIRED"); assert.equal(judge.calls, 0);
});

test("operator-approved recovery abandons the incomplete attempt and retries the whole pair", async () => {
  const inference = new FakeInference(); inference.partialAt = 1; const judge = new FakeJudge();
  const first = await new TournamentOrchestrator(inference, judge).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1", "t2"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
  assert.equal(first.state, "RECOVERY_REQUIRED");
  if (first.state !== "RECOVERY_REQUIRED") throw new Error("expected recovery attempt");

  const result = await new TournamentOrchestrator(inference, judge).run({
    tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1", "t2"], bracketRevision: 1,
    retryCap: 2, expiresAt: 1000, now: () => 100, abandonedAttemptIds: [first.attemptId],
  });

  assert.equal(result.state, "RANKING_READY");
  assert.equal(inference.calls.filter((call) => call.attemptId === first.attemptId).length, 1);
  assert.equal(inference.calls[1].topic, "t2");
  assert.equal(judge.calls, 11);
});

test("pending judge transaction waits without creating a new attempt", async () => {
  const inference = new FakeInference();
  const judge: OrchestratorJudge & { calls: number } = { calls: 0, async judge() { this.calls += 1; return { state: "PENDING" as const }; } };
  const result = await new TournamentOrchestrator(inference, judge).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1", "t2"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "WAITING_FOR_JUDGE");
  assert.equal(inference.calls.length, 1);
  assert.equal(judge.calls, 1);
});

test("finalized execution failure requires recovery without creating a new attempt", async () => {
  const inference = new FakeInference();
  const judge: OrchestratorJudge & { calls: number } = { calls: 0, async judge() { this.calls += 1; return { state: "FAILED" as const }; } };
  const result = await new TournamentOrchestrator(inference, judge).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1", "t2"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RECOVERY_REQUIRED");
  assert.equal(inference.calls.length, 1);
  assert.equal(judge.calls, 1);
});

test("expiry requests refund instead of inventing a winner", async () => {
  const result = await new TournamentOrchestrator(new FakeInference(), new FakeJudge()).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1"], bracketRevision: 1, retryCap: 1, expiresAt: 100, now: () => 100 });
  assert.deepEqual(result, { state: "REFUND_REQUIRED", reason: "TOURNAMENT_EXPIRED" });
});

test("judge adapter exception becomes controlled recovery for the same attempt", async () => {
  const inference = new FakeInference();
  const judge: OrchestratorJudge = { async judge() { throw new Error("malformed canonical verdict"); } };
  const result = await new TournamentOrchestrator(inference, judge).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1", "t2"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RECOVERY_REQUIRED");
  assert.equal(inference.calls.length, 1);
  if (result.state === "RECOVERY_REQUIRED") assert.equal(result.attemptId, inference.calls[0].attemptId);
});

for (const retryResult of ["TIE", "RETRYABLE"] as const) {
  test(`${retryResult} exhausts exactly the frozen retry cap before refund`, async () => {
    const inference = new FakeInference();
    const judge: OrchestratorJudge & { calls: number } = {
      calls: 0,
      async judge() { this.calls += 1; return { state: "FINALIZED" as const, result: retryResult }; },
    };
    const result = await new TournamentOrchestrator(inference, judge).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1", "t2"], bracketRevision: 1, retryCap: 3, expiresAt: 1000, now: () => 100 });
    assert.deepEqual(result, { state: "REFUND_REQUIRED", reason: "RETRY_EXHAUSTED" });
    assert.equal(judge.calls, 3);
    assert.equal(new Set(inference.calls.map((call) => call.attemptId)).size, 3);
    assert.deepEqual(inference.calls.map((call) => call.topic), ["t1", "t2", "t1"]);
  });
}
