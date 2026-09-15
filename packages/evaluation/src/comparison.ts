import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { SqliteRuntimeStore } from "../../persistence/src/sqlite-runtime.ts";
import type { SoloCampaignItem, SoloCampaignRecord } from "./solo-runner.ts";

export const COMPARISON_DIMENSIONS = [
  "instruction_adherence",
  "reasoning_quality",
  "action_selection",
  "rule_compliance",
  "task_completion",
  "safety",
] as const;

export type ComparisonDimension = typeof COMPARISON_DIMENSIONS[number];

export interface RegressionPolicy {
  schema: "arena-regression-policy-v1";
  requiredRunsPerScenario: number;
  minimumScenarioCoverageBps: number;
  maximumOverallDrop: number;
  maximumDimensionDrop: number;
  maximumOverallSpread: number;
  maximumDimensionSpread: number;
  minimumDimensionScores: Partial<Record<ComparisonDimension, number>>;
  criticalFindingCodes: string[];
}

export interface VersionComparisonInput {
  schema: "arena-version-comparison-input-v1";
  comparisonId: `sha256:${string}`;
  agentId: `sha256:${string}`;
  baseline: { versionId: `sha256:${string}`; campaigns: SoloCampaignRecord[] };
  candidate: { versionId: `sha256:${string}`; campaigns: SoloCampaignRecord[] };
  policy: RegressionPolicy;
}

export interface VersionAggregate {
  overallScore: number;
  overallSpread: number;
  dimensions: Record<ComparisonDimension, number | null>;
  dimensionSpreads: Record<ComparisonDimension, number | null>;
}

export interface ComparisonFinding {
  code: string;
  dimension?: ComparisonDimension;
  observed?: number;
  threshold?: number;
}

export interface VersionComparisonRecord {
  schema: "arena-version-comparison-v1";
  comparisonId: string;
  inputDigest: string;
  status: "PASS" | "REGRESSION" | "INCOMPARABLE" | "INCOMPLETE" | "INFRASTRUCTURE_ERROR" | "UNSTABLE";
  agentId: string;
  baselineVersionId: string;
  candidateVersionId: string;
  coverageBps: number;
  findings: ComparisonFinding[];
  baseline?: VersionAggregate;
  candidate?: VersionAggregate;
  binding?: {
    packId: string;
    packVersion: string;
    rubricVersion: string;
    runtimePolicy: SoloCampaignRecord["runtimePolicy"];
    scenarioIds: string[];
    evaluatedScenarioIds: string[];
    requiredRunsPerScenario: number;
  };
  sourceCampaignIds: { baseline: string[]; candidate: string[] };
  sourceRunIds: { baseline: string[]; candidate: string[] };
}

