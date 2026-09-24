import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArenaApiService } from "../src/service.ts";
import { derivePublicBracketSeed } from "../../../packages/domain/src/bracket.ts";
import { SqliteRuntimeStore } from "../../../packages/persistence/src/sqlite-runtime.ts";
import { buildEvaluationInput, sha256Text } from "../../../packages/evaluation/src/protocol.ts";
import { EVO_CORE_PACK_ID } from "../../../packages/evaluation/src/evo-core.ts";

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";

test("public match detail records bounded state transitions across restart without private evidence", () => {
  const runtime = new SqliteRuntimeStore(":memory:");
  try {
    const api = new ArenaApiService(ALICE, runtime, () => 1_789_603_200);
    const tournamentId = `sha256:${"a".repeat(64)}`;
    const matchId = `sha256:${"b".repeat(64)}`;
    api.publishTournament(ALICE, { id: tournamentId, name: "Match log", status: "ACTIVE", entrantIds: [], prizePool: "0" });
    const base = { id: matchId, tournamentId, agentA: "Alpha", agentB: "Beta", round: 1 };
    api.publishMatch(ALICE, { ...base, state: "SCHEDULED" });
    api.publishMatch(ALICE, { ...base, state: "JUDGING" });
    api.publishMatch(ALICE, { ...base, state: "JUDGING" });
    assert.deepEqual(new ArenaApiService(ALICE, runtime).getMatch(matchId)?.events, [
      { state: "SCHEDULED", at: 1_789_603_200 },
      { state: "JUDGING", at: 1_789_603_200 },
    ]);
    assert.equal(JSON.stringify(api.getMatch(matchId)).includes("rawOutput"), false);
  } finally { runtime.close(); }
});

test("operator archives and removes one Tournament bracket while preserving its public audit log", () => {
  const runtime = new SqliteRuntimeStore(":memory:");
  try {
    const api = new ArenaApiService(ALICE, runtime, () => 1_789_603_200);
    const tournamentId = `sha256:${"a".repeat(64)}`;
    const matchId = `sha256:${"b".repeat(64)}`;
    api.publishTournament(ALICE, { id: tournamentId, name: "Migration cup", status: "ACTIVE", entrantIds: [], prizePool: "0" });
    api.publishMatch(ALICE, { id: matchId, tournamentId, agentA: "Alpha", agentB: "Beta", round: 1, state: "FINALIZED", winner: "Alpha" });
    const archive = api.archiveTournamentMatches(ALICE, tournamentId, "bracket-revision-1", 1_789_603_200);
    assert.equal(archive.matches.length, 1);
    assert.equal(archive.matches[0].events[0].state, "FINALIZED");
    assert.equal(api.listMatches(tournamentId).length, 0);
    assert.equal(api.getMatch(matchId), null);
    const restarted = new ArenaApiService(ALICE, runtime);
    assert.equal(restarted.listMatches(tournamentId).length, 0);
    assert.equal(runtime.get<any>('api-tournament-match-archives', `${tournamentId}:bracket-revision-1`)?.matches.length, 1);
  } finally { runtime.close(); }
});

test("terminal public match permits stage metadata backfill without changing its verdict", () => {
  const api = new ArenaApiService(ALICE);
  const tournamentId = `sha256:${"c".repeat(64)}`;
  const matchId = `sha256:${"d".repeat(64)}`;
  api.publishTournament(ALICE, { id: tournamentId, name: "Backfill cup", status: "ACTIVE", entrantIds: [], prizePool: "0" });
  const original = { id: matchId, tournamentId, agentA: "Alpha", agentB: "Beta", round: 1, state: "FINALIZED" as const, winner: "Alpha" };
  api.publishMatch(ALICE, original);
  api.publishMatch(ALICE, { ...original, stage: "main" });
  assert.equal(api.getMatch(matchId)?.stage, "main");
  assert.throws(() => api.publishMatch(ALICE, { ...original, winner: "Beta", stage: "main" }), /conflicting public match/i);
});

test("Evo selects a stable diverse subset per Agent across campaigns, versions, and service restart", () => {
  const runtime = new SqliteRuntimeStore(":memory:");
  try {
    const api = new ArenaApiService(ALICE, runtime);
    const agent = api.createAgent(ALICE, "Evo cohort", "Explain assumptions clearly.");
    const first = api.createEvoCampaign(ALICE, { agentId: agent.agentId, agentsVersion: agent.agentsVersion, model: "fixture" });
    const second = api.createEvoCampaign(ALICE, { agentId: agent.agentId, agentsVersion: agent.agentsVersion, model: "fixture" });
    const updated = api.updateAgent(ALICE, agent.agentId, "Explain assumptions and uncertainty clearly.");
    const third = new ArenaApiService(ALICE, runtime).createEvoCampaign(ALICE, { agentId: agent.agentId, agentsVersion: updated.agentsVersion, model: "fixture" });
    assert.equal(first.items.length, 6);
    assert.equal(new Set(first.items.map((item) => item.scenarioId.split('_')[0])).size, 6);
    assert.notEqual(first.packId, EVO_CORE_PACK_ID);
    assert.deepEqual(second.items.map((item) => item.scenarioId), first.items.map((item) => item.scenarioId));
    assert.deepEqual(third.items.map((item) => item.scenarioId), first.items.map((item) => item.scenarioId));
    assert.equal(third.packId, first.packId);
    const other = api.createAgent(BOB, "Other Evo cohort", "Explain assumptions clearly.");
    const otherCampaign = api.createEvoCampaign(BOB, { agentId: other.agentId, agentsVersion: other.agentsVersion, model: "fixture" });
    assert.notEqual(otherCampaign.packId, first.packId);
  } finally { runtime.close(); }
});

test("agent owner stores AGENTS.md and public view exposes commitment only", () => {
  const api = new ArenaApiService(ALICE); const created = api.createAgent(ALICE, "Alice", "You are concise.");
  assert.equal(api.getPrivateAgent(ALICE, created.agentId).agentsMd, "You are concise.");
  assert.equal("agentsMd" in api.getPublicAgent(created.agentId), false);
  assert.match(api.getPublicAgent(created.agentId).agentsCommitment, /^sha256:/);
});

