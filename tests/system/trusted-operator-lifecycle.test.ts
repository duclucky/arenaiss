import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferencePairRunner, MemoryInferenceStore, PersistentInferenceStore, type ModelProvider } from "../../packages/inference/src/pair-runner.ts";
import { GenLayerTracker, MemoryJudgeStore, PersistentJudgeStore, type GenLayerPort } from "../../packages/genlayer/src/tracker.ts";
import { TournamentOrchestrator, type OrchestratorJudge } from "../../packages/orchestrator/src/orchestrator.ts";
import { SettlementWorker, MemorySettlementStore, PersistentSettlementStore, expectedCredits, type ArcSettlementPort } from "../../packages/settlement/src/worker.ts";
import { SqliteRuntimeStore } from "../../packages/persistence/src/sqlite-runtime.ts";
import { ArenaApiService } from "../../services/api/src/service.ts";
import { ArenaHttpApi } from "../../services/api/src/http.ts";
import { buildBracket } from "../../packages/domain/src/bracket.ts";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const bytes32 = (value: string) => `0x${createHash("sha256").update(value).digest("hex")}`;

class Provider implements ModelProvider {
  calls = 0;
  failAt = -1;
  async generate(request: any) {
    this.calls += 1;
    if (this.calls === this.failAt) throw new Error("PROVIDER_TRANSIENT");
    return { requestId: `req-${this.calls}`, output: `${request.agentsMd}\n${request.topic}`, usageTokens: 20, costMicros: 10 };
  }
}

class GenLayer implements GenLayerPort {
  submissions = 0; pairs = new Map<string, any>();
  receipt: any = { status: "FINALIZED", executionStatus: "SUCCESS" };
  mutateResult?: (result: any) => any;
  async submit(pair: any) { this.submissions += 1; const tx = `0x${this.submissions.toString(16).padStart(64, "0")}`; this.pairs.set(tx, pair); return tx; }
  async getReceipt() { return this.receipt; }
  async getResult(_address: string, matchId: string, attemptId: string) {
    const pair = [...this.pairs.values()].find((candidate) => candidate.matchId === matchId && candidate.attemptId === attemptId);
    const result = {
      status: "FINAL", match_id: matchId, attempt_id: attemptId, rubric_version: "GeneralResponseV7",
      topic_digest: sha(pair.topic), output_digest_a: pair.outputADigest, output_digest_b: pair.outputBDigest,
      result: "A_WIN", score_a: 100, score_b: 0, safety_class: "NEITHER_UNSAFE",
      criteria: ["relevance", "task_completion", "reasoning_quality", "clarity", "safety"].map((criterion_id) => ({ criterion_id, winner: criterion_id === "safety" ? "TIE" : "A", reason: `Fixture reason for ${criterion_id}` })),
      summary: "Fixture A satisfies the topic.",
    };
    return this.mutateResult ? this.mutateResult(result) : result;
  }
}

class JudgeAdapter implements OrchestratorJudge {
  private tracker: GenLayerTracker;
  constructor(tracker: GenLayerTracker) { this.tracker = tracker; }
  async judge(input: any) {
    const pair = { matchId: input.matchId, attemptId: input.attemptId, topic: input.topic, outputA: input.outputA, outputB: input.outputB, outputADigest: input.outputADigest, outputBDigest: input.outputBDigest, rubricVersion: "GeneralResponseV7" };
    await this.tracker.submit(pair); const outcome = await this.tracker.poll(input.matchId, input.attemptId);
    if (outcome.state === "FINALIZED" && outcome.result) {
      return { state: "FINALIZED" as const, result: outcome.result as "A_WIN" | "B_WIN" | "TIE" | "RETRYABLE" };
    }
    if (outcome.state === "FAILED") return { state: "FAILED" as const };
    return { state: outcome.state as "SUBMITTED" | "PENDING" | "ACCEPTED" };
  }
}

class Arc implements ArcSettlementPort {
  sends = 0; view: any;
  constructor(view: any) { this.view = view; }
  async sendSettlement() { this.sends += 1; return `0x${"ac".repeat(32)}`; }
  async getReceipt() { return { status: 1 }; }
  async readSettlement() { return this.view; }
}

/**
 * A narrow local escrow probe for system recovery tests. Solidity remains the
 * accounting authority; this harness only makes the cross-component call
 * sequence and liability invariants observable without RPC or token I/O.
 */