export function evaluateVersionComparison(_input: VersionComparisonInput): VersionComparisonRecord {
  const input = validateInput(_input);
  const base = baseRecord(input);
  if (input.baseline.versionId === input.candidate.versionId) return terminal(base, "INCOMPARABLE", "VERSION_NOT_ISOLATED");

  const campaignIds = [...input.baseline.campaigns, ...input.candidate.campaigns].map((row) => row.campaignId);
  if (new Set(campaignIds).size !== campaignIds.length) return terminal(base, "INCOMPARABLE", "CAMPAIGN_NOT_ISOLATED");
  const runIds = [...base.sourceRunIds.baseline, ...base.sourceRunIds.candidate];
  if (new Set(runIds).size !== runIds.length) return terminal(base, "INCOMPARABLE", "RUN_NOT_ISOLATED");

  const baselineReference = input.baseline.campaigns[0];
  const candidateReference = input.candidate.campaigns[0];
  const mismatch = firstBindingMismatch(input, baselineReference, candidateReference);
  if (mismatch) return terminal(base, "INCOMPARABLE", mismatch);

  const scenarioIds = canonicalScenarios(baselineReference).map((row) => row.scenarioId);
  const binding = {
    packId: baselineReference.testPack.packId,
    packVersion: baselineReference.testPack.version,
    rubricVersion: baselineReference.rubricVersion,
    runtimePolicy: structuredClone(baselineReference.runtimePolicy),
    scenarioIds,
    evaluatedScenarioIds: [] as string[],
    requiredRunsPerScenario: input.policy.requiredRunsPerScenario,
  };
  const withBinding = { ...base, binding };

  if (hasInfrastructureFailure(input.baseline.campaigns) || hasInfrastructureFailure(input.candidate.campaigns)) {
    return terminal(withBinding, "INFRASTRUCTURE_ERROR", "INFRASTRUCTURE_FAILURE");
  }

  let baselineFinal: Map<string, FinalizedRow[]>;
  let candidateFinal: Map<string, FinalizedRow[]>;
  try {
    baselineFinal = finalizedByScenario(input.baseline.campaigns, input.baseline.versionId);
    candidateFinal = finalizedByScenario(input.candidate.campaigns, input.candidate.versionId);
  } catch {
    return terminal(withBinding, "INFRASTRUCTURE_ERROR", "INVALID_FINAL_SCORECARD");
  }
  const baselineCovered = scenarioIds.filter((id) => baselineFinal.get(id)?.length === input.policy.requiredRunsPerScenario);
  const candidateCovered = scenarioIds.filter((id) => candidateFinal.get(id)?.length === input.policy.requiredRunsPerScenario);
  const commonlyCovered = baselineCovered.filter((id) => candidateCovered.includes(id));
  const coverageBps = Math.floor(commonlyCovered.length * 10_000 / scenarioIds.length);
  const coveredBinding = { ...binding, evaluatedScenarioIds: commonlyCovered };
  const coveredRecord = { ...base, binding: coveredBinding, coverageBps };
  if (!isDeepStrictEqual(baselineCovered, candidateCovered)) return terminal(coveredRecord, "INCOMPLETE", "ASYMMETRIC_SCENARIO_COVERAGE");
  if (coverageBps < input.policy.minimumScenarioCoverageBps) return terminal(coveredRecord, "INCOMPLETE", "MINIMUM_SCENARIO_COVERAGE");

  const baselineRows = commonlyCovered.flatMap((id) => baselineFinal.get(id)!);
  const candidateRows = commonlyCovered.flatMap((id) => candidateFinal.get(id)!);
  const digestMismatch = scenarioDigestMismatch(baselineRows, candidateRows, commonlyCovered);
  if (digestMismatch) return terminal(coveredRecord, "INCOMPARABLE", "SCENARIO_DIGEST_MISMATCH");

  let baseline: VersionAggregate;
  let candidate: VersionAggregate;
  try {
    baseline = aggregate(baselineRows, input.baseline.versionId, baselineReference.rubricVersion);
    candidate = aggregate(candidateRows, input.candidate.versionId, baselineReference.rubricVersion);
  } catch {
    return terminal(coveredRecord, "INFRASTRUCTURE_ERROR", "INVALID_FINAL_SCORECARD");
  }

  const aggregated = { ...coveredRecord, baseline, candidate };
  const varianceFindings = varianceFailures(baseline, candidate, input.policy);
  if (varianceFindings.length) return { ...aggregated, status: "UNSTABLE", findings: varianceFindings };

  const findings = regressionFailures(candidateRows, baseline, candidate, input.policy);
  return { ...aggregated, status: findings.length ? "REGRESSION" : "PASS", findings };
}

type FinalizedRow = { scenarioId: string; runId: string; scorecard: Record<string, any> };

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const FINDING_CODE = /^[A-Z][A-Z0-9_]{0,95}$/;
const GRADE_POINTS: Record<string, number> = { EXCELLENT: 100, GOOD: 80, MIXED: 60, POOR: 30, FAIL: 0 };

function validateInput(input: VersionComparisonInput): VersionComparisonInput {
  if (input?.schema !== "arena-version-comparison-input-v1" || !DIGEST.test(input.comparisonId) || !DIGEST.test(input.agentId)) throw new TypeError("comparison identity is invalid");
  for (const side of [input.baseline, input.candidate]) {
    if (!DIGEST.test(side?.versionId) || !Array.isArray(side.campaigns) || side.campaigns.length < 1 || side.campaigns.length > 20) throw new TypeError("comparison cohort is invalid");
  }
  const policy = input.policy;
  if (policy?.schema !== "arena-regression-policy-v1"
    || !integerBetween(policy.requiredRunsPerScenario, 1, 20)
    || !integerBetween(policy.minimumScenarioCoverageBps, 1, 10_000)
    || !integerBetween(policy.maximumOverallDrop, 0, 100)
    || !integerBetween(policy.maximumDimensionDrop, 0, 100)
    || !integerBetween(policy.maximumOverallSpread, 0, 100)
    || !integerBetween(policy.maximumDimensionSpread, 0, 100)) throw new TypeError("regression policy is invalid");
  const minimums = policy.minimumDimensionScores;
  if (!minimums || typeof minimums !== "object" || Array.isArray(minimums)
    || Object.entries(minimums).some(([key, value]) => !COMPARISON_DIMENSIONS.includes(key as ComparisonDimension) || !integerBetween(value, 0, 100))) throw new TypeError("dimension minimum policy is invalid");
  if (!Array.isArray(policy.criticalFindingCodes) || policy.criticalFindingCodes.length > 32
    || new Set(policy.criticalFindingCodes).size !== policy.criticalFindingCodes.length
    || policy.criticalFindingCodes.some((code) => typeof code !== "string" || !FINDING_CODE.test(code))) throw new TypeError("critical finding policy is invalid");
  return structuredClone(input);
}

function integerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function baseRecord(input: VersionComparisonInput): VersionComparisonRecord {
  return {
    schema: "arena-version-comparison-v1",
    comparisonId: input.comparisonId,
    inputDigest: `sha256:${createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex")}`,
    status: "INCOMPLETE",
    agentId: input.agentId,
    baselineVersionId: input.baseline.versionId,
    candidateVersionId: input.candidate.versionId,
    coverageBps: 0,
    findings: [],
    sourceCampaignIds: { baseline: input.baseline.campaigns.map((row) => row.campaignId), candidate: input.candidate.campaigns.map((row) => row.campaignId) },
    sourceRunIds: { baseline: allRunIds(input.baseline.campaigns), candidate: allRunIds(input.candidate.campaigns) },
  };
}

function terminal(record: VersionComparisonRecord, status: VersionComparisonRecord["status"], code: string): VersionComparisonRecord {
  return { ...record, status, findings: [{ code }] };
}

function allRunIds(campaigns: SoloCampaignRecord[]): string[] {
  return campaigns.flatMap((campaign) => campaign.items.flatMap((item) => item.runIds));
}

function firstBindingMismatch(input: VersionComparisonInput, baseline: SoloCampaignRecord, candidate: SoloCampaignRecord): string | undefined {
  if (input.baseline.campaigns.length !== input.policy.requiredRunsPerScenario || input.candidate.campaigns.length !== input.policy.requiredRunsPerScenario) return "REQUIRED_RUN_COUNT_MISMATCH";
  if (input.baseline.campaigns.some((row) => row.agent.versionId !== input.baseline.versionId) || input.candidate.campaigns.some((row) => row.agent.versionId !== input.candidate.versionId)) return "CAMPAIGN_VERSION_MISMATCH";
  if ([...input.baseline.campaigns, ...input.candidate.campaigns].some((row) => row.owner !== baseline.owner)) return "OWNER_MISMATCH";
  if ([...input.baseline.campaigns, ...input.candidate.campaigns].some((row) => row.testPack.packId !== baseline.testPack.packId)) return "PACK_ID_MISMATCH";
  if ([...input.baseline.campaigns, ...input.candidate.campaigns].some((row) => row.testPack.version !== baseline.testPack.version)) return "PACK_VERSION_MISMATCH";
  if ([...input.baseline.campaigns, ...input.candidate.campaigns].some((row) => !isDeepStrictEqual(canonicalScenarios(row), canonicalScenarios(baseline)))) return "SCENARIO_SET_MISMATCH";
  if ([...input.baseline.campaigns, ...input.candidate.campaigns].some((row) => !campaignItemsMatchScenarios(row))) return "CAMPAIGN_SCENARIO_ITEMS_MISMATCH";
  if ([...input.baseline.campaigns, ...input.candidate.campaigns].some((row) => !isDeepStrictEqual(row.runtimePolicy, baseline.runtimePolicy))) return "RUNTIME_POLICY_MISMATCH";
  if ([...input.baseline.campaigns, ...input.candidate.campaigns].some((row) => row.rubricVersion !== baseline.rubricVersion)) return "SCORING_VERSION_MISMATCH";
  if (!isDeepStrictEqual(canonicalScenarios(candidate), canonicalScenarios(baseline))) return "SCENARIO_SET_MISMATCH";
  return undefined;
}

function canonicalScenarios(campaign: SoloCampaignRecord): SoloCampaignRecord["testPack"]["scenarios"] {
  return structuredClone(campaign.testPack.scenarios).sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
}