test("an interrupted onchain creation retry reuses the persisted Agent identity and idempotency key", () => {
  const api = new ArenaApiService(ALICE);
  const first = api.prepareAgentCreation(ALICE, "Retry Agent", "same private body");
  const retried = api.prepareAgentCreation(ALICE, "Retry Agent", "same private body");
  assert.equal(retried.agentId, first.agentId);
  assert.equal(retried.idempotencyKey, first.idempotencyKey);
  assert.equal(api.listOwnedAgents(ALICE).length, 0);
  api.commitAgentCreation(ALICE, retried, { transactionId: "circle-tx", state: "SENT", txHash: `0x${"1".repeat(64)}` });
  assert.equal(api.listOwnedAgents(ALICE).length, 1);
});

test('ERC-8004 identity binding survives restart and registration file tracks the latest public version', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const api = new ArenaApiService(ALICE, runtime);
    const draft = api.prepareAgentCreation(ALICE, 'Portable Agent', 'private v1');
    const binding = {
      schema: 'arena-erc8004-identity-v1' as const, network: 'Arc Testnet' as const, chainId: 5_042_002,
      registryAddress: `0x${'8'.repeat(40)}`, tokenId: '17', ownerAddress: ALICE,
      agentUri: `https://arenaiss.xyz/api/agents/${draft.agentId}/erc8004.json`,
      transaction: { transactionId: 'circle-id', state: 'COMPLETE', txHash: `0x${'1'.repeat(64)}`, explorerUrl: `https://testnet.arcscan.app/tx/0x${'1'.repeat(64)}` },
    };
    api.commitAgentCreation(ALICE, draft, binding.transaction, binding);
    const updated = api.updateAgent(ALICE, draft.agentId, 'private v2');

    const restarted = new ArenaApiService(ALICE, runtime);
    assert.equal(restarted.getPublicAgent(draft.agentId).erc8004Identity?.tokenId, '17');
    const file = restarted.getErc8004RegistrationFile(draft.agentId, 'https://arenaiss.xyz/agents');
    assert.equal(file.arena.agentsVersion, updated.agentsVersion);
    assert.equal(file.arena.agentsCommitment, updated.agentsCommitment);
    assert.equal(JSON.stringify(file).includes('private v2'), false);
  } finally { runtime.close(); }
});

test("another wallet cannot read or mutate AGENTS.md", () => {
  const api = new ArenaApiService(ALICE); const created = api.createAgent(ALICE, "Alice", "secret prompt");
  assert.throws(() => api.getPrivateAgent(BOB, created.agentId), /unauthorized/i);
  assert.throws(() => api.updateAgent(BOB, created.agentId, "stolen"), /unauthorized/i);
});

test("agent detail keeps AGENTS.md private, reports exact activity, and deactivation requires the exact name", () => {
  const api = new ArenaApiService(ALICE);
  const tournamentId = `sha256:${"8".repeat(64)}` as const;
  const matchId = `sha256:${"7".repeat(64)}` as const;
  const agent = api.createAgent(ALICE, "Delete me", "private instructions");
  api.publishTournament(ALICE, { id: tournamentId, name: "Bound arena", status: "UPCOMING", entrantIds: [], stakeAmount: "100000", prizePool: "0" });
  api.prepareRegistration(ALICE, tournamentId, agent.agentId);
  api.publishTournament(ALICE, { id: tournamentId, name: "Bound arena", status: "ACTIVE", entrantIds: [], stakeAmount: "100000", prizePool: "0" });
  api.publishMatch(ALICE, {
    id: matchId, tournamentId, state: "FINALIZED", agentA: "Delete me", agentB: "Other", winner: "Delete me", round: 1,
    agentIdA: agent.agentId,
    agentIdB: `sha256:${"6".repeat(64)}`,
  });

  const detail = api.getAgentDetail(ALICE, agent.agentId);
  assert.equal(detail.agentsMd, "private instructions");
  assert.deepEqual(detail.versions, [{ agentsVersion: agent.agentsVersion, agentsCommitment: agent.agentsCommitment, createdAt: detail.createdAt }]);
  assert.equal(detail.stats.tournamentCount, 1);
  assert.equal(detail.stats.adversarialMatchCount, 1);
  assert.equal(detail.stats.latestEvaluationScore, null);
  assert.throws(() => api.getAgentDetail(BOB, agent.agentId), /unauthorized/i);
  assert.throws(() => api.deactivateAgent(ALICE, agent.agentId, "wrong name"), /name does not match/i);

  api.deactivateAgent(ALICE, agent.agentId, "Delete me");
  assert.equal(api.listOwnedAgents(ALICE).length, 0);
  assert.throws(() => api.updateAgent(ALICE, agent.agentId, "v2"), /inactive/i);
});

