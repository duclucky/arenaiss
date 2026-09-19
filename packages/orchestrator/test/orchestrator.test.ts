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

test("nine-player rolling-bye tournament completes with one bye per odd round", async () => {
  const nineEntrants = [...entrants, { entrantId: digest("entrant-8"), agentId: digest("agent-8"), agentsVersion: digest("version-8"), agentsMd: "Agent 8", agentsCommitment: digest("Agent 8") }];
  const result = await new TournamentOrchestrator(new FakeInference(), new FakeJudge()).run({ tournamentId, seedDigest: digest("rolling-seed"), entrants: nineEntrants, topics: ["t1", "t2"], bracketRevision: 2, retryCap: 2, maxConcurrentMatches: 3, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RANKING_READY");
  assert.equal(result.ranking?.length, 5);
  assert.equal(new Set(result.ranking).size, 5);
});

test("tie retries the whole pair with new attempt and next topic", async () => {
  const inference = new FakeInference(); const judge = new FakeJudge(); judge.tieFirst = true;
  const result = await new TournamentOrchestrator(inference, judge).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1", "t2"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RANKING_READY");
  assert.notEqual(inference.calls[0].attemptId, inference.calls[1].attemptId);
  assert.deepEqual(inference.calls.slice(0, 2).map((call) => call.topic), ["t1", "t2"]);
});

test("seeded topic selection is reproducible, seed-dependent, and avoids repeats within a deck", async () => {
  const topics = Array.from({ length: 16 }, (_, index) => `topic-${index}`);
  const run = async (seedDigest: `sha256:${string}`) => {
    const inference = new FakeInference();
    const result = await new TournamentOrchestrator(inference, new FakeJudge()).run({
      tournamentId, seedDigest, entrants, topics, topicSelection: "seeded-shuffle-v1",
      bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100,
    });
    assert.equal(result.state, "RANKING_READY");
    return inference.calls.map((call) => call.topic);
  };
  const first = await run(digest("topic-seed-a"));
  assert.equal(first.length, 11);
  assert.equal(new Set(first).size, first.length);
  assert.deepEqual(await run(digest("topic-seed-a")), first);
  assert.notDeepEqual(await run(digest("topic-seed-b")), first);
});

test("partial pair stops before judge submission and requests recovery", async () => {
  const inference = new FakeInference(); inference.partialAt = 1; const judge = new FakeJudge();
  const result = await new TournamentOrchestrator(inference, judge).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1"], bracketRevision: 1, retryCap: 1, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RECOVERY_REQUIRED"); assert.equal(judge.calls, 0);
  if (result.state === "RECOVERY_REQUIRED") assert.equal(result.reason, "PROVIDER_INCOMPLETE");
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
  if (result.state === "RECOVERY_REQUIRED") assert.equal(result.reason, "JUDGE_FAILED");
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
  if (result.state === "RECOVERY_REQUIRED") assert.equal(result.reason, "JUDGE_ERROR");
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

test("independent matches run concurrently while judge writes remain serialized", async () => {
  let activeProviders = 0; let peakProviders = 0; let started = 0;
  let releaseFirst!: () => void;
  const firstBatch = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const inference: OrchestratorInference = { async run(input) {
    activeProviders += 1; peakProviders = Math.max(peakProviders, activeProviders);
    if (++started === 3) releaseFirst();
    await firstBatch;
    activeProviders -= 1;
    return { state: "OUTPUTS_READY", outputA: "A", outputB: "B", outputADigest: digest(`A-${input.attemptId}`), outputBDigest: digest(`B-${input.attemptId}`) };
  } };
  let activeJudges = 0; let peakJudges = 0;
  const judge: OrchestratorJudge = { async judge() {
    activeJudges += 1; peakJudges = Math.max(peakJudges, activeJudges);
    await new Promise<void>((resolve) => setImmediate(resolve));
    activeJudges -= 1;
    return { state: "FINALIZED", result: "A_WIN" };
  } };
  const result = await new TournamentOrchestrator(inference, judge).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1"], bracketRevision: 1, retryCap: 1, maxConcurrentMatches: 3, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RANKING_READY");
  assert.equal(peakProviders, 3);
  assert.equal(peakJudges, 1);
});

test("split judge serializes transaction submission but polls finality concurrently", async () => {
  let activeSubmissions = 0; let peakSubmissions = 0;
  let activePolls = 0; let peakPolls = 0; let startedPolls = 0;
  let releasePolls!: () => void;
  const pollBarrier = new Promise<void>((resolve) => { releasePolls = resolve; });
  const judge = {
    async judge() { throw new Error("concurrent path must use split submit and poll"); },
    async submit() {
      activeSubmissions += 1; peakSubmissions = Math.max(peakSubmissions, activeSubmissions);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeSubmissions -= 1;
    },
    async poll() {
      activePolls += 1; peakPolls = Math.max(peakPolls, activePolls);
      if (++startedPolls === 4) releasePolls();
      await pollBarrier;
      activePolls -= 1;
      return { state: "PENDING" as const };
    },
  } satisfies OrchestratorJudge;
  const result = await new TournamentOrchestrator(new FakeInference(), judge).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1"], bracketRevision: 1, retryCap: 1, maxConcurrentMatches: 4, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "WAITING_FOR_JUDGE");
  assert.equal(peakSubmissions, 1);
  assert.equal(peakPolls, 4);
});

test("split judge shares one submission queue across concurrent Tournament runs", async () => {
  let activeSubmissions = 0; let peakSubmissions = 0;
  const judge = {
    async judge() { throw new Error("concurrent path must use split submit and poll"); },
    async submit() {
      activeSubmissions += 1; peakSubmissions = Math.max(peakSubmissions, activeSubmissions);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeSubmissions -= 1;
    },
    async poll() { return { state: "PENDING" as const }; },
  } satisfies OrchestratorJudge;
  const orchestrator = new TournamentOrchestrator(new FakeInference(), judge);
  const results = await Promise.all([
    orchestrator.run({ tournamentId, seedDigest: digest("seed-a"), entrants, topics: ["t1"], bracketRevision: 1, retryCap: 1, maxConcurrentMatches: 4, expiresAt: 1000, now: () => 100 }),
    orchestrator.run({ tournamentId: digest("tournament-b"), seedDigest: digest("seed-b"), entrants, topics: ["t1"], bracketRevision: 1, retryCap: 1, maxConcurrentMatches: 4, expiresAt: 1000, now: () => 100 }),
  ]);
  assert.equal(results.every((result) => result.state === "WAITING_FOR_JUDGE"), true);
  assert.equal(peakSubmissions, 1);
});

test("match worker accepts thirty concurrent matches but rejects a higher limit", async () => {
  const accepted = await new TournamentOrchestrator(new FakeInference(), new FakeJudge()).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1"], bracketRevision: 1, retryCap: 1, maxConcurrentMatches: 30, expiresAt: 1000, now: () => 100 });
  assert.equal(accepted.state, "RANKING_READY");
  await assert.rejects(
    new TournamentOrchestrator(new FakeInference(), new FakeJudge()).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1"], bracketRevision: 1, retryCap: 1, maxConcurrentMatches: 31, expiresAt: 1000, now: () => 100 }),
    /match concurrency is invalid/,
  );
});

test("one blocked match does not prevent independent peers from finalizing in the same round", async () => {
  let calls = 0;
  const inference: OrchestratorInference = { async run(input) {
    calls += 1;
    return calls === 1 ? { state: "PARTIAL_PAIR", failureCode: "PROVIDER_ERROR" }
      : { state: "OUTPUTS_READY", outputA: "A", outputB: "B", outputADigest: digest(`A-${input.attemptId}`), outputBDigest: digest(`B-${input.attemptId}`) };
  } };
  const result = await new TournamentOrchestrator(inference, new FakeJudge()).run({ tournamentId, seedDigest: digest("seed"), entrants, topics: ["t1"], bracketRevision: 1, retryCap: 1, maxConcurrentMatches: 3, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RECOVERY_REQUIRED");
  assert.equal(result.results?.size, 3);
});