function campaignItemsMatchScenarios(campaign: SoloCampaignRecord): boolean {
  const expected = canonicalScenarios(campaign).map((scenario) => scenario.scenarioId);
  const actual = campaign.items.map((item) => item.scenarioId).sort((a, b) => a.localeCompare(b));
  return new Set(actual).size === actual.length && isDeepStrictEqual(actual, expected);
}

function hasInfrastructureFailure(campaigns: SoloCampaignRecord[]): boolean {
  return campaigns.some((campaign) => campaign.state === "FAILED" || campaign.items.some((item) => item.state === "FAILED"));
}

function finalizedByScenario(campaigns: SoloCampaignRecord[], versionId: string): Map<string, FinalizedRow[]> {
  const result = new Map<string, FinalizedRow[]>();
  for (const campaign of campaigns) {
    for (const item of campaign.items) {
      if (item.state !== "FINALIZED") continue;
      const row = finalizedRow(item, versionId);
      const prior = result.get(item.scenarioId) ?? [];
      result.set(item.scenarioId, [...prior, row]);
    }
  }
  return result;
}

function finalizedRow(item: SoloCampaignItem, versionId: string): FinalizedRow {
  const runId = item.currentRunId ?? item.runIds.at(-1);
  if (!runId || !DIGEST.test(runId) || !item.scorecard || item.scorecard.agent_version_id !== versionId) throw new Error("invalid finalized comparison row");
  return { scenarioId: item.scenarioId, runId, scorecard: item.scorecard };
}

function scenarioDigestMismatch(baseline: FinalizedRow[], candidate: FinalizedRow[], scenarioIds: string[]): boolean {
  for (const scenarioId of scenarioIds) {
    const digests = [...baseline, ...candidate].filter((row) => row.scenarioId === scenarioId).map((row) => row.scorecard.scenario_digest);
    if (digests.some((digest) => typeof digest !== "string" || !DIGEST.test(digest)) || new Set(digests).size !== 1) return true;
  }
  return false;
}

function aggregate(rows: FinalizedRow[], versionId: string, rubricVersion: string): VersionAggregate {
  const overallValues: number[] = [];
  const values = Object.fromEntries(COMPARISON_DIMENSIONS.map((dimension) => [dimension, [] as number[]])) as Record<ComparisonDimension, number[]>;
  const scenarioOverall = new Map<string, number[]>();
  const scenarioDimensions = new Map<string, Record<ComparisonDimension, number[]>>();
  for (const row of rows) {
    const scorecard = row.scorecard;
    if (scorecard?.status !== "FINAL" || scorecard.agent_version_id !== versionId || scorecard.rubric_version !== rubricVersion || scorecard.actions_executed !== false || !integerBetween(scorecard.overall_score, 0, 100) || !Array.isArray(scorecard.dimensions)) throw new Error("invalid scorecard");
    if (!Array.isArray(scorecard.policy_findings) || scorecard.policy_findings.some((finding: any) => !finding || typeof finding.code !== "string" || !FINDING_CODE.test(finding.code))) throw new Error("invalid policy findings");
    overallValues.push(scorecard.overall_score);
    scenarioOverall.set(row.scenarioId, [...(scenarioOverall.get(row.scenarioId) ?? []), scorecard.overall_score]);
    const perScenario = scenarioDimensions.get(row.scenarioId) ?? Object.fromEntries(COMPARISON_DIMENSIONS.map((dimension) => [dimension, [] as number[]])) as Record<ComparisonDimension, number[]>;
    if (scorecard.dimensions.length !== COMPARISON_DIMENSIONS.length) throw new Error("invalid dimensions");
    for (const dimension of COMPARISON_DIMENSIONS) {
      const matching = scorecard.dimensions.filter((item: any) => item?.dimension_id === dimension);
      if (matching.length !== 1) throw new Error("invalid dimension coverage");
      const grade = matching[0].grade;
      if (grade === "NOT_APPLICABLE") continue;
      if (!(grade in GRADE_POINTS)) throw new Error("invalid dimension grade");
      values[dimension].push(GRADE_POINTS[grade]);
      perScenario[dimension].push(GRADE_POINTS[grade]);
    }
    scenarioDimensions.set(row.scenarioId, perScenario);
  }
  return {
    overallScore: mean(overallValues),
    overallSpread: Math.max(...[...scenarioOverall.values()].map(spread)),
    dimensions: Object.fromEntries(COMPARISON_DIMENSIONS.map((dimension) => [dimension, values[dimension].length ? mean(values[dimension]) : null])) as Record<ComparisonDimension, number | null>,
    dimensionSpreads: Object.fromEntries(COMPARISON_DIMENSIONS.map((dimension) => {
      const scenarioSpreads = [...scenarioDimensions.values()].map((row) => row[dimension]).filter((row) => row.length).map(spread);
      return [dimension, scenarioSpreads.length ? Math.max(...scenarioSpreads) : null];
    })) as Record<ComparisonDimension, number | null>,
  };
}

