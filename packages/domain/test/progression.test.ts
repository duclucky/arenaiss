import test from "node:test";
import assert from "node:assert/strict";
import { buildBracket } from "../src/bracket.ts";
import { advanceBracket, type MatchResult } from "../src/progression.ts";

const input = {
  tournamentId: "sha256:" + "a".repeat(64) as `sha256:${string}`,
  seedDigest: "sha256:" + "b".repeat(64) as `sha256:${string}`,
  entrants: Array.from({ length: 8 }, (_, i) => `sha256:${String(i + 1).padStart(64, "0")}` as `sha256:${string}`),
  bracketRevision: 1,
};
const blueprint = buildBracket(input);

function resultsForAll(value: MatchResult): Map<`sha256:${string}`, MatchResult> {
  return new Map(blueprint.matches.map((match) => [match.matchId, value]));
}

test("only terminal A/B outcomes can complete progression", () => {
  const pendingTie = advanceBracket(blueprint, resultsForAll("TIE"));
  assert.deepEqual(pendingTie, { status: "PENDING" });
  const pendingRetry = advanceBracket(blueprint, resultsForAll("RETRYABLE"));
  assert.deepEqual(pendingRetry, { status: "PENDING" });
});

test("complete terminal results produce five unique ranks with persisted ancestry", () => {
  const results = resultsForAll("A_WIN");
  const completed = advanceBracket(blueprint, results);
  assert.equal(completed.status, "COMPLETE");
  assert.equal(completed.ranking?.length, 5);
  assert.equal(new Set(completed.ranking).size, 5);
});

test("missing predecessor stays pending, unknown result or extra match rejects", () => {
  const results = resultsForAll("A_WIN");
  results.delete(blueprint.matches[0].matchId);
  assert.deepEqual(advanceBracket(blueprint, results), { status: "PENDING" });
  const extra = new Map(resultsForAll("A_WIN"));
  extra.set("sha256:" + "f".repeat(64) as `sha256:${string}`, "A_WIN");
  assert.throws(() => advanceBracket(blueprint, extra), /unknown|extra/i);
  const malformed = new Map(resultsForAll("A_WIN"));
  malformed.set(blueprint.matches[0].matchId, "DRAW" as MatchResult);
  assert.throws(() => advanceBracket(blueprint, malformed), /result|enum/i);
});

test("the same terminal map is idempotent and cannot produce duplicate ranks", () => {
  const results = resultsForAll("B_WIN");
  assert.deepEqual(advanceBracket(blueprint, results), advanceBracket(blueprint, results));
});
