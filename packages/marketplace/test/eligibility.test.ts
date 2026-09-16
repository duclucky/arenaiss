import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMarketplaceEligibility, type MarketplaceEligibilityInput } from "../src/eligibility.ts";

const dimensions = ["instruction_adherence", "reasoning_quality", "action_selection", "rule_compliance", "task_completion", "safety"];
function fixture(): MarketplaceEligibilityInput {
  return {
    agentId: "sha256:" + "11".repeat(32), agentVersionId: "sha256:" + "22".repeat(32), agentsCommitment: "sha256:" + "33".repeat(32),
    testPackId: "sha256:" + "44".repeat(32), testPackVersion: "1", rubricVersion: "AgentEvaluationV5",
    network: "studio-next", chainId: 61997, judgeAddress: "0x" + "55".repeat(20), issuedAt: 1000, expiresAt: 2000,
    requiredScenarioIds: Array.from({ length: 6 }, (_, i) => `scenario-${i + 1}`),
    runs: Array.from({ length: 12 }, (_, i) => ({
      runId: "sha256:" + (i + 1).toString(16).padStart(64, "0"), scenarioId: `scenario-${Math.floor(i / 2) + 1}`,
      state: "FINALIZED" as const, agentVersionId: "sha256:" + "22".repeat(32), agentsCommitment: "sha256:" + "33".repeat(32),
      testPackId: "sha256:" + "44".repeat(32), testPackVersion: "1", rubricVersion: "AgentEvaluationV5",
      providerModel: "primary-model",
      network: "studio-next", chainId: 61997, judgeAddress: "0x" + "55".repeat(20), overallScore: i % 2 ? 80 : 100,
      dimensions: Object.fromEntries(dimensions.map((id) => [id, id === "reasoning_quality" || id === "action_selection" ? 60 : 80])), criticalFindingCount: 0,
    })),
  };
}

test("issues a deterministic certificate exactly at every v1 threshold", () => {
  const result = evaluateMarketplaceEligibility(fixture());
  assert.equal(result.eligible, true);
  assert.equal(result.certificate?.policyVersion, "arena-marketplace-eligibility-v1");
  assert.equal(result.certificate?.coverageBps, 10_000);
  assert.match(result.certificate?.evidenceDigest ?? "", /^sha256:[0-9a-f]{64}$/);
});

test("fails closed below score, coverage, repeat, variance or critical-finding gates", () => {
  for (const mutate of [
    (v: MarketplaceEligibilityInput) => { v.runs.forEach((run) => { run.dimensions.safety = 79; }); },
    (v: MarketplaceEligibilityInput) => { v.runs.pop(); },
    (v: MarketplaceEligibilityInput) => { v.runs[0].overallScore = 79; },
    (v: MarketplaceEligibilityInput) => { v.runs[0].criticalFindingCount = 1; },
  ]) {
    const value = fixture(); mutate(value);
    assert.equal(evaluateMarketplaceEligibility(value).eligible, false);
  }
});

test("rejects one mismatched immutable binding and invalid validity windows", () => {
  const binding = fixture(); binding.runs[0].rubricVersion = "other";
  assert.equal(evaluateMarketplaceEligibility(binding).eligible, false);
  const time = fixture(); time.expiresAt = time.issuedAt;
  assert.throws(() => evaluateMarketplaceEligibility(time), /validity/i);
});

test("certificate accepts mixed models and binds each run to its actual model", () => {
  const mixed = fixture(); mixed.runs[0].providerModel = "openai-fallback";
  const acceptedMixed = evaluateMarketplaceEligibility(mixed);
  assert.equal(acceptedMixed.eligible, true);
  if (acceptedMixed.eligible) assert.deepEqual(acceptedMixed.certificate.executionModels, ["openai-fallback", "primary-model"]);
  const original = evaluateMarketplaceEligibility(fixture());
  if (acceptedMixed.eligible && original.eligible) assert.notEqual(acceptedMixed.certificate.evidenceDigest, original.certificate.evidenceDigest);
  const remapped = fixture(); remapped.runs[1].providerModel = "openai-fallback";
  const acceptedRemapped = evaluateMarketplaceEligibility(remapped);
  if (acceptedMixed.eligible && acceptedRemapped.eligible) {
    assert.deepEqual(acceptedMixed.certificate.executionModels, acceptedRemapped.certificate.executionModels);
    assert.notEqual(acceptedMixed.certificate.evidenceDigest, acceptedRemapped.certificate.evidenceDigest);
  }

  const uniform = fixture(); uniform.runs.forEach((run) => { run.providerModel = "openai-fallback"; });
  const accepted = evaluateMarketplaceEligibility(uniform);
  assert.equal(accepted.eligible, true);
  if (accepted.eligible) assert.deepEqual(accepted.certificate.executionModels, ["openai-fallback"]);
});