function mean(values: number[]): number {
  if (!values.length) throw new Error("aggregate is empty");
  return Math.floor(values.reduce((sum, value) => sum + value, 0) * 100 / values.length) / 100;
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function varianceFailures(baseline: VersionAggregate, candidate: VersionAggregate, policy: RegressionPolicy): ComparisonFinding[] {
  const findings: ComparisonFinding[] = [];
  for (const [side, aggregateValue] of [["BASELINE", baseline], ["CANDIDATE", candidate]] as const) {
    if (aggregateValue.overallSpread > policy.maximumOverallSpread) findings.push({ code: "OVERALL_VARIANCE_EXCEEDED", observed: aggregateValue.overallSpread, threshold: policy.maximumOverallSpread });
    for (const dimension of COMPARISON_DIMENSIONS) {
      const observed = aggregateValue.dimensionSpreads[dimension];
      if (observed !== null && observed > policy.maximumDimensionSpread) findings.push({ code: `${side}_DIMENSION_VARIANCE_EXCEEDED`, dimension, observed, threshold: policy.maximumDimensionSpread });
    }
  }
  return findings;
}

function regressionFailures(candidateRows: FinalizedRow[], baseline: VersionAggregate, candidate: VersionAggregate, policy: RegressionPolicy): ComparisonFinding[] {
  const findings: ComparisonFinding[] = [];
  const critical = new Set(policy.criticalFindingCodes);
  const presentCritical = new Set<string>();
  for (const row of candidateRows) {
    for (const finding of row.scorecard.policy_findings) if (finding && critical.has(finding.code)) presentCritical.add(finding.code);
  }
  for (const code of [...presentCritical].sort()) findings.push({ code: "CRITICAL_POLICY_FINDING" });
  if (baseline.overallScore - candidate.overallScore > policy.maximumOverallDrop) findings.push({ code: "OVERALL_SCORE_DROP", observed: baseline.overallScore - candidate.overallScore, threshold: policy.maximumOverallDrop });
  for (const dimension of COMPARISON_DIMENSIONS) {
    const baselineScore = baseline.dimensions[dimension];
    const candidateScore = candidate.dimensions[dimension];
    const minimum = policy.minimumDimensionScores[dimension];
    if (minimum !== undefined && (candidateScore === null || candidateScore < minimum)) findings.push({ code: "DIMENSION_MINIMUM", dimension, ...(candidateScore === null ? {} : { observed: candidateScore }), threshold: minimum });
    if (baselineScore !== null && candidateScore !== null && baselineScore - candidateScore > policy.maximumDimensionDrop) findings.push({ code: "DIMENSION_SCORE_DROP", dimension, observed: baselineScore - candidateScore, threshold: policy.maximumDimensionDrop });
  }
  return findings;
}

export class VersionComparisonRegistry {
  private readonly memory = new Map<string, VersionComparisonRecord>();
  private readonly runtime?: SqliteRuntimeStore;

  constructor(runtime?: SqliteRuntimeStore) {
    this.runtime = runtime;
  }

  compare(input: VersionComparisonInput): VersionComparisonRecord {
    const result = evaluateVersionComparison(input);
    const existing = this.get(result.comparisonId);
    if (existing) {
      if (!isDeepStrictEqual(existing, result)) throw new Error("conflicting immutable version comparison");
      return existing;
    }
    this.memory.set(result.comparisonId, structuredClone(result));
    this.runtime?.put("evaluation-version-comparisons", result.comparisonId, result);
    return structuredClone(result);
  }

  get(comparisonId: string): VersionComparisonRecord | undefined {
    const result = this.memory.get(comparisonId) ?? this.runtime?.get<VersionComparisonRecord>("evaluation-version-comparisons", comparisonId);
    return result ? structuredClone(result) : undefined;
  }

  list(): VersionComparisonRecord[] {
    const records = this.runtime?.list<VersionComparisonRecord>("evaluation-version-comparisons") ?? [...this.memory.values()];
    return records.map((record) => structuredClone(record));
  }
}
