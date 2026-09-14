import test from "node:test";
import assert from "node:assert/strict";
import { assertPolicyImmutable, validateTournamentPolicy } from "../src/policy.ts";

function policy(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "arena.tournament-policy.v1",
    arcChainId: 5042002,
    escrowAddress: "0x1111111111111111111111111111111111111111",
    operatorAddress: "0x2222222222222222222222222222222222222222",
    registrationOpensAt: 1_700_000_000,
    registrationClosesAt: 1_700_010_000,
    startsAt: 1_700_020_000,
    expiresAt: 1_700_100_000,
    minEntrants: 8,
    maxEntrants: 32,
    stakeUnits: "1000000",
    maxStakeUnits: "1000000000",
    platformFeeBps: 1000,
    payoutBps: [4000, 2500, 1500, 1000, 1000],
    retryPolicyVersion: "retry.v1",
    tiePolicyVersion: "tie.v1",
    modelPolicyVersion: "model.v1",
    topicPolicyVersion: "topic.v1",
    rubricVersion: "rubric.v1",
    operatorPolicyVersion: "operator.v1",
    ...overrides,
  };
}

test("accepts the locked policy shape", () => {
  assert.doesNotThrow(() => validateTournamentPolicy(policy()));
});

test("rejects timestamp order, bounds, fee, payout, stake and missing versions", () => {
  const cases: Record<string, Record<string, unknown>> = {
    timestamp: { startsAt: 1_700_005_000 },
    bounds: { minEntrants: 7 },
    fee: { platformFeeBps: 999 },
    payout: { payoutBps: [5000, 2500, 1500, 1000, 999] },
    stake: { stakeUnits: "0" },
    version: { rubricVersion: "" },
  };
  for (const [name, overrides] of Object.entries(cases)) {
    assert.throws(() => validateTournamentPolicy(policy(overrides)), /invalid|must|missing|sum|fee|stake/i, name);
  }
  assert.throws(() => validateTournamentPolicy(policy({ stakeUnits: "1000000001" })), /stake/i);
});

test("rejects unsupported entrant bounds and malformed addresses", () => {
  assert.throws(() => validateTournamentPolicy(policy({ maxEntrants: 33 })), /entrant/i);
  assert.throws(() => validateTournamentPolicy(policy({ escrowAddress: "0xabc" })), /address/i);
});

test("allows an identical policy but rejects mutation after entry", () => {
  const original = policy();
  assert.doesNotThrow(() => assertPolicyImmutable(original, { ...original, payoutBps: [...original.payoutBps] }));
  assert.throws(() => assertPolicyImmutable(original, policy({ operatorPolicyVersion: "operator.v2" })), /immutable/i);
});