class EscrowLifecycleHarness implements ArcSettlementPort {
  state: "RUNNING" | "SETTLED" | "CANCELLED_REFUNDABLE" | "CLOSED" = "RUNNING";
  lockedStakes: bigint;
  totalLiability = 0n;
  platformFee = 0n;
  cancelCalls = 0;
  settlementCalls = 0;
  private credits = new Map<string, bigint>();
  private refunded = new Set<string>();
  private cancelTx = `0x${"cf".repeat(32)}`;
  private settlementView = { fee: "0", credits: [] as string[], totalLiability: "0" };
  private stakePool: bigint;
  private entrants: readonly string[];
  private stakeAmount: bigint;

  constructor(stakePool: bigint, entrants: readonly string[], stakeAmount = 100000n) {
    this.stakePool = stakePool;
    this.entrants = entrants;
    this.stakeAmount = stakeAmount;
    this.lockedStakes = stakePool;
  }

  async sendSettlement(input: { tournamentId: string; rankedEntrants: readonly string[]; rankingDigest: string; settlementNonce: string }): Promise<string> {
    if (this.state !== "RUNNING") throw new Error("invalid escrow state");
    this.settlementCalls += 1;
    this.state = "SETTLED";
    this.lockedStakes = 0n;
    this.totalLiability = this.stakePool;
    this.platformFee = this.stakePool * 1000n / 10000n;
    const net = this.stakePool - this.platformFee;
    const payoutBps = [4000n, 2500n, 1500n, 1000n, 1000n];
    const payouts = payoutBps.map((bps) => net * bps / 10000n);
    const remainder = net - payouts.reduce((sum, amount) => sum + amount, 0n);
    payouts[0] += remainder;
    input.rankedEntrants.forEach((entrantId, index) => this.credits.set(entrantId, payouts[index]));
    this.settlementView = { fee: this.platformFee.toString(), credits: payouts.map(String), totalLiability: this.totalLiability.toString() };
    return `0x${"se".repeat(32)}`;
  }

  async getReceipt(): Promise<unknown> { return { status: 1 }; }
  async readSettlement(): Promise<{ fee: string; credits: readonly string[]; totalLiability: string }> { return this.settlementView; }

  async cancelAndOpenRefunds(reason: string): Promise<string> {
    if (this.state === "CANCELLED_REFUNDABLE") return this.cancelTx;
    if (this.state !== "RUNNING") throw new Error("invalid escrow state");
    if (!reason) throw new Error("refund reason is required");
    this.cancelCalls += 1;
    this.state = "CANCELLED_REFUNDABLE";
    this.totalLiability = this.lockedStakes;
    this.lockedStakes = 0n;
    this.platformFee = 0n;
    return this.cancelTx;
  }

  async claimRefund(entrantId: string): Promise<void> {
    if (this.state !== "CANCELLED_REFUNDABLE") throw new Error("invalid escrow state");
    if (!this.entrants.includes(entrantId) || this.refunded.has(entrantId)) throw new Error("invalid refund claimant");
    this.refunded.add(entrantId);
    this.credits.set(entrantId, (this.credits.get(entrantId) ?? 0n) + this.stakeAmount);
  }

  async withdrawCredit(account: string): Promise<void> {
    const amount = this.credits.get(account) ?? 0n;
    if (amount === 0n) throw new Error("no credit");
    this.credits.set(account, 0n);
    this.totalLiability -= amount;
  }

  async withdrawPlatformFee(): Promise<void> {
    if (this.platformFee === 0n) throw new Error("no platform fee");
    this.totalLiability -= this.platformFee;
    this.platformFee = 0n;
  }

  async closeTournament(): Promise<void> {
    if (this.state !== "SETTLED" && this.state !== "CANCELLED_REFUNDABLE") throw new Error("invalid escrow state");
    if (this.totalLiability !== 0n || this.lockedStakes !== 0n) throw new Error("liability outstanding");
    this.state = "CLOSED";
  }
}

