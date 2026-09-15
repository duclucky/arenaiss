import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";
import {
  ComparisonRunRegistry,
  comparisonRunId,
  projectLegacyMatchAttempt,
  projectRichComparisonAttempt,
  resultForTournamentProgression,
  type LegacyMatchAttempt,
  type RichComparisonAttempt,
} from "../src/tournament-comparison.ts";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const tx = `0x${"ab".repeat(32)}`;
const judge = "0x1111111111111111111111111111111111111111";
const legacy: LegacyMatchAttempt = {
  matchId: digest("match"), attemptId: digest("attempt"),
  agentVersionIdA: digest("agent-a"), agentVersionIdB: digest("agent-b"),
  topicDigest: digest("topic"), outputDigestA: digest("output-a"), outputDigestB: digest("output-b"),
  rubricVersion: "GeneralResponseV7", networkChainId: 61999, judgeAddress: judge,
  transactionHash: tx, finality: "FINALIZED", execution: "SUCCESS", result: "A_WIN",
};

test("E6 maps one legacy MatchAttempt idempotently without rewriting verdict or transaction evidence", () => {
  const first = projectLegacyMatchAttempt(legacy);
  const second = projectLegacyMatchAttempt(structuredClone(legacy));
  assert.deepEqual(second, first);
  assert.equal(first.comparisonRunId, comparisonRunId(legacy.matchId, legacy.attemptId));
  assert.equal(first.sourceKind, "LEGACY_TOURNAMENT");
  assert.equal(first.result, "A_WIN");
  assert.equal(first.judge.transactionHash, tx);
  assert.equal(first.judge.networkChainId, 61999);
  assert.equal(first.scorecard, undefined);
  assert.equal(JSON.stringify(first).includes("AGENTS.md"), false);
});

test("E6 persists one immutable projection and rejects a conflicting replay across restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-comparison-run-"));
  const path = join(directory, "runtime.sqlite");
  try {
    let database = new SqliteRuntimeStore(path);
    new ComparisonRunRegistry(database).put(projectLegacyMatchAttempt(legacy));
    database.close();
    database = new SqliteRuntimeStore(path);
    const registry = new ComparisonRunRegistry(database);
    assert.deepEqual(registry.put(projectLegacyMatchAttempt(legacy)), registry.get(comparisonRunId(legacy.matchId, legacy.attemptId)));
    assert.throws(() => registry.put(projectLegacyMatchAttempt({ ...legacy, transactionHash: `0x${"cd".repeat(32)}` })), /conflicting/i);
    database.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function rich(overrides: Partial<RichComparisonAttempt> = {}): RichComparisonAttempt {
  const source: RichComparisonAttempt = {
    matchId: digest("rich-match"), attemptId: digest("rich-attempt"),
    agentVersionIdA: digest("rich-agent-a"), agentVersionIdB: digest("rich-agent-b"),
    scenarioDigest: digest("scenario"), responseDigestA: digest("response-a"), responseDigestB: digest("response-b"),
    rubricVersion: "AgentComparisonV1", networkChainId: 61997, judgeAddress: judge,
    transactionHash: tx, finality: "FINALIZED", execution: "SUCCESS", result: "B_WIN",
    scorecard: {}, ...overrides,
  };
  if (!overrides.scorecard) source.scorecard = {
    status: "FINAL", match_id: source.matchId, attempt_id: source.attemptId,
    agent_version_id_a: source.agentVersionIdA, agent_version_id_b: source.agentVersionIdB,
    scenario_digest: source.scenarioDigest, response_digest_a: source.responseDigestA,
    response_digest_b: source.responseDigestB, rubric_version: source.rubricVersion,
    result: source.result, dimensions: [],
  };
  return source;
}

test("E6 allows only a bound finalized successful A/B rich result to advance", () => {
  const eligible = projectRichComparisonAttempt(rich());
  assert.equal(eligible.progressionEligible, true);
  assert.equal(resultForTournamentProgression(eligible), "B_WIN");
  for (const source of [
    rich({ finality: "ACCEPTED", execution: "PENDING" }),
    rich({ execution: "FAILED" }),
    rich({ result: "TIE" }),
    rich({ result: "RETRYABLE" }),
    rich({ result: "A_WIN", scorecard: { status: "FINAL", result: "B_WIN", dimensions: [] } }),
  ]) {
    const projected = projectRichComparisonAttempt(source);
    assert.equal(projected.progressionEligible, false);
    assert.throws(() => resultForTournamentProgression(projected), /eligible terminal comparison/i);
  }
});

test("E6 scorecard fields are isolated from frozen Arc accounting inputs", () => {
  const source = rich();
  source.scorecard = { ...source.scorecard, overall_score_a: 5, overall_score_b: 99, platformFeeBps: 0, payoutAmounts: [1] };
  const projected = projectRichComparisonAttempt(source);
  assert.equal(projected.progressionEligible, true);
  assert.equal(resultForTournamentProgression(projected), "B_WIN");
  assert.equal("platformFeeBps" in projected, false);
  assert.equal("payoutAmounts" in projected, false);
});
