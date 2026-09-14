import test from "node:test";
import assert from "node:assert/strict";
import { attemptId, entrantId, matchId, roundId, tournamentId } from "../src/canonical.ts";

const addrA = "0x1111111111111111111111111111111111111111";
const addrB = "0x2222222222222222222222222222222222222222";

test("IDs are stable, domain separated, and digest formatted", () => {
  const t = tournamentId(5042002, addrA, addrB, 7);
  assert.match(t, /^sha256:[0-9a-f]{64}$/);
  assert.equal(t, tournamentId(5042002, addrA, addrB, 7));
  assert.notEqual(t, entrantId(t, addrA, "agent-1", 0));
  assert.notEqual(t, tournamentId(5042003, addrA, addrB, 7));
});

test("field changes and ordered list changes alter IDs", () => {
  const t = tournamentId(5042002, addrA, addrB, 7);
  assert.notEqual(t, tournamentId(5042002, addrA, addrB, 8));
  const r1 = roundId(t, 1, 1);
  const r2 = roundId(t, 2, 1);
  assert.notEqual(r1, r2);
  const m1 = matchId(t, "main", 1, 0, `entrant:${t}`, `entrant:${r1}`, 1);
  const m2 = matchId(t, "main", 1, 0, `entrant:${r1}`, `entrant:${t}`, 1);
  assert.notEqual(m1, m2);
  assert.notEqual(attemptId(m1, 1), attemptId(m1, 2));
});

test("rejects malformed typed inputs", () => {
  assert.throws(() => tournamentId(5042002, "0xabc", addrB, 7), /address/i);
  assert.throws(() => tournamentId(5042002, addrA, addrB, -1), /integer|nonce/i);
});
