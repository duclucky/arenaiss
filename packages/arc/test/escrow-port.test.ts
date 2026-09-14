import { test } from "node:test";
import * as assert from "node:assert";
import { buildCreditPayoutCall, buildRegisterCall, buildSettlementCall, buildSimpleCall } from "../src/escrow-port.ts";

const id = (n: string) => `0x${n.repeat(64).slice(0, 64)}`;

test("register call binds tournament, entrant and AGENTS commitment without a caller stake amount", () => {
  const call = buildRegisterCall({
    tournamentId: id("a"), entrantId: id("b"), agentId: id("c"), agentsVersion: id("d"), agentsCommitment: id("e"),
  });
  assert.strictEqual(call.method, "register");
  assert.strictEqual(call.args.length, 5);
  assert.strictEqual(call.args[1], id("b"));
});

test("settlement call has exactly five unique entrants and no payout amounts", () => {
  const call = buildSettlementCall({
    tournamentId: id("a"), rankedEntrants: [id("b"), id("c"), id("d"), id("e"), id("f")], rankingDigest: id("1"), settlementNonce: "7",
  });
  assert.strictEqual(call.method, "settleByOperator");
  assert.strictEqual(call.args.length, 4);
  assert.strictEqual((call.args[1] as readonly string[]).length, 5);
});

test("settlement rejects duplicate, zero and non-five rankings", () => {
  assert.throws(() => buildSettlementCall({ tournamentId: id("a"), rankedEntrants: [id("b"), id("b"), id("c"), id("d"), id("e")], rankingDigest: id("1"), settlementNonce: "1" }), /unique/);
  assert.throws(() => buildSettlementCall({ tournamentId: id("a"), rankedEntrants: [id("b")], rankingDigest: id("1"), settlementNonce: "1" }), /five/);
  assert.throws(() => buildSettlementCall({ tournamentId: id("a"), rankedEntrants: [id("b"), id("c"), id("d"), id("e"), id("f")], rankingDigest: id("1"), settlementNonce: "0" }), /positive/);
});

test("simple calls validate tournament identity", () => {
  assert.deepStrictEqual(buildSimpleCall("closeRegistration", id("a")), { method: "closeRegistration", args: [id("a")] });
  assert.throws(() => buildSimpleCall("markRunning", "bad"), /bytes32/);
});

test("automatic payout binds the beneficiary and never accepts an alternate recipient", () => {
  const beneficiary = "0x1111111111111111111111111111111111111111";
  assert.deepStrictEqual(buildCreditPayoutCall(id("a"), beneficiary), {
    method: "withdrawCreditFor",
    args: [id("a"), beneficiary],
  });
  assert.throws(() => buildCreditPayoutCall(id("a"), "0x0000000000000000000000000000000000000000"), /beneficiary/);
  assert.throws(() => buildCreditPayoutCall(id("a"), "not-an-address"), /beneficiary/);
});

test("automatic platform fee payout has no caller-supplied recipient", () => {
  assert.deepStrictEqual(buildSimpleCall("withdrawPlatformFeeFor", id("a")), {
    method: "withdrawPlatformFeeFor",
    args: [id("a")],
  });
});
