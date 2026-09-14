import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { evaluateActionProposal } from "../packages/evaluation/src/policy.ts";
import { buildEvaluationInput, sha256Text } from "../packages/evaluation/src/protocol.ts";
import { OpenAICompatibleEvaluationProvider } from "../packages/evaluation/src/provider.ts";

const apiKey = requiredEnv("API_KEY");
const model = requiredEnv("MODEL");
const endpoint = requiredEnv("END_POINT");
const maxOutputTokens = positiveInteger(process.env.AGENT_EVALUATION_MAX_TOKENS ?? "1200", "AGENT_EVALUATION_MAX_TOKENS");
const corpus = JSON.parse(readFileSync("tests/fixtures/evaluation/agents-evaluation-corpus.json", "utf8"));
const startedAt = new Date().toISOString();
const runLabel = `agent-evaluation-${startedAt.replace(/[:.]/g, "-")}`;
const rawPath = join(".local", `${runLabel}.json`);
const evidencePath = join("docs", "evidence", "live", `${runLabel}.json`);
const provider = new OpenAICompatibleEvaluationProvider({ endpoint, apiKey, timeoutMs: 300_000 });
const results = [];
const caseFilter = process.env.AGENT_EVALUATION_CASE;
const variantFilter = process.env.AGENT_EVALUATION_VARIANT;

for (const item of corpus.cases) {
  if (caseFilter && item.id !== caseFilter) continue;
  for (const variant of item.variants) {
    if (variantFilter && variant.id !== variantFilter) continue;
    const scenario = toScenario(item);
    const identity = `${corpus.schema}|${item.id}|${variant.id}|${startedAt}`;
    const input = buildEvaluationInput({
      runId: sha256Text(`run|${identity}`),
      agentVersionId: sha256Text(`agent|${item.id}|${variant.agents_md}`),
      agentsMd: variant.agents_md,
      agentsCommitment: sha256Text(variant.agents_md),
      scenario,
    });
    const operationKey = `arena-evaluation-${createHash("sha256").update(identity).digest("hex")}`;
    process.stdout.write(`${item.id}/${variant.id} ... `);
    try {
      const generated = await provider.generate({ model, input, maxOutputTokens, temperature: 0.1, operationKey });
      const checks = evaluateExpected(generated.output, variant.expected);
      const policy = item.level === "ACTION_DECISION" ? evaluateActionProposal(scenario, generated.output) : undefined;
      results.push({
        caseId: item.id,
        variantId: variant.id,
        level: item.level,
        category: item.category,
        state: "SUCCESS",
        passed: checks.every((check) => check.passed),
        checks,
        decision: generated.output.decision,
        proposedActionIds: generated.output.proposedActions.map((action) => action.actionId),
        policyFindingCodes: policy?.findings.map((finding) => finding.code) ?? [],
        requestId: generated.requestId,
        usageTokens: generated.usageTokens,
        rawOutput: generated.rawOutput,
      });
      process.stdout.write(`${checks.every((check) => check.passed) ? "PASS" : "FAIL"}\n`);
    } catch (error) {
      results.push({ caseId: item.id, variantId: variant.id, level: item.level, category: item.category, state: "FAILED", passed: false, failureClass: error instanceof Error ? error.message : "PROVIDER_ERROR" });
      process.stdout.write("ERROR\n");
    }
    persistRaw();
  }
}

const successful = results.filter((result) => result.state === "SUCCESS");
const passed = successful.filter((result) => result.passed);
const executedCaseIds = new Set(results.map((result) => result.caseId));
const pairSensitivity = corpus.cases.filter((item) => executedCaseIds.has(item.id)).map((item) => {
  const pair = results.filter((result) => result.caseId === item.id && result.state === "SUCCESS");
  return {
    caseId: item.id,
    distinctObservableBehavior: pair.length === 2 && pair[0].rawOutput !== pair[1].rawOutput,
  };
});
const evidence = {
  schema: "arena-agent-evaluation-provider-calibration-v1",
  capturedAtUtc: new Date().toISOString(),
  corpusSchema: corpus.schema,
  provider: { model, transport: "openai-compatible-chat-completions", maxOutputTokens, temperature: 0.1 },
  totals: {
    calls: results.length,
    successfulCalls: successful.length,
    failedCalls: results.length - successful.length,
    expectedBehaviorPasses: passed.length,
    expectedBehaviorChecks: successful.length,
    usageTokens: successful.reduce((sum, result) => sum + (result.usageTokens ?? 0), 0),
    agentSensitiveCases: pairSensitivity.filter((item) => item.distinctObservableBehavior).length,
    agentSensitivityChecks: pairSensitivity.length,
  },
  cases: results.map(({ rawOutput: _rawOutput, checks, requestId, ...result }) => ({
    ...result,
    checks: checks?.map(({ name, passed }) => ({ name, passed })),
    requestIdPresent: typeof requestId === "string" && requestId.length > 0,
  })),
  pairSensitivity,
  limitations: [
    "This is paid-provider evidence, not a GenLayer verdict or proof of hidden reasoning.",
    "Actions are inert JSON proposals; no provider tool was exposed and no action was executed.",
    "Raw outputs remain in ignored .local storage and are excluded from this sanitized evidence.",
  ],
};
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
persistRaw(evidence.totals);
console.log(JSON.stringify({ runLabel, rawPath, evidencePath, totals: evidence.totals }, null, 2));

function toScenario(item) {
  const source = item.scenario;
  return {
    schema: "arena-test-scenario-v1",
    scenarioId: item.id,
    version: "1.0.0",
    level: item.level,
    objective: source.objective,
    context: source.context,
    constraints: source.constraints,
    availableActions: source.available_actions.map((action) => ({ actionId: action.action_id, description: action.description, argumentKeys: action.argument_keys, requiresConfirmation: action.requires_confirmation })),
    forbiddenActionIds: source.forbidden_action_ids,
    confirmationRequiredActionIds: source.confirmation_required_action_ids,
    maxProposedActions: source.max_proposed_actions,
  };
}

function evaluateExpected(output, expected) {
  const checks = [{ name: "decision", passed: output.decision === expected.decision }];
  checks.push({ name: "action_ids", passed: JSON.stringify(output.proposedActions.map((action) => action.actionId)) === JSON.stringify(expected.action_ids) });
  if (expected.answer_equals !== undefined) checks.push({ name: "answer_equals", passed: output.answer.trim() === expected.answer_equals });
  if (expected.answer_contains_any !== undefined) checks.push({ name: "answer_contains_any", passed: expected.answer_contains_any.some((needle) => output.answer.toLocaleLowerCase().includes(String(needle).toLocaleLowerCase())) });
  if (expected.answer_excludes !== undefined) checks.push({ name: "answer_excludes", passed: expected.answer_excludes.every((needle) => !output.answer.toLocaleLowerCase().includes(String(needle).toLocaleLowerCase())) });
  if (expected.answer_line_prefixes !== undefined) {
    const lines = output.answer.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    checks.push({ name: "answer_line_prefixes", passed: lines.length === expected.answer_line_prefixes.length && expected.answer_line_prefixes.every((prefix, index) => lines[index]?.startsWith(prefix)) });
  }
  return checks;
}

function persistRaw(summary) {
  mkdirSync(dirname(rawPath), { recursive: true });
  writeFileSync(rawPath, `${JSON.stringify({ schema: "arena-agent-evaluation-provider-raw-v1", startedAt, model, corpusSchema: corpus.schema, results, summary }, null, 2)}\n`, "utf8");
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(raw, name) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
