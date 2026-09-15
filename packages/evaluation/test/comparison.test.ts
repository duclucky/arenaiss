import test from "node:test";
import assert from "node:assert/strict";

import { VersionComparisonRegistry, evaluateVersionComparison, type RegressionPolicy, type VersionComparisonInput } from "../src/comparison.ts";
import { sha256Text, type EvaluationLevel, type EvaluationScenario } from "../src/protocol.ts";
import type { SoloCampaignRecord } from "../src/solo-runner.ts";
import { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";

const digest = (value: string) => sha256Text(value);
const dimensions = ["instruction_adherence", "reasoning_quality", "action_selection", "rule_compliance", "task_completion", "safety"] as const;

const scenario = (scenarioId: string, level: EvaluationLevel = "RESPONSE"): EvaluationScenario => ({
  schema: "arena-test-scenario-v1", scenarioId, version: "1.0.0", level,
  objective: `Complete ${scenarioId}.`, context: "", constraints: [],
  availableActions: [], forbiddenActionIds: [], confirmationRequiredActionIds: [], maxProposedActions: 0,
});

const scorecard = (versionId: string, scenarioId: string, overall: number, values: Partial<Record<typeof dimensions[number], number>> = {}, findingCodes: string[] = []) => ({
  status: "FINAL", agent_version_id: versionId, rubric_version: "AgentEvaluationV5", scenario_digest: digest(JSON.stringify({ scenarioId })),
  overall_score: overall, result_class: overall >= 70 ? "PASS" : "WEAK", actions_executed: false,
  dimensions: dimensions.map((dimension) => ({
    dimension_id: dimension,
    grade: dimension === "action_selection" ? "NOT_APPLICABLE" : "GOOD",
    score: values[dimension] ?? (dimension === "action_selection" ? null : overall),
    reason: "fixture",
    evidence_refs: ["RESPONSE"],
  })),
  policy_findings: findingCodes.map((code) => ({ code, action_id: "", evidence_ref: "POLICY_FINDING" })),
  summary: "fixture",
});

function campaign(label: string, versionId: string, scores: Record<string, number>, options: { packVersion?: string; model?: string; rubricVersion?: string; pending?: string; failed?: string; findings?: Record<string, string[]> } = {}): SoloCampaignRecord {
  const scenarios = Object.keys(scores).map((id) => scenario(id));
  return {
    schema: "arena-solo-campaign-v1", campaignId: digest(label), owner: "0x1111111111111111111111111111111111111111",
    agent: { versionId: versionId as `sha256:${string}`, commitment: digest(`${label}-agent`), agentsMd: `${label}-agent` },
    testPack: { packId: digest("pack"), version: options.packVersion ?? "1.0.0", scenarios },
    runtimePolicy: { model: options.model ?? "fixture-model", maxOutputTokens: 500, temperature: 0, maxProviderAttempts: 2 },
    rubricVersion: (options.rubricVersion ?? "AgentEvaluationV5") as "AgentEvaluationV5",
    state: options.failed ? "FAILED" : options.pending ? "RUNNING" : "FINALIZED",
    items: scenarios.map((item) => {
      if (item.scenarioId === options.failed) return { scenarioId: item.scenarioId, state: "FAILED", attempt: 1, runIds: [digest(`${label}-${item.scenarioId}`)], currentRunId: digest(`${label}-${item.scenarioId}`), failure: "PROVIDER_ERROR" };
      if (item.scenarioId === options.pending) return { scenarioId: item.scenarioId, state: "JUDGING", attempt: 1, runIds: [digest(`${label}-${item.scenarioId}`)], currentRunId: digest(`${label}-${item.scenarioId}`) };
      return { scenarioId: item.scenarioId, state: "FINALIZED", attempt: 1, runIds: [digest(`${label}-${item.scenarioId}`)], currentRunId: digest(`${label}-${item.scenarioId}`), scorecard: scorecard(versionId, item.scenarioId, scores[item.scenarioId], {}, options.findings?.[item.scenarioId]) };
    }),
  };
}

const policy = (overrides: Partial<RegressionPolicy> = {}): RegressionPolicy => ({
  schema: "arena-regression-policy-v1", requiredRunsPerScenario: 2, minimumScenarioCoverageBps: 10_000,
  maximumOverallDrop: 5, maximumDimensionDrop: 10, maximumOverallSpread: 20, maximumDimensionSpread: 20,
  minimumDimensionScores: { safety: 70, rule_compliance: 70 }, criticalFindingCodes: ["FORBIDDEN_ACTION", "CONFIRMATION_REQUIRED"], ...overrides,
});

function input(overrides: Partial<VersionComparisonInput> = {}): VersionComparisonInput {
  const baselineVersion = digest("baseline"); const candidateVersion = digest("candidate");
  return {
    schema: "arena-version-comparison-input-v1", comparisonId: digest("comparison"), agentId: digest("agent"),
    baseline: { versionId: baselineVersion, campaigns: [campaign("b1", baselineVersion, { one: 80, two: 80 }), campaign("b2", baselineVersion, { one: 82, two: 78 })] },
    candidate: { versionId: candidateVersion, campaigns: [campaign("c1", candidateVersion, { one: 82, two: 81 }), campaign("c2", candidateVersion, { one: 84, two: 79 })] },
    policy: policy(), ...overrides,
  };
}

test("CMP-1 compares isolated versions only when pack, scenario, runtime, rubric, and run count match exactly", () => {
  const result = evaluateVersionComparison(input());
  assert.equal(result.status, "PASS");
  assert.equal(result.coverageBps, 10_000);
  assert.equal(result.baseline?.overallScore, 80);
  assert.equal(result.candidate?.overallScore, 81.5);
  assert.deepEqual(result.binding?.scenarioIds, ["one", "two"]);
  assert.deepEqual(result.binding?.evaluatedScenarioIds, ["one", "two"]);
  assert.equal(JSON.stringify(result).includes("agentsMd"), false);
});

test("CMP-1 rejects every comparability mismatch without claiming a regression result", () => {
  const cases: Array<[string, (value: VersionComparisonInput) => void]> = [
    ["PACK_VERSION_MISMATCH", (value) => { value.candidate.campaigns[0].testPack.version = "2.0.0"; value.candidate.campaigns[1].testPack.version = "2.0.0"; }],
    ["SCENARIO_SET_MISMATCH", (value) => { value.candidate.campaigns.forEach((row) => { row.testPack.scenarios[0].objective = "Different objective"; }); }],
    ["RUNTIME_POLICY_MISMATCH", (value) => { value.candidate.campaigns.forEach((row) => { row.runtimePolicy.model = "other-model"; }); }],
    ["SCORING_VERSION_MISMATCH", (value) => { value.candidate.campaigns.forEach((row) => { (row as any).rubricVersion = "AgentEvaluationV6"; }); }],
    ["REQUIRED_RUN_COUNT_MISMATCH", (value) => { value.candidate.campaigns.pop(); }],
    ["VERSION_NOT_ISOLATED", (value) => { value.candidate.versionId = value.baseline.versionId; value.candidate.campaigns.forEach((row) => { row.agent.versionId = value.baseline.versionId; }); }],
  ];
  for (const [code, mutate] of cases) {
    const value = input(); mutate(value);
    const result = evaluateVersionComparison(value);
    assert.equal(result.status, "INCOMPARABLE", code);
    assert.equal(result.findings.some((finding) => finding.code === code), true, code);
    assert.equal(result.baseline, undefined, code);
  }
});

test("CMP-2 applies overall and dimension thresholds at exact minus, boundary, and plus values", () => {
  const baselineVersion = digest("baseline"); const candidateVersion = digest("candidate");
  const make = (candidateScore: number, maximumOverallDrop: number) => input({
    baseline: { versionId: baselineVersion, campaigns: [campaign("bb", baselineVersion, { one: 80 })] },
    candidate: { versionId: candidateVersion, campaigns: [campaign(`cc-${candidateScore}`, candidateVersion, { one: candidateScore })] },
    policy: policy({ requiredRunsPerScenario: 1, maximumOverallDrop, maximumDimensionDrop: maximumOverallDrop, minimumDimensionScores: {} }),
  });
  assert.equal(evaluateVersionComparison(make(76, 5)).status, "PASS");
  assert.equal(evaluateVersionComparison(make(75, 5)).status, "PASS");
  const failed = evaluateVersionComparison(make(74, 5));
  assert.equal(failed.status, "REGRESSION");
  assert.equal(failed.findings.some((finding) => finding.code === "OVERALL_SCORE_DROP"), true);

  const dimensionBoundary = input({ policy: policy({ maximumDimensionDrop: 20, minimumDimensionScores: {} }) });
  dimensionBoundary.candidate.campaigns.forEach((row) => row.items.forEach((item) => { if (item.scorecard) item.scorecard.dimensions.find((dimension: any) => dimension.dimension_id === "safety").grade = "MIXED"; }));
  assert.equal(evaluateVersionComparison(dimensionBoundary).status, "PASS");
  dimensionBoundary.policy.maximumDimensionDrop = 19;
  assert.equal(evaluateVersionComparison(dimensionBoundary).findings.some((finding) => finding.code === "DIMENSION_SCORE_DROP" && finding.dimension === "safety"), true);

  const minimumBoundary = input({ policy: policy({ minimumDimensionScores: { safety: 80 } }) });
  assert.equal(evaluateVersionComparison(minimumBoundary).status, "PASS");
  minimumBoundary.policy.minimumDimensionScores.safety = 81;
  assert.equal(evaluateVersionComparison(minimumBoundary).findings.some((finding) => finding.code === "DIMENSION_MINIMUM" && finding.dimension === "safety"), true);
});

test("CMP-2 enforces per-dimension minimums and critical deterministic findings with zero tolerance", () => {
  const value = input();
  value.candidate.campaigns.forEach((row) => row.items.forEach((item) => {
    if (item.scorecard) {
      item.scorecard.policy_findings = [{ code: "FORBIDDEN_ACTION", action_id: "send", evidence_ref: "POLICY_FINDING" }];
      item.scorecard.dimensions.find((dimension: any) => dimension.dimension_id === "safety").grade = "MIXED";
    }
  }));
  const result = evaluateVersionComparison(value);
  assert.equal(result.status, "REGRESSION");
  assert.equal(result.findings.some((finding) => finding.code === "CRITICAL_POLICY_FINDING"), true);
  assert.equal(result.findings.some((finding) => finding.code === "DIMENSION_MINIMUM" && finding.dimension === "safety"), true);
});

test("CMP-2 returns UNSTABLE when repeated-run variance exceeds the locked policy", () => {
  const value = input({ policy: policy({ maximumOverallSpread: 5, maximumDimensionSpread: 5 }) });
  value.candidate.campaigns[0].items.forEach((item) => { if (item.scorecard) item.scorecard.overall_score = 60; });
  value.candidate.campaigns[1].items.forEach((item) => { if (item.scorecard) item.scorecard.overall_score = 90; });
  value.candidate.campaigns[0].items.forEach((item) => { if (item.scorecard) item.scorecard.dimensions.find((dimension: any) => dimension.dimension_id === "reasoning_quality").grade = "FAIL"; });
  const result = evaluateVersionComparison(value);
  assert.equal(result.status, "UNSTABLE");
  assert.equal(result.findings.some((finding) => finding.code === "OVERALL_VARIANCE_EXCEEDED"), true);
  assert.equal(result.findings.some((finding) => finding.code === "CANDIDATE_DIMENSION_VARIANCE_EXCEEDED" && finding.dimension === "reasoning_quality"), true);
});

test("CMP-2 measures repeat variance within each scenario instead of treating scenario difficulty as variance", () => {
  const baselineVersion = digest("baseline"); const candidateVersion = digest("candidate");
  const value = input({
    baseline: { versionId: baselineVersion, campaigns: [campaign("vb1", baselineVersion, { easy: 95, hard: 45 }), campaign("vb2", baselineVersion, { easy: 95, hard: 45 })] },
    candidate: { versionId: candidateVersion, campaigns: [campaign("vc1", candidateVersion, { easy: 95, hard: 45 }), campaign("vc2", candidateVersion, { easy: 95, hard: 45 })] },
    policy: policy({ maximumOverallSpread: 0, maximumDimensionSpread: 0, minimumDimensionScores: {} }),
  });
  const result = evaluateVersionComparison(value);
  assert.equal(result.status, "PASS");
  assert.equal(result.baseline?.overallSpread, 0);
  assert.equal(result.candidate?.overallSpread, 0);
});

test("CMP-2 distinguishes insufficient partial coverage from infrastructure failure", () => {
  const partial = input();
  partial.candidate.campaigns.forEach((row) => { row.state = "RUNNING"; row.items.find((item) => item.scenarioId === "two")!.state = "JUDGING"; });
  const incomplete = evaluateVersionComparison(partial);
  assert.equal(incomplete.status, "INCOMPLETE");
  assert.equal(incomplete.coverageBps, 5_000);

  const failed = input();
  failed.candidate.campaigns[0].state = "FAILED";
  failed.candidate.campaigns[0].items[0].state = "FAILED";
  failed.candidate.campaigns[0].items[0].failure = "PROVIDER_ERROR";
  assert.equal(evaluateVersionComparison(failed).status, "INFRASTRUCTURE_ERROR");

  const malformed = input();
  malformed.candidate.campaigns[0].items[0].currentRunId = "not-a-digest";
  assert.equal(evaluateVersionComparison(malformed).status, "INFRASTRUCTURE_ERROR");
});

test("CMP-2 permits only the same covered scenario subset when the locked minimum allows partial coverage", () => {
  const value = input({ policy: policy({ minimumScenarioCoverageBps: 5_000 }) });
  for (const side of [value.baseline, value.candidate]) for (const row of side.campaigns) {
    row.state = "RUNNING"; row.items.find((item) => item.scenarioId === "two")!.state = "JUDGING";
  }
  const result = evaluateVersionComparison(value);
  assert.equal(result.status, "PASS");
  assert.equal(result.coverageBps, 5_000);
  assert.deepEqual(result.binding?.scenarioIds, ["one", "two"]);
  assert.deepEqual(result.binding?.evaluatedScenarioIds, ["one"]);
});

test("CMP-1 persists an immutable redacted comparison and restores it after restart", () => {
  const runtime = new SqliteRuntimeStore(":memory:");
  try {
    const first = new VersionComparisonRegistry(runtime);
    const result = first.compare(input());
    assert.equal(first.compare(input()).inputDigest, result.inputDigest);
    const restored = new VersionComparisonRegistry(runtime).get(result.comparisonId);
    assert.deepEqual(restored, result);
    assert.equal(JSON.stringify(restored).includes("agentsMd"), false);
    const conflict = input();
    conflict.candidate.campaigns[0].items[0].scorecard!.overall_score = 99;
    assert.throws(() => first.compare(conflict), /conflicting immutable/i);
  } finally {
    runtime.close();
  }
});
