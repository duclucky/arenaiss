import test from "node:test";
import assert from "node:assert/strict";
import { buildBracket, derivePublicBracketSeed } from "../src/bracket.ts";

function entrants(n: number) { return Array.from({ length: n }, (_, i) => `sha256:${String(i + 1).padStart(64, "0")}`); }

test("supports every entrant count from 8 through 32 with deterministic byes", () => {
  for (let n = 8; n <= 32; n += 1) {
    const result = buildBracket({
      tournamentId: "sha256:" + "a".repeat(64),
      seedDigest: "sha256:" + "b".repeat(64),
      entrants: entrants(n),
      bracketRevision: 1,
    });
    const p = 2 ** Math.floor(Math.log2(n));
    assert.equal(result.preliminaryMatchCount, n - p);
    assert.equal(result.byeCount, 2 * p - n);
    assert.equal(new Set(result.matches.map((m) => m.matchId)).size, result.matches.length);
    assert.deepEqual(result, buildBracket({
      tournamentId: "sha256:" + "a".repeat(64),
      seedDigest: "sha256:" + "b".repeat(64),
      entrants: entrants(n),
      bracketRevision: 1,
    }));
  }
});

test("covers each entrant once and creates top-five ancestry paths", () => {
  const result = buildBracket({
    tournamentId: "sha256:" + "a".repeat(64),
    seedDigest: "sha256:" + "b".repeat(64),
    entrants: entrants(13),
    bracketRevision: 1,
  });
  const direct = result.matches.filter((m) => m.stage === "preliminary").flatMap((m) => [m.slotA, m.slotB]);
  const entrantSlots = result.matches.filter((m) => m.stage === "main").flatMap((m) => [m.slotA, m.slotB]);
  const refs = [...direct, ...entrantSlots].filter((s) => s.kind === "entrant").map((s) => s.id);
  assert.equal(new Set(refs).size, 13);
  assert.equal(result.rankSources.length, 5);
  assert.equal(result.matches.filter((m) => m.stage === "third_place").length, 1);
  assert.equal(result.matches.filter((m) => m.stage === "fifth_place").length, 3);
});

test("rejects duplicate, missing, out-of-range entrants and changes domain", () => {
  const base = { tournamentId: "sha256:" + "a".repeat(64), seedDigest: "sha256:" + "b".repeat(64), bracketRevision: 1 };
  assert.throws(() => buildBracket({ ...base, entrants: entrants(7) }), /8|entrant/i);
  assert.throws(() => buildBracket({ ...base, entrants: [...entrants(8).slice(0, 7), entrants(8)[0]] }), /duplicate/i);
  const a = buildBracket({ ...base, entrants: entrants(8) });
  const b = buildBracket({ ...base, tournamentId: "sha256:" + "c".repeat(64), entrants: entrants(8) });
  assert.notDeepEqual(a.matches.map((m) => m.matchId), b.matches.map((m) => m.matchId));
});

test("public bracket seed is roster-order independent and bound to Arc block entropy", () => {
  const tournamentId = "sha256:" + "a".repeat(64) as `sha256:${string}`;
  const roster = entrants(13) as `sha256:${string}`[];
  const first = derivePublicBracketSeed({ tournamentId, entrants: roster, entropyBlockHash: `0x${"b".repeat(64)}`, entropyBlockNumber: "123" });
  const reordered = derivePublicBracketSeed({ tournamentId, entrants: [...roster].reverse(), entropyBlockHash: `0x${"b".repeat(64)}`, entropyBlockNumber: "123" });
  const nextBlock = derivePublicBracketSeed({ tournamentId, entrants: roster, entropyBlockHash: `0x${"c".repeat(64)}`, entropyBlockNumber: "124" });
  assert.deepEqual(reordered, first);
  assert.notEqual(nextBlock.seedDigest, first.seedDigest);
  assert.notDeepEqual(
    buildBracket({ tournamentId, seedDigest: nextBlock.seedDigest, entrants: roster, bracketRevision: 1 }).matches,
    buildBracket({ tournamentId, seedDigest: first.seedDigest, entrants: roster, bracketRevision: 1 }).matches,
  );
  assert.throws(() => derivePublicBracketSeed({ tournamentId, entrants: roster, entropyBlockHash: "0x123", entropyBlockNumber: "123" }), /block hash/i);
});