test("trusted-operator local lifecycle yields one Top 5 and one exact settlement", async () => {
  const provider = new Provider(); const inference = new InferencePairRunner(provider, new MemoryInferenceStore());
  const genlayer = new GenLayer(); const tracker = new GenLayerTracker(genlayer, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111");
  const entrants = Array.from({ length: 8 }, (_, i) => ({ entrantId: sha(`entrant-${i}`), agentId: sha(`agent-${i}`), agentsVersion: sha(`v-${i}`), agentsMd: `Agent ${i}`, agentsCommitment: sha(`Agent ${i}`) }));
  const policy = { version: "model-v1", model: "fixture", wrapper: "Answer.", maxOutputBytes: 8192, temperature: 0, maxCostMicros: 100000, maxCostPerCallMicros: 100 };
  const orchestrator = new TournamentOrchestrator({ run: (input: any) => inference.runPair({ ...input, policy }) }, new JudgeAdapter(tracker));
  const result = await orchestrator.run({ tournamentId: sha("t"), seedDigest: sha("seed"), entrants, topics: ["topic-a", "topic-b"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RANKING_READY"); if (result.state !== "RANKING_READY") return;
  assert.equal(result.ranking.length, 5); assert.equal(provider.calls, genlayer.submissions * 2);

  const accounting = expectedCredits("800000", [4000, 2500, 1500, 1000, 1000]); const arc = new Arc(accounting);
  const worker = new SettlementWorker(arc, new MemorySettlementStore());
  const settlement = { tournamentId: bytes32("t"), rankedEntrants: result.ranking.map((id) => bytes32(id)), settlementNonce: "1", grossPool: "800000", payoutBps: [4000, 2500, 1500, 1000, 1000] };
  assert.equal(await worker.submit(settlement), await worker.submit(settlement)); assert.equal(arc.sends, 1);
  assert.deepEqual(await worker.reconcile(settlement), { state: "COMPLETE" });
  assert.equal(accounting.fee, "80000"); assert.equal(accounting.credits.reduce((sum, value) => sum + BigInt(value), 0n), 720000n);
});

test("pending GenLayer transaction resumes the same transaction before tournament continuation", async () => {
  const provider = new Provider();
  const inference = new InferencePairRunner(provider, new MemoryInferenceStore());
  const genlayer = new GenLayer();
  genlayer.receipt = { status: "PENDING", executionStatus: "PENDING" };
  const tracker = new GenLayerTracker(genlayer, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111");
  const entrants = Array.from({ length: 8 }, (_, i) => ({ entrantId: sha(`pending-entrant-${i}`), agentId: sha(`pending-agent-${i}`), agentsVersion: sha(`pending-v-${i}`), agentsMd: `Pending Agent ${i}`, agentsCommitment: sha(`Pending Agent ${i}`) }));
  const policy = { version: "model-v1", model: "fixture", wrapper: "Answer.", maxOutputBytes: 8192, temperature: 0, maxCostMicros: 100000, maxCostPerCallMicros: 100 };
  const orchestrator = new TournamentOrchestrator({ run: (input: any) => inference.runPair({ ...input, policy }) }, new JudgeAdapter(tracker));
  const input = { tournamentId: sha("pending-t"), seedDigest: sha("pending-seed"), entrants, topics: ["topic-a", "topic-b"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 };

  const waiting = await orchestrator.run(input);
  assert.equal(waiting.state, "WAITING_FOR_JUDGE");
  assert.equal(provider.calls, 2);
  assert.equal(genlayer.submissions, 1);

  genlayer.receipt = { status: "FINALIZED", executionStatus: "SUCCESS" };
  const completed = await orchestrator.run(input);
  assert.equal(completed.state, "RANKING_READY");
  assert.equal(provider.calls, genlayer.submissions * 2);
});

test("finalized GenLayer execution failure never creates a replacement attempt automatically", async () => {
  const provider = new Provider();
  const inference = new InferencePairRunner(provider, new MemoryInferenceStore());
  const genlayer = new GenLayer();
  genlayer.receipt = { status: "FINALIZED", executionStatus: "FAILED" };
  const tracker = new GenLayerTracker(genlayer, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111");
  const entrants = Array.from({ length: 8 }, (_, i) => ({ entrantId: sha(`failed-entrant-${i}`), agentId: sha(`failed-agent-${i}`), agentsVersion: sha(`failed-v-${i}`), agentsMd: `Failed Agent ${i}`, agentsCommitment: sha(`Failed Agent ${i}`) }));
  const policy = { version: "model-v1", model: "fixture", wrapper: "Answer.", maxOutputBytes: 8192, temperature: 0, maxCostMicros: 100000, maxCostPerCallMicros: 100 };
  const orchestrator = new TournamentOrchestrator({ run: (input: any) => inference.runPair({ ...input, policy }) }, new JudgeAdapter(tracker));
  const result = await orchestrator.run({ tournamentId: sha("failed-t"), seedDigest: sha("failed-seed"), entrants, topics: ["topic-a", "topic-b"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RECOVERY_REQUIRED");
  assert.equal(provider.calls, 2);
  assert.equal(genlayer.submissions, 1);
});

test("full operator lifecycle resumes persisted external operations after process restarts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-system-restart-"));
  const databasePath = join(directory, "runtime.sqlite");
  const provider = new Provider();
  const genlayer = new GenLayer();
  const judgeAddress = "0x1111111111111111111111111111111111111111";
  const entrants = Array.from({ length: 8 }, (_, i) => ({ entrantId: sha(`restart-entrant-${i}`), agentId: sha(`restart-agent-${i}`), agentsVersion: sha(`restart-v-${i}`), agentsMd: `Restart Agent ${i}`, agentsCommitment: sha(`Restart Agent ${i}`) }));
  const policy = { version: "model-v1", model: "fixture", wrapper: "Answer.", maxOutputBytes: 8192, temperature: 0, maxCostMicros: 100000, maxCostPerCallMicros: 100 };
  const input = { tournamentId: sha("restart-t"), seedDigest: sha("restart-seed"), entrants, topics: ["topic-a", "topic-b"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 };
  try {
    genlayer.receipt = { status: "PENDING", executionStatus: "PENDING" };
    const firstDatabase = new SqliteRuntimeStore(databasePath);
    const firstOrchestrator = new TournamentOrchestrator(
      { run: (pairInput: any) => new InferencePairRunner(provider, new PersistentInferenceStore(firstDatabase)).runPair({ ...pairInput, policy }) },
      new JudgeAdapter(new GenLayerTracker(genlayer, new PersistentJudgeStore(firstDatabase), judgeAddress)),
    );
    assert.equal((await firstOrchestrator.run(input)).state, "WAITING_FOR_JUDGE");
    assert.equal(provider.calls, 2);
    assert.equal(genlayer.submissions, 1);
    firstDatabase.close();

    genlayer.receipt = { status: "FINALIZED", executionStatus: "SUCCESS" };
    const restartedDatabase = new SqliteRuntimeStore(databasePath);
    const restartedOrchestrator = new TournamentOrchestrator(
      { run: (pairInput: any) => new InferencePairRunner(provider, new PersistentInferenceStore(restartedDatabase)).runPair({ ...pairInput, policy }) },
      new JudgeAdapter(new GenLayerTracker(genlayer, new PersistentJudgeStore(restartedDatabase), judgeAddress)),
    );
    const completed = await restartedOrchestrator.run(input);
    assert.equal(completed.state, "RANKING_READY");
    if (completed.state !== "RANKING_READY") return;
    assert.equal(provider.calls, genlayer.submissions * 2);

    const accounting = expectedCredits("800000", [4000, 2500, 1500, 1000, 1000]);
    const arc = new Arc(accounting);
    const settlement = { tournamentId: bytes32("restart-t"), rankedEntrants: completed.ranking.map((id) => bytes32(id)), settlementNonce: "1", grossPool: "800000", payoutBps: [4000, 2500, 1500, 1000, 1000] };
    await new SettlementWorker(arc, new PersistentSettlementStore(restartedDatabase)).submit(settlement);
    restartedDatabase.close();

    const settlementDatabase = new SqliteRuntimeStore(databasePath);
    const restartedSettlement = new SettlementWorker(arc, new PersistentSettlementStore(settlementDatabase));
    assert.equal(await restartedSettlement.submit(settlement), `0x${"ac".repeat(32)}`);
    assert.deepEqual(await restartedSettlement.reconcile(settlement), { state: "COMPLETE" });
    assert.equal(arc.sends, 1);
    settlementDatabase.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("malformed finalized GenLayer verdict enters recovery without advancing or resubmitting", async () => {
  const provider = new Provider();
  const inference = new InferencePairRunner(provider, new MemoryInferenceStore());
  const genlayer = new GenLayer();
  genlayer.mutateResult = (result) => ({ ...result, criteria: result.criteria.slice(0, 4) });
  const tracker = new GenLayerTracker(genlayer, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111");
  const entrants = Array.from({ length: 8 }, (_, i) => ({ entrantId: sha(`malformed-entrant-${i}`), agentId: sha(`malformed-agent-${i}`), agentsVersion: sha(`malformed-v-${i}`), agentsMd: `Malformed Agent ${i}`, agentsCommitment: sha(`Malformed Agent ${i}`) }));
  const policy = { version: "model-v1", model: "fixture", wrapper: "Answer.", maxOutputBytes: 8192, temperature: 0, maxCostMicros: 100000, maxCostPerCallMicros: 100 };
  const orchestrator = new TournamentOrchestrator({ run: (input: any) => inference.runPair({ ...input, policy }) }, new JudgeAdapter(tracker));
  const result = await orchestrator.run({ tournamentId: sha("malformed-t"), seedDigest: sha("malformed-seed"), entrants, topics: ["topic-a"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RECOVERY_REQUIRED");
  assert.equal(provider.calls, 2);
  assert.equal(genlayer.submissions, 1);
});

test("one-sided provider success never reaches GenLayer", async () => {
  const provider = new Provider();
  provider.failAt = 2;
  const inference = new InferencePairRunner(provider, new MemoryInferenceStore());
  const genlayer = new GenLayer();
  const tracker = new GenLayerTracker(genlayer, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111");
  const entrants = Array.from({ length: 8 }, (_, i) => ({ entrantId: sha(`partial-entrant-${i}`), agentId: sha(`partial-agent-${i}`), agentsVersion: sha(`partial-v-${i}`), agentsMd: `Partial Agent ${i}`, agentsCommitment: sha(`Partial Agent ${i}`) }));
  const policy = { version: "model-v1", model: "fixture", wrapper: "Answer.", maxOutputBytes: 8192, temperature: 0, maxCostMicros: 100000, maxCostPerCallMicros: 100 };
  const orchestrator = new TournamentOrchestrator({ run: (input: any) => inference.runPair({ ...input, policy }) }, new JudgeAdapter(tracker));
  const result = await orchestrator.run({ tournamentId: sha("partial-t"), seedDigest: sha("partial-seed"), entrants, topics: ["topic-a"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
  assert.equal(result.state, "RECOVERY_REQUIRED");
  assert.equal(provider.calls, 2);
  assert.equal(genlayer.submissions, 0);
});

test("valid semantic ties stop at retry cap and request refund", async () => {
  const provider = new Provider();
  const inference = new InferencePairRunner(provider, new MemoryInferenceStore());
  const genlayer = new GenLayer();
  genlayer.mutateResult = (result) => ({
    ...result,
    result: "TIE",
    score_a: 0,
    score_b: 0,
    criteria: result.criteria.map((criterion: any) => ({ ...criterion, winner: "TIE" })),
  });
  const tracker = new GenLayerTracker(genlayer, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111");
  const entrants = Array.from({ length: 8 }, (_, i) => ({ entrantId: sha(`tie-entrant-${i}`), agentId: sha(`tie-agent-${i}`), agentsVersion: sha(`tie-v-${i}`), agentsMd: `Tie Agent ${i}`, agentsCommitment: sha(`Tie Agent ${i}`) }));
  const policy = { version: "model-v1", model: "fixture", wrapper: "Answer.", maxOutputBytes: 8192, temperature: 0, maxCostMicros: 100000, maxCostPerCallMicros: 100 };
  const orchestrator = new TournamentOrchestrator({ run: (input: any) => inference.runPair({ ...input, policy }) }, new JudgeAdapter(tracker));
  const result = await orchestrator.run({ tournamentId: sha("tie-t"), seedDigest: sha("tie-seed"), entrants, topics: ["topic-a", "topic-b"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
  assert.deepEqual(result, { state: "REFUND_REQUIRED", reason: "RETRY_EXHAUSTED" });
  assert.equal(provider.calls, 4);
  assert.equal(genlayer.submissions, 2);
});

test("retry exhaustion opens one full refund, withdraws every stake, and closes at zero liability", async () => {
  const provider = new Provider();
  const inference = new InferencePairRunner(provider, new MemoryInferenceStore());
  const genlayer = new GenLayer();
  genlayer.mutateResult = (result) => ({
    ...result,
    result: "TIE",
    score_a: 0,
    score_b: 0,
    criteria: result.criteria.map((criterion: any) => ({ ...criterion, winner: "TIE" })),
  });
  const tracker = new GenLayerTracker(genlayer, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111");
  const entrants = Array.from({ length: 8 }, (_, i) => ({ entrantId: sha(`refund-entrant-${i}`), agentId: sha(`refund-agent-${i}`), agentsVersion: sha(`refund-v-${i}`), agentsMd: `Refund Agent ${i}`, agentsCommitment: sha(`Refund Agent ${i}`) }));
  const policy = { version: "model-v1", model: "fixture", wrapper: "Answer.", maxOutputBytes: 8192, temperature: 0, maxCostMicros: 100000, maxCostPerCallMicros: 100 };
  const orchestrator = new TournamentOrchestrator({ run: (input: any) => inference.runPair({ ...input, policy }) }, new JudgeAdapter(tracker));
  const result = await orchestrator.run({ tournamentId: sha("refund-t"), seedDigest: sha("refund-seed"), entrants, topics: ["topic-a"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
  assert.deepEqual(result, { state: "REFUND_REQUIRED", reason: "RETRY_EXHAUSTED" });

  const escrow = new EscrowLifecycleHarness(800000n, entrants.map((entrant) => entrant.entrantId));
  assert.equal(await escrow.cancelAndOpenRefunds("RETRY_EXHAUSTED"), await escrow.cancelAndOpenRefunds("RETRY_EXHAUSTED"));
  assert.equal(escrow.cancelCalls, 1);
  for (const entrant of entrants) {
    await escrow.claimRefund(entrant.entrantId);
    await escrow.withdrawCredit(entrant.entrantId);
    await assert.rejects(() => escrow.claimRefund(entrant.entrantId), /invalid refund claimant/);
    await assert.rejects(() => escrow.withdrawCredit(entrant.entrantId), /no credit/);
  }
  assert.equal(escrow.platformFee, 0n);
  assert.equal(escrow.totalLiability, 0n);
  await escrow.closeTournament();
  assert.equal(escrow.state, "CLOSED");
  assert.equal(escrow.settlementCalls, 0);
});

test("expired tournament uses the same refund path and cannot close with an unclaimed liability", async () => {
  const entrants = Array.from({ length: 8 }, (_, i) => sha(`expiry-entrant-${i}`));
  const result = await new TournamentOrchestrator({ run: async () => { throw new Error("inference must not run after expiry"); } }, new JudgeAdapter(new GenLayerTracker(new GenLayer(), new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111"))).run({
    tournamentId: sha("expiry-t"), seedDigest: sha("expiry-seed"), entrants: entrants.map((entrantId, i) => ({ entrantId, agentId: sha(`expiry-agent-${i}`), agentsVersion: sha(`expiry-v-${i}`), agentsMd: `Expiry Agent ${i}`, agentsCommitment: sha(`Expiry Agent ${i}`) })), topics: ["topic-a"], bracketRevision: 1, retryCap: 1, expiresAt: 100, now: () => 100,
  });
  assert.deepEqual(result, { state: "REFUND_REQUIRED", reason: "TOURNAMENT_EXPIRED" });
  const escrow = new EscrowLifecycleHarness(800000n, entrants);
  await escrow.cancelAndOpenRefunds("TOURNAMENT_EXPIRED");
  await assert.rejects(() => escrow.closeTournament(), /liability outstanding/);
  for (const entrant of entrants) { await escrow.claimRefund(entrant); await escrow.withdrawCredit(entrant); }
  await escrow.closeTournament();
  assert.equal(escrow.state, "CLOSED");
});

test("settlement withdrawals consume payout and owner fee credits before zero-liability close", async () => {
  const entrants = Array.from({ length: 8 }, (_, i) => sha(`close-entrant-${i}`));
  const ranking = entrants.slice(0, 5);
  const escrow = new EscrowLifecycleHarness(800000n, entrants);
  await escrow.sendSettlement({ tournamentId: bytes32("close-t"), rankedEntrants: ranking, rankingDigest: bytes32("close-ranking"), settlementNonce: "1" });
  assert.equal(escrow.platformFee, 80000n);
  assert.equal(escrow.totalLiability, 800000n);
  for (const entrant of ranking) await escrow.withdrawCredit(entrant);
  await escrow.withdrawPlatformFee();
  assert.equal(escrow.totalLiability, 0n);
  await escrow.closeTournament();
  assert.equal(escrow.state, "CLOSED");
});

test("completed lifecycle projects bounded public records that survive API restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-public-projection-"));
  const databasePath = join(directory, "runtime.sqlite");
  const operator = "0x9999999999999999999999999999999999999999";
  const tournamentId = sha("public-t");
  const seedDigest = sha("public-seed");
  const entrants = Array.from({ length: 8 }, (_, i) => ({ entrantId: sha(`public-entrant-${i}`), agentId: sha(`public-agent-${i}`), agentsVersion: sha(`public-v-${i}`), agentsMd: `Public Agent ${i}`, agentsCommitment: sha(`Public Agent ${i}`) }));
  const provider = new Provider();
  const genlayer = new GenLayer();
  const policy = { version: "model-v1", model: "fixture", wrapper: "Answer.", maxOutputBytes: 8192, temperature: 0, maxCostMicros: 100000, maxCostPerCallMicros: 100 };
  const orchestrator = new TournamentOrchestrator(
    { run: (input: any) => new InferencePairRunner(provider, new MemoryInferenceStore()).runPair({ ...input, policy }) },
    new JudgeAdapter(new GenLayerTracker(genlayer, new MemoryJudgeStore(), "0x1111111111111111111111111111111111111111")),
  );
  try {
    const result = await orchestrator.run({ tournamentId, seedDigest, entrants, topics: ["topic-a", "topic-b"], bracketRevision: 1, retryCap: 2, expiresAt: 1000, now: () => 100 });
    assert.equal(result.state, "RANKING_READY");
    const database = new SqliteRuntimeStore(databasePath);
    const api = new ArenaApiService(operator, database);
    api.publishTournament(operator, { id: tournamentId, name: "Persisted Lifecycle Arena", status: "COMPLETED", entrantIds: entrants.map((entrant) => entrant.entrantId), stakeAmount: "100000", prizePool: "800000" });
    const roundByMatch = new Map(buildBracket({ tournamentId, seedDigest, entrants: entrants.map((entrant) => entrant.entrantId), bracketRevision: 1 }).matches.map((match) => [match.matchId, match.roundNumber]));
    for (const [transactionHash, pair] of genlayer.pairs) {
      const raw = await genlayer.getResult("0x1111111111111111111111111111111111111111", pair.matchId, pair.attemptId) as any;
      const agentA = pair.outputA.split("\n", 1)[0];
      const agentB = pair.outputB.split("\n", 1)[0];
      const winner = raw.result === "A_WIN" ? agentA : raw.result === "B_WIN" ? agentB : undefined;
      api.publishMatch(operator, { id: pair.matchId, tournamentId, state: "FINALIZED", agentA, agentB, ...(winner ? { winner } : {}), round: roundByMatch.get(pair.matchId)! });
      api.publishVerdict(operator, { id: sha(`public-verdict|${pair.matchId}|${pair.attemptId}`), matchId: pair.matchId, winner: raw.result === "A_WIN" ? "A" : raw.result === "B_WIN" ? "B" : "TIE", reasons: raw.criteria.map((criterion: any) => criterion.reason), summary: raw.summary, transactionHash });
    }
    const publishedCount = genlayer.pairs.size;
    assert.ok(publishedCount > 0);
    database.close();

    const restartedDatabase = new SqliteRuntimeStore(databasePath);
    const restartedApi = new ArenaHttpApi(new ArenaApiService(operator, restartedDatabase), async () => false);
    const tournaments = await restartedApi.handle({ method: "GET", path: "/api/tournaments" });
    const matches = await restartedApi.handle({ method: "GET", path: `/api/tournaments/${tournamentId}/matches` });
    const firstMatch = matches.body[0];
    const verdict = await restartedApi.handle({ method: "GET", path: `/api/matches/${firstMatch.id}/verdict` });
    assert.equal(tournaments.body[0].status, "COMPLETED");
    assert.equal(matches.body.length, publishedCount);
    assert.equal(firstMatch.state, "FINALIZED");
    assert.equal(verdict.body.winner, "A");
    assert.equal(verdict.body.reasons.length, 5);
    const publicJson = JSON.stringify({ tournaments: tournaments.body, matches: matches.body, verdict: verdict.body });
    assert.equal(publicJson.includes("agentsMd"), false);
    assert.equal(publicJson.includes("outputA"), false);
    assert.equal(publicJson.includes("topic-a"), false);
    restartedDatabase.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