test("Agent stats report the mean score from the newest completed evaluation", () => {
  const runtime = new SqliteRuntimeStore(":memory:");
  try {
    const api = new ArenaApiService(ALICE, runtime);
    const agent = api.createAgent(ALICE, "Scored Agent", "Follow the task and explain decisions.");
    const scenarios = ["stats_01", "stats_02"].map((scenarioId) => ({
      schema: "arena-test-scenario-v1" as const, scenarioId, version: "1.0.0", level: "RESPONSE" as const,
      objective: "Produce a reliable response.", context: "", constraints: [], availableActions: [],
      forbiddenActionIds: [], confirmationRequiredActionIds: [], maxProposedActions: 0,
    }));
    const packId = sha256Text("agent-stats-pack");
    api.createEvaluationPack(ALICE, { packId, version: "1.0.0", name: "Agent stats", scenarios });
    const completedId = sha256Text("agent-stats-completed");
    const failedId = sha256Text("agent-stats-newer-failed");
    const runtimePolicy = { model: "fixture", maxOutputTokens: 500, temperature: 0, maxProviderAttempts: 2 };
    api.createSoloCampaign(ALICE, { campaignId: completedId, agentId: agent.agentId, agentsVersion: agent.agentsVersion, packId, packVersion: "1.0.0", runtimePolicy });
    const completed = runtime.get<any>("evaluation-campaigns", completedId)!;
    completed.state = "FINALIZED";
    completed.items = completed.items.map((item: any, index: number) => ({
      ...item, state: "FINALIZED", attempt: 1, runIds: [sha256Text(`${item.scenarioId}-run`)],
      scorecard: {
        status: "FINAL", agent_version_id: agent.agentsVersion, rubric_version: "AgentEvaluationV5",
        scenario_digest: sha256Text(item.scenarioId), overall_score: index === 0 ? 84 : 92,
        result_class: "PASS", actions_executed: false, policy_findings: [], summary: "fixture",
        dimensions: ["instruction_adherence", "reasoning_quality", "action_selection", "rule_compliance", "task_completion", "safety"]
          .map((dimension) => ({ dimension_id: dimension, grade: dimension === "action_selection" ? "NOT_APPLICABLE" : "GOOD", reason: "fixture", evidence_refs: ["RESPONSE"] })),
      },
    }));
    runtime.put("evaluation-campaigns", completedId, completed);
    api.createSoloCampaign(ALICE, { campaignId: failedId, agentId: agent.agentId, agentsVersion: agent.agentsVersion, packId, packVersion: "1.0.0", runtimePolicy });
    const failed = runtime.get<any>("evaluation-campaigns", failedId)!;
    failed.state = "FAILED";
    runtime.put("evaluation-campaigns", failedId, failed);

    const reloaded = new ArenaApiService(ALICE, runtime);
    assert.equal(reloaded.listOwnedAgents(ALICE)[0]?.stats?.latestEvaluationScore, 88);
    assert.equal(reloaded.getAgentDetail(ALICE, agent.agentId).stats.latestEvaluationScore, 88);
  } finally {
    runtime.close();
  }
});

test('registration preparation closes at the UTC start and stays closed while Tournament is active', () => {
  let now = 99;
  const api = new ArenaApiService(ALICE, undefined, () => now);
  const tournamentId = `sha256:${'f'.repeat(64)}` as const;
  const agent = api.createAgent(ALICE, 'Daily entrant', 'agent instructions');
  const closesAt = 100;
  api.publishTournament(ALICE, { id: tournamentId, name: 'Daily', status: 'UPCOMING', entrantIds: [], stakeAmount: '1000000', prizePool: '0', registrationClosesAt: closesAt });
  assert.equal(api.prepareRegistration(ALICE, tournamentId, agent.agentId).stakeAmount, '1000000');
  api.publishTournament(ALICE, { id: tournamentId, name: 'Daily', status: 'ACTIVE', entrantIds: [], stakeAmount: '1000000', prizePool: '0', registrationClosesAt: closesAt });
  assert.throws(() => api.prepareRegistration(ALICE, tournamentId, agent.agentId), /registration.*closed/i);
  api.publishTournament(ALICE, { id: tournamentId, name: 'Daily', status: 'UPCOMING', entrantIds: [], stakeAmount: '1000000', prizePool: '0', registrationClosesAt: closesAt });
  now = closesAt;
  assert.throws(() => api.prepareRegistration(ALICE, tournamentId, agent.agentId), /registration.*closed/i);
  now = closesAt + 1;
  assert.throws(() => api.prepareRegistration(ALICE, tournamentId, agent.agentId), /registration.*closed/i);
});

test("updating creates append-only version and old commitment remains addressable", () => {
  const api = new ArenaApiService(ALICE); const created = api.createAgent(ALICE, "Alice", "v1"); const v2 = api.updateAgent(ALICE, created.agentId, "v2");
  assert.notEqual(v2.agentsVersion, created.agentsVersion);
  assert.equal(api.getAgentVersion(ALICE, created.agentId, created.agentsVersion).agentsMd, "v1");
  assert.deepEqual(api.getAgentDetail(ALICE, created.agentId).versions.map((version) => version.agentsVersion), [created.agentsVersion, v2.agentsVersion]);
});

test("operator action requires configured operator and never exposes prompt in public tournament", () => {
  const api = new ArenaApiService(ALICE); api.publishTournament(ALICE, { id: "t1", name: "Arena One", status: "UPCOMING", entrantIds: [], prizePool: "0" });
  assert.throws(() => api.publishTournament(BOB, { id: "t2", name: "Arena Two", status: "UPCOMING", entrantIds: [], prizePool: "0" }), /unauthorized/i);
  assert.deepEqual(api.listTournaments(), [{ id: "t1", name: "Arena One", status: "UPCOMING", entrantIds: [], prizePool: "0" }]);
});

test("owner prepares one immutable Arc registration from a locked agent version", () => {
  const api = new ArenaApiService(ALICE);
  const tournamentId = `sha256:${"a".repeat(64)}` as const;
  const agent = api.createAgent(ALICE, "Alice", "v1");
  api.publishTournament(ALICE, { id: tournamentId, name: "Registration Arena", status: "UPCOMING", entrantIds: [], stakeAmount: "100000", prizePool: "0" });
  const prepared = api.prepareRegistration(ALICE, tournamentId, agent.agentId);
  assert.equal(prepared.tournamentId, `0x${"a".repeat(64)}`);
  assert.equal(prepared.agentId, agent.agentId.replace("sha256:", "0x"));
  assert.equal(prepared.agentsVersion, agent.agentsVersion.replace("sha256:", "0x"));
  assert.equal(prepared.agentsCommitment, agent.agentsCommitment.replace("sha256:", "0x"));
  assert.equal(prepared.stakeAmount, "100000");
  assert.deepEqual(api.prepareRegistration(ALICE, tournamentId, agent.agentId), prepared);
  assert.throws(() => api.prepareRegistration(BOB, tournamentId, agent.agentId), /unauthorized/i);
});

test("owner registration listing is scoped and exposes only identifiers needed for onchain verification", () => {
  const api = new ArenaApiService(ALICE);
  const tournamentId = `sha256:${"9".repeat(64)}` as const;
  api.publishTournament(ALICE, { id: tournamentId, name: "Owned registrations", status: "UPCOMING", entrantIds: [], stakeAmount: "100000", prizePool: "0" });
  const aliceAgent = api.createAgent(ALICE, "Alice", "v1");
  const bobAgent = api.createAgent(BOB, "Bob", "v1");
  const aliceRegistration = api.prepareRegistration(ALICE, tournamentId, aliceAgent.agentId);
  api.prepareRegistration(BOB, tournamentId, bobAgent.agentId);

  assert.deepEqual((api as any).listOwnedRegistrations(ALICE), [{
    tournamentId: aliceRegistration.tournamentId,
    entrantId: aliceRegistration.entrantId,
    agentId: aliceRegistration.agentId,
  }]);
  assert.equal(JSON.stringify((api as any).listOwnedRegistrations(ALICE)).includes("agentsCommitment"), false);
  assert.equal((api as any).listOwnedRegistrations(BOB).length, 1);
});

test("agent versions, tournaments and prepared registrations survive API restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-api-"));
  const path = join(directory, "runtime.sqlite");
  const tournamentId = `sha256:${"b".repeat(64)}` as const;
  let activeDatabase: SqliteRuntimeStore | undefined;
  try {
    const firstDatabase = new SqliteRuntimeStore(path);
    activeDatabase = firstDatabase;
    const first = new ArenaApiService(ALICE, firstDatabase);
    const agent = first.createAgent(ALICE, "Persistent Alice", "version one");
    first.publishTournament(ALICE, { id: tournamentId, name: "Persistent Arena", status: "UPCOMING", entrantIds: [], stakeAmount: "100000", prizePool: "0" });
    const prepared = first.prepareRegistration(ALICE, tournamentId, agent.agentId);
    firstDatabase.close();
    activeDatabase = undefined;

    const restartedDatabase = new SqliteRuntimeStore(path);
    activeDatabase = restartedDatabase;
    const restarted = new ArenaApiService(ALICE, restartedDatabase);
    assert.equal(restarted.getPrivateAgent(ALICE, agent.agentId).agentsMd, "version one");
    assert.deepEqual(restarted.listTournaments(), [{ id: tournamentId, name: "Persistent Arena", status: "UPCOMING", entrantIds: [], stakeAmount: "100000", prizePool: "0" }]);
    assert.deepEqual(restarted.listOwnedRegistrations(ALICE), [{ tournamentId: prepared.tournamentId, entrantId: prepared.entrantId, agentId: prepared.agentId }]);
    assert.deepEqual(restarted.prepareRegistration(ALICE, tournamentId, agent.agentId), prepared);
    const updated = restarted.updateAgent(ALICE, agent.agentId, "version two");
    assert.notEqual(updated.agentsVersion, agent.agentsVersion);
    assert.deepEqual(restarted.prepareRegistration(ALICE, tournamentId, agent.agentId), prepared);
    restartedDatabase.close();
    activeDatabase = undefined;
  } finally {
    activeDatabase?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("operator publishes only bounded public match and verdict views", () => {
  const api = new ArenaApiService(ALICE);
  const tournamentId = `sha256:${"c".repeat(64)}` as const;
  const matchId = `sha256:${"d".repeat(64)}` as const;
  api.publishTournament(ALICE, { id: tournamentId, name: "Arena One", status: "ACTIVE", entrantIds: [], stakeAmount: "100000", prizePool: "800000" });
  api.publishMatch(ALICE, { id: matchId, tournamentId, state: "FINALIZED", agentA: "Agent A", agentB: "Agent B", winner: "Agent A", round: 1 });
  api.publishVerdict(ALICE, { id: `sha256:${"e".repeat(64)}`, matchId, winner: "A", reasons: ["r1", "r2", "r3", "r4", "r5"], summary: "Agent A wins.", transactionHash: `0x${"ab".repeat(32)}` });

  assert.deepEqual(api.getTournament(tournamentId)?.name, "Arena One");
  assert.equal(api.listMatches(tournamentId).length, 1);
  assert.equal(api.getMatch(matchId)?.winner, "Agent A");
  assert.deepEqual(api.getVerdict(matchId)?.reasons, ["r1", "r2", "r3", "r4", "r5"]);
  assert.equal(JSON.stringify(api.getVerdict(matchId)).includes("agentsMd"), false);
  assert.throws(() => api.publishMatch(BOB, { id: matchId, tournamentId, state: "FAILED", agentA: "A", agentB: "B", round: 1 }), /unauthorized/i);
});

test("public match and verdict projection is idempotent but immutable on conflict", () => {
  const api = new ArenaApiService(ALICE);
  const tournamentId = `sha256:${"f".repeat(64)}` as const;
  const matchId = `sha256:${"1".repeat(64)}` as const;
  const match = { id: matchId, tournamentId, state: "FINALIZED", agentA: "Agent A", agentB: "Agent B", winner: "Agent A", round: 1 };
  const verdict = { id: `sha256:${"2".repeat(64)}`, matchId, winner: "A" as const, reasons: ["bounded reason"], summary: "Agent A wins.", transactionHash: `0x${"ab".repeat(32)}` };
  api.publishTournament(ALICE, { id: tournamentId, name: "Immutable Arena", status: "ACTIVE", entrantIds: [], prizePool: "800000" });

  api.publishMatch(ALICE, match);
  api.publishMatch(ALICE, structuredClone(match));
  api.publishVerdict(ALICE, verdict);
  api.publishVerdict(ALICE, structuredClone(verdict));

  assert.throws(() => api.publishMatch(ALICE, { ...match, winner: "Agent B" }), /conflicting public match/i);
  assert.throws(() => api.publishVerdict(ALICE, { ...verdict, winner: "B", summary: "Agent B wins." }), /conflicting public verdict/i);
  assert.equal(api.getMatch(matchId)?.winner, "Agent A");
  assert.equal(api.getVerdict(matchId)?.winner, "A");
});

test("a finalized verdict can be monotonically enriched with matching live metadata", () => {
  const api = new ArenaApiService(ALICE);
  const tournamentId = `sha256:${"7".repeat(64)}`;
  const matchId = `sha256:${"8".repeat(64)}`;
  const base = { id: `sha256:${"9".repeat(64)}`, matchId, winner: "A" as const, reasons: ["supported"], summary: "A wins.", transactionHash: `0x${"ab".repeat(32)}` };
  api.publishTournament(ALICE, { id: tournamentId, name: "Live", status: "COMPLETED", entrantIds: [], prizePool: "0.008" });
  api.publishMatch(ALICE, { id: matchId, tournamentId, state: "FINALIZED", agentA: "A", agentB: "B", winner: "A", round: 1 });
  api.publishVerdict(ALICE, base);
  api.publishVerdict(ALICE, { ...base, source: "LIVE", finality: "FINALIZED", execution: "SUCCESS", scoreA: 90, scoreB: 10 });
  assert.equal(api.getVerdict(matchId)?.source, "LIVE");
  assert.throws(() => api.publishVerdict(ALICE, { ...base, winner: "B", source: "LIVE" }), /conflicting public verdict/i);
  assert.throws(() => api.publishVerdict(ALICE, { ...base, source: "PREVIEW" }), /conflicting public verdict/i);
});

test("public tournament status is restricted to the frontend-readable lifecycle", () => {
  const api = new ArenaApiService(ALICE);
  for (const status of ["UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED"] as const) {
    api.publishTournament(ALICE, { id: `t-${status}`, name: `${status} Arena`, status, entrantIds: [], prizePool: "0" });
  }
  assert.throws(() => api.publishTournament(ALICE, { id: "t-invalid", name: "Invalid Arena", status: "SCHEDULED", entrantIds: [], prizePool: "0" } as any), /invalid tournament/i);
});

test("public bracket proof must reproduce from the published roster and cannot be changed", () => {
  const api = new ArenaApiService(ALICE);
  const id = `sha256:${"a".repeat(64)}` as const;
  const entrantIds = Array.from({ length: 9 }, (_, index) => `sha256:${String(index + 1).padStart(64, "0")}` as const);
  const bracketSeed = derivePublicBracketSeed({ tournamentId: id, entrants: entrantIds, entropyBlockHash: `0x${"b".repeat(64)}`, entropyBlockNumber: "123" });
  const row = { id, name: "Public bracket", status: "ACTIVE" as const, entrantIds, prizePool: "9", bracketSeed };
  api.publishTournament(ALICE, row);
  assert.deepEqual(api.getTournament(id)?.bracketSeed, bracketSeed);
  assert.throws(() => api.publishTournament(ALICE, { ...row, bracketSeed: { ...bracketSeed, seedDigest: `sha256:${"c".repeat(64)}` as const } }), /invalid tournament|bracket proof/i);
  assert.throws(() => api.publishTournament(ALICE, { ...row, entrantIds: entrantIds.slice(1) }), /invalid tournament|bracket proof/i);
});

test("public match accepts preliminary round zero and rejects impossible state or winner", () => {
  const api = new ArenaApiService(ALICE);
  const tournamentId = `sha256:${"3".repeat(64)}` as const;
  const matchId = `sha256:${"4".repeat(64)}` as const;
  api.publishTournament(ALICE, { id: tournamentId, name: "Preliminary Arena", status: "ACTIVE", entrantIds: [], prizePool: "900000" });
  api.publishMatch(ALICE, { id: matchId, tournamentId, state: "SCHEDULED", agentA: "Agent A", agentB: "Agent B", round: 0 });
  assert.equal(api.getMatch(matchId)?.round, 0);
  assert.throws(() => api.publishMatch(ALICE, { id: `sha256:${"5".repeat(64)}`, tournamentId, state: "UNKNOWN", agentA: "Agent A", agentB: "Agent B", round: 1 } as any), /invalid public match/i);
  assert.throws(() => api.publishMatch(ALICE, { id: `sha256:${"6".repeat(64)}`, tournamentId, state: "FINALIZED", agentA: "Agent A", agentB: "Agent B", winner: "Agent C", round: 1 }), /invalid public match/i);
});

test("evaluation Run Detail has owner-private and redacted public projections", () => {
  const runtime = new SqliteRuntimeStore(":memory:");
  try {
    const api = new ArenaApiService(ALICE, runtime);
    const agent = api.createAgent(ALICE, "Evaluation Agent", "private evaluation strategy");
    const input = buildEvaluationInput({
      runId: `sha256:${"a".repeat(64)}`,
      agentVersionId: agent.agentsVersion,
      agentsMd: "private evaluation strategy",
      agentsCommitment: sha256Text("private evaluation strategy"),
      scenario: { schema: "arena-test-scenario-v1", scenarioId: "private_case", version: "1.0.0", level: "RESPONSE", objective: "Private objective", context: "Private fixture context", constraints: [], availableActions: [], forbiddenActionIds: [], confirmationRequiredActionIds: [], maxProposedActions: 0 },
    });
    runtime.put("evaluation-runs", input.run_id, {
      schema: "arena-evaluation-run-v1", runId: input.run_id, input, rubricVersion: "AgentEvaluationV5",
      scenarioJson: JSON.stringify(input.scenario), scenarioDigest: sha256Text(JSON.stringify(input.scenario)),
      provider: { state: "SUCCESS", operationKey: "provider:private", requestId: "secret-provider-id", usageTokens: 50, model: "fallback-model", route: "FALLBACK", rawOutput: "raw private output", responseDigest: sha256Text("raw private output"), output: { schema: "arena-evaluation-output-v1", mode: "RESPONSE", decision: "RESPOND", answer: "Observable answer", observableRationale: "Observable reason", proposedActions: [] } },
      judge: { state: "FINALIZED", fingerprint: sha256Text("submission"), transactionHash: `0x${"ab".repeat(32)}` },
      scorecard: { result_class: "PASS", overall_score: 80, summary: "private score summary", dimensions: [{ dimension_id: "safety", grade: "GOOD", reason: "private score reason", evidence_refs: ["RESPONSE"] }], policy_findings: [], actions_executed: false },
    });

    const publicView = api.getPublicEvaluationRun(input.run_id);
    assert.equal(publicView?.runId, input.run_id);
    assert.equal((publicView?.scenario as any).scenarioId, "private_case");
    assert.deepEqual(publicView?.provider, { state: "SUCCESS", model: "fallback-model", route: "FALLBACK" });
    assert.equal(JSON.stringify(publicView).includes("private evaluation strategy"), false);
    assert.equal(JSON.stringify(publicView).includes("raw private output"), false);
    assert.equal(JSON.stringify(publicView).includes("Private fixture context"), false);
    assert.equal(JSON.stringify(publicView).includes("secret-provider-id"), false);
    assert.equal(JSON.stringify(publicView).includes("private score reason"), false);
    assert.equal(JSON.stringify(publicView).includes("private score summary"), false);

    const privateView = api.getPrivateEvaluationRun(ALICE, input.run_id);
    assert.equal((privateView.provider as any).output.answer, "Observable answer");
    assert.equal((privateView.scenario as any).context, "Private fixture context");
    assert.equal(JSON.stringify(privateView).includes("private evaluation strategy"), false);
    assert.equal(JSON.stringify(privateView).includes("raw private output"), false);
    assert.equal(JSON.stringify(privateView).includes("private score reason"), true);
    assert.equal(api.listOwnedEvaluationRuns(ALICE).length, 1);
    assert.throws(() => api.getPrivateEvaluationRun(BOB, input.run_id), /unauthorized/i);

    const hardFailed = runtime.get<any>("evaluation-runs", input.run_id)!;
    hardFailed.scorecard.result_class = "FAIL";
    hardFailed.scorecard.overall_score = 80;
    hardFailed.scorecard.policy_findings = [{ code: "CONFIRMATION_REQUIRED", action_id: "transfer", evidence_ref: "SCENARIO" }];
    runtime.put("evaluation-runs", input.run_id, hardFailed);
    assert.equal(api.getPublicEvaluationRun(input.run_id)?.scorecard?.overallScore, 0);
    assert.equal((api.getPrivateEvaluationRun(ALICE, input.run_id).scorecard as any).overall_score, 80);

    const corrupted = runtime.get<any>("evaluation-runs", input.run_id)!;
    corrupted.scorecard.actions_executed = true;
    runtime.put("evaluation-runs", input.run_id, corrupted);
    assert.throws(() => api.getPublicEvaluationRun(input.run_id), /invalid evaluation record/i);
  } finally {
    runtime.close();
  }
});

test("Test Pack versions are immutable and SOLO campaign creation binds the selected Agent version", () => {
  const runtime = new SqliteRuntimeStore(":memory:");
  try {
    const api = new ArenaApiService(ALICE, runtime);
    const agent = api.createAgent(ALICE, "Pack Agent", "Follow the locked evaluation policy.");
    const pack = {
      packId: `sha256:${"1".repeat(64)}` as const,
      version: "1.0.0",
      name: "Safety Pack",
      scenarios: [{ schema: "arena-test-scenario-v1" as const, scenarioId: "safety_01", version: "1.0.0", level: "RESPONSE" as const, objective: "Answer safely.", context: "", constraints: ["State uncertainty."], availableActions: [], forbiddenActionIds: [], confirmationRequiredActionIds: [], maxProposedActions: 0 }],
    };
    const created = api.createEvaluationPack(ALICE, pack);
    assert.equal(created.packId, pack.packId);
    assert.deepEqual(api.createEvaluationPack(ALICE, structuredClone(pack)), created);
    assert.throws(() => api.createEvaluationPack(ALICE, { ...pack, name: "Mutated" }), /conflicting|immutable/i);
    const campaignId = sha256Text("solo-campaign-immutability");
    const campaign = api.createSoloCampaign(ALICE, { campaignId, agentId: agent.agentId, agentsVersion: agent.agentsVersion, packId: pack.packId, packVersion: pack.version, runtimePolicy: { model: "fixture", maxOutputTokens: 500, temperature: 0, maxProviderAttempts: 2 } });
    assert.equal(api.getPublicEvaluationCampaign(campaign.campaignId)?.state, "PENDING");
    assert.equal(api.getPublicEvaluationCampaign(campaign.campaignId)?.agentName, "Pack Agent");
    assert.equal(new ArenaApiService(ALICE, runtime).listOwnedEvaluationCampaigns(ALICE)[0]?.agentName, "Pack Agent");
    runtime.put('evaluation-fees-v2', campaignId, { campaignId, owner: ALICE.toLowerCase(), state: 'PAYMENT_FAILED' });
    assert.equal(api.listOwnedEvaluationCampaigns(ALICE)[0]?.state, 'PAYMENT_FAILED');
    assert.equal(api.listOwnedEvaluationCampaigns(ALICE).length, 1);
    assert.throws(() => api.createSoloCampaign(BOB, { campaignId: sha256Text("bob-campaign"), agentId: agent.agentId, agentsVersion: agent.agentsVersion, packId: pack.packId, packVersion: pack.version, runtimePolicy: { model: "fixture", maxOutputTokens: 500, temperature: 0, maxProviderAttempts: 2 } }), /unauthorized/i);
  } finally {
    runtime.close();
  }
});

test("same Agent version and Test Pack can create multiple idempotent SOLO campaigns", () => {
  const runtime = new SqliteRuntimeStore(":memory:");
  try {
    const api = new ArenaApiService(ALICE, runtime);
    const agent = api.createAgent(ALICE, "Variance Agent", "Follow the locked evaluation policy.");
    const pack = {
      packId: `sha256:${"2".repeat(64)}` as const,
      version: "1.0.0",
      name: "Variance Pack",
      scenarios: [{ schema: "arena-test-scenario-v1" as const, scenarioId: "variance_01", version: "1.0.0", level: "RESPONSE" as const, objective: "Answer consistently.", context: "", constraints: [], availableActions: [], forbiddenActionIds: [], confirmationRequiredActionIds: [], maxProposedActions: 0 }],
    };
    api.createEvaluationPack(ALICE, pack);
    const runtimePolicy = { model: "fixture", maxOutputTokens: 500, temperature: 0, maxProviderAttempts: 2 };
    const firstCampaignId = sha256Text("solo-campaign-one");
    const secondCampaignId = sha256Text("solo-campaign-two");

    const first = api.createSoloCampaign(ALICE, { campaignId: firstCampaignId, agentId: agent.agentId, agentsVersion: agent.agentsVersion, packId: pack.packId, packVersion: pack.version, runtimePolicy });
    const replay = api.createSoloCampaign(ALICE, { campaignId: firstCampaignId, agentId: agent.agentId, agentsVersion: agent.agentsVersion, packId: pack.packId, packVersion: pack.version, runtimePolicy });
    const second = api.createSoloCampaign(ALICE, { campaignId: secondCampaignId, agentId: agent.agentId, agentsVersion: agent.agentsVersion, packId: pack.packId, packVersion: pack.version, runtimePolicy });

    assert.equal(replay.campaignId, first.campaignId);
    assert.notEqual(second.campaignId, first.campaignId);
    assert.equal(api.listOwnedEvaluationCampaigns(ALICE).length, 2);
    assert.throws(() => api.createSoloCampaign(ALICE, { campaignId: firstCampaignId, agentId: agent.agentId, agentsVersion: agent.agentsVersion, packId: pack.packId, packVersion: pack.version, runtimePolicy: { ...runtimePolicy, maxOutputTokens: 501 } }), /conflicting/i);
  } finally {
    runtime.close();
  }
});

test("evaluation campaigns retain creation time and list newest first after durable updates", () => {
  const runtime = new SqliteRuntimeStore(":memory:");
  try {
    let now = 1_780_000_000;
    const api = new ArenaApiService(ALICE, runtime, () => now);
    const agent = api.createAgent(ALICE, "Chronology Agent", "Follow the locked policy.");
    const packId = sha256Text("chronology-pack");
    api.createEvaluationPack(ALICE, { packId, version: "1.0.0", name: "Chronology Pack", scenarios: [{ schema: "arena-test-scenario-v1", scenarioId: "chronology_01", version: "1.0.0", level: "RESPONSE", objective: "Answer.", context: "", constraints: [], availableActions: [], forbiddenActionIds: [], confirmationRequiredActionIds: [], maxProposedActions: 0 }] });
    const input = { agentId: agent.agentId, agentsVersion: agent.agentsVersion, packId, packVersion: "1.0.0", runtimePolicy: { model: "fixture", maxOutputTokens: 500, temperature: 0, maxProviderAttempts: 2 } };
    const firstId = sha256Text("chronology-first");
    const secondId = sha256Text("chronology-second");
    const first = api.createSoloCampaign(ALICE, { ...input, campaignId: firstId });
    now += 60;
    const second = api.createSoloCampaign(ALICE, { ...input, campaignId: secondId });
    assert.equal(first.createdAt, 1_780_000_000_000);
    assert.equal(second.createdAt, 1_780_000_060_000);
    assert.equal(api.createSoloCampaign(ALICE, { ...input, campaignId: firstId }).createdAt, first.createdAt);
    const updated = runtime.get<any>("evaluation-campaigns", firstId)!;
    updated.state = "RUNNING";
    runtime.put("evaluation-campaigns", firstId, updated);
    assert.deepEqual(new ArenaApiService(ALICE, runtime).listOwnedEvaluationCampaigns(ALICE).map(({ campaignId }) => campaignId), [secondId, firstId]);
    const legacyFirst = runtime.get<any>("evaluation-campaigns", firstId)!;
    const legacySecond = runtime.get<any>("evaluation-campaigns", secondId)!;
    delete legacyFirst.createdAt;
    delete legacySecond.createdAt;
    runtime.put("evaluation-campaigns", firstId, legacyFirst);
    runtime.put("evaluation-campaigns", secondId, legacySecond);
    assert.deepEqual(new ArenaApiService(ALICE, runtime).listOwnedEvaluationCampaigns(ALICE).map(({ campaignId, createdAt }) => [campaignId, createdAt]), [[secondId, undefined], [firstId, undefined]]);
    runtime.put("evaluation-fees-v2", firstId, { campaignId: firstId, owner: ALICE.toLowerCase(), heldAt: 1_780_000_010 });
    runtime.put("evaluation-fees-v2", secondId, { campaignId: secondId, owner: ALICE.toLowerCase(), heldAt: 1_780_000_070 });
    assert.deepEqual(new ArenaApiService(ALICE, runtime).listOwnedEvaluationCampaigns(ALICE).map(({ startedAt }) => startedAt), [1_780_000_070_000, 1_780_000_010_000]);
  } finally { runtime.close(); }
});

test("evaluation campaign reads use the durable runtime state after a worker transition", () => {
  const runtime = new SqliteRuntimeStore(":memory:");
  try {
    const api = new ArenaApiService(ALICE, runtime);
    const agent = api.createAgent(ALICE, "Runtime Agent", "Follow the durable evaluation state.");
    const pack = {
      packId: `sha256:${"3".repeat(64)}` as const,
      version: "1.0.0",
      name: "Runtime Pack",
      scenarios: [{ schema: "arena-test-scenario-v1" as const, scenarioId: "runtime_01", version: "1.0.0", level: "RESPONSE" as const, objective: "Answer once.", context: "", constraints: [], availableActions: [], forbiddenActionIds: [], confirmationRequiredActionIds: [], maxProposedActions: 0 }],
    };
    api.createEvaluationPack(ALICE, pack);
    const campaignId = sha256Text("runtime-canonical-campaign");
    api.createSoloCampaign(ALICE, { campaignId, agentId: agent.agentId, agentsVersion: agent.agentsVersion, packId: pack.packId, packVersion: pack.version, runtimePolicy: { model: "fixture", maxOutputTokens: 500, temperature: 0, maxProviderAttempts: 2 } });

    const transitioned = runtime.get<any>("evaluation-campaigns", campaignId)!;
    const runId = sha256Text("runtime-canonical-run");
    transitioned.state = "FAILED";
    transitioned.items[0] = { scenarioId: "runtime_01", state: "FAILED", attempt: 1, runIds: [runId], currentRunId: runId, providerModel: "cheap-model", providerRoute: "FALLBACK", failure: "PROVIDER_TIMEOUT", failureStage: "PROVIDER", failureCode: "PROVIDER_TIMEOUT" };
    runtime.put("evaluation-campaigns", campaignId, transitioned);

    assert.equal(api.getPublicEvaluationCampaign(campaignId)?.state, "FAILED");
    assert.deepEqual(api.getPublicEvaluationCampaign(campaignId)?.items[0].failureStage, "PROVIDER");
    assert.deepEqual(api.getPublicEvaluationCampaign(campaignId)?.items[0].failureCode, "PROVIDER_TIMEOUT");
    assert.equal(api.getPublicEvaluationCampaign(campaignId)?.items[0].providerModel, "cheap-model");
    assert.equal(api.getPublicEvaluationCampaign(campaignId)?.items[0].providerRoute, "FALLBACK");
    assert.equal(api.getPublicEvaluationCampaign(campaignId)?.items[0].runIds[0], runId);
    assert.equal(api.listOwnedEvaluationCampaigns(ALICE)[0].state, "FAILED");
    assert.equal(api.getAgentDetail(ALICE, agent.agentId).evaluations[0].state, "FAILED");
  } finally {
    runtime.close();
  }
});

test("EVAL-5 API compares only two versions of the same owned Agent and persists the redacted result", () => {
  const runtime = new SqliteRuntimeStore(":memory:");
  try {
    const setup = new ArenaApiService(ALICE, runtime);
    const baseline = setup.createAgent(ALICE, "Comparison Agent", "Baseline strategy.");
    const candidate = setup.updateAgent(ALICE, baseline.agentId, "Candidate strategy.");
    const scenario = { schema: "arena-test-scenario-v1" as const, scenarioId: "cmp_01", version: "1.0.0", level: "RESPONSE" as const, objective: "Answer consistently.", context: "", constraints: [], availableActions: [], forbiddenActionIds: [], confirmationRequiredActionIds: [], maxProposedActions: 0 };
    const packId = sha256Text("comparison-pack");
    setup.createEvaluationPack(ALICE, { packId, version: "1.0.0", name: "Comparison Pack", scenarios: [scenario] });
    const runtimePolicy = { model: "fixture", maxOutputTokens: 500, temperature: 0, maxProviderAttempts: 2 };
    const baselineCampaignId = sha256Text("comparison-baseline-campaign");
    const candidateCampaignId = sha256Text("comparison-candidate-campaign");
    setup.createSoloCampaign(ALICE, { campaignId: baselineCampaignId, agentId: baseline.agentId, agentsVersion: baseline.agentsVersion, packId, packVersion: "1.0.0", runtimePolicy });
    setup.createSoloCampaign(ALICE, { campaignId: candidateCampaignId, agentId: baseline.agentId, agentsVersion: candidate.agentsVersion, packId, packVersion: "1.0.0", runtimePolicy });

    for (const [campaignId, versionId, score] of [[baselineCampaignId, baseline.agentsVersion, 80], [candidateCampaignId, candidate.agentsVersion, 82]] as const) {
      const campaign = runtime.get<any>("evaluation-campaigns", campaignId)!;
      const runId = sha256Text(`${campaignId}-run`);
      campaign.state = "FINALIZED";
      campaign.items[0] = {
        scenarioId: "cmp_01", state: "FINALIZED", attempt: 1, runIds: [runId], currentRunId: runId,
        scorecard: {
          status: "FINAL", agent_version_id: versionId, rubric_version: "AgentEvaluationV5", scenario_digest: sha256Text("same-scenario"), overall_score: score,
          result_class: "PASS", actions_executed: false, policy_findings: [], summary: "fixture",
          dimensions: ["instruction_adherence", "reasoning_quality", "action_selection", "rule_compliance", "task_completion", "safety"].map((dimension) => ({ dimension_id: dimension, grade: dimension === "action_selection" ? "NOT_APPLICABLE" : "GOOD", reason: "fixture", evidence_refs: ["RESPONSE"] })),
        },
      };
      runtime.put("evaluation-campaigns", campaignId, campaign);
    }

    const service = new ArenaApiService(ALICE, runtime);
    const comparisonId = sha256Text("comparison-record");
    const policy = { schema: "arena-regression-policy-v1" as const, requiredRunsPerScenario: 1, minimumScenarioCoverageBps: 10_000, maximumOverallDrop: 5, maximumDimensionDrop: 10, maximumOverallSpread: 10, maximumDimensionSpread: 10, minimumDimensionScores: { safety: 70 }, criticalFindingCodes: ["FORBIDDEN_ACTION"] };
    const result = service.createVersionComparison(ALICE, { comparisonId, agentId: baseline.agentId, baselineVersionId: baseline.agentsVersion, candidateVersionId: candidate.agentsVersion, baselineCampaignIds: [baselineCampaignId], candidateCampaignIds: [candidateCampaignId], policy });
    assert.equal(result.status, "PASS");
    assert.equal(JSON.stringify(result).includes("strategy"), false);
    assert.deepEqual(new ArenaApiService(ALICE, runtime).getOwnedVersionComparison(ALICE, comparisonId), result);
    assert.equal(service.listOwnedVersionComparisons(ALICE).length, 1);
    assert.throws(() => service.getOwnedVersionComparison(BOB, comparisonId), /unauthorized/i);
  } finally {
    runtime.close();
  }
});
