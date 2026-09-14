import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

if (process.argv.length < 4) throw new Error("usage: node scripts/summarize-evaluation-calibration.mjs <raw-primary> <raw-retry> [...]");
const corpus = JSON.parse(readFileSync("tests/fixtures/evaluation/agents-evaluation-corpus.json", "utf8"));
const sources = process.argv.slice(2).map((path) => {
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes.toString("utf8")), sha256: sha256(bytes) };
});
const attempts = sources.flatMap((source) => source.value.results.map((result) => ({ ...result, sourceSha256: source.sha256 })));
const selected = [];

for (const item of corpus.cases) {
  for (const variant of item.variants) {
    const candidates = attempts.filter((attempt) => attempt.caseId === item.id && attempt.variantId === variant.id);
    const success = [...candidates].reverse().find((attempt) => attempt.state === "SUCCESS" && typeof attempt.rawOutput === "string");
    if (!success) {
      selected.push({ caseId: item.id, variantId: variant.id, state: "UNRESOLVED", passed: false, attempts: candidates.length });
      continue;
    }
    const output = JSON.parse(success.rawOutput);
    const checks = evaluateExpected(output, variant.expected);
    selected.push({
      caseId: item.id,
      variantId: variant.id,
      level: item.level,
      category: item.category,
      state: "SUCCESS",
      passed: checks.every((check) => check.passed),
      checks,
      decision: output.decision,
      proposedActionIds: output.proposed_actions.map((action) => action.action_id),
      outputSha256: sha256(Buffer.from(success.rawOutput, "utf8")),
      attempts: candidates.length,
      recoveredAfterInvalidOutput: candidates.some((attempt) => attempt.failureClass === "INVALID_OUTPUT"),
      usageTokens: success.usageTokens,
    });
  }
}

const pairSensitivity = corpus.cases.map((item) => {
  const pair = selected.filter((result) => result.caseId === item.id && result.state === "SUCCESS");
  return { caseId: item.id, distinctObservableOutputs: pair.length === 2 && pair[0].outputSha256 !== pair[1].outputSha256 };
});
const evidence = {
  schema: "arena-agent-evaluation-provider-calibration-v1",
  capturedAtUtc: new Date().toISOString(),
  corpusSchema: corpus.schema,
  provider: { model: sources[0].value.model, transport: "openai-compatible-chat-completions", maxOutputTokens: sources[0].value.maxOutputTokens ?? 1200, temperature: 0.1 },
  totals: {
    providerAttempts: attempts.length,
    selectedRuns: selected.length,
    successfulSelectedRuns: selected.filter((result) => result.state === "SUCCESS").length,
    expectedBehaviorPasses: selected.filter((result) => result.passed).length,
    invalidOutputAttempts: attempts.filter((attempt) => attempt.failureClass === "INVALID_OUTPUT").length,
    recoveredRuns: selected.filter((result) => result.recoveredAfterInvalidOutput).length,
    distinctAgentVariantPairs: pairSensitivity.filter((item) => item.distinctObservableOutputs).length,
    pairChecks: pairSensitivity.length,
  },
  sourceRawEvidenceSha256: sources.map((source) => source.sha256),
  selectedRuns: selected,
  pairSensitivity,
  limitations: [
    "Paid-provider calibration demonstrates observable instruction sensitivity, not hidden reasoning or authenticated provider provenance.",
    "One malformed structured output was classified separately and recovered with one bounded retry; it was not scored as Agent failure.",
    "Actions are inert JSON proposals; no tool or external action was exposed or executed.",
    "Raw response bodies remain under ignored .local storage.",
  ],
};
writeFileSync("docs/evidence/live/agent-evaluation-provider-calibration-v1.json", `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify(evidence.totals, null, 2));

function evaluateExpected(output, expected) {
  const checks = [{ name: "decision", passed: output.decision === expected.decision }];
  checks.push({ name: "action_ids", passed: JSON.stringify(output.proposed_actions.map((action) => action.action_id)) === JSON.stringify(expected.action_ids) });
  if (expected.answer_equals !== undefined) checks.push({ name: "answer_equals", passed: output.answer.trim() === expected.answer_equals });
  if (expected.answer_contains_any !== undefined) checks.push({ name: "answer_contains_any", passed: expected.answer_contains_any.some((needle) => output.answer.toLocaleLowerCase().includes(String(needle).toLocaleLowerCase())) });
  if (expected.answer_excludes !== undefined) checks.push({ name: "answer_excludes", passed: expected.answer_excludes.every((needle) => !output.answer.toLocaleLowerCase().includes(String(needle).toLocaleLowerCase())) });
  if (expected.answer_line_prefixes !== undefined) {
    const lines = output.answer.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    checks.push({ name: "answer_line_prefixes", passed: lines.length === expected.answer_line_prefixes.length && expected.answer_line_prefixes.every((prefix, index) => lines[index]?.startsWith(prefix)) });
  }
  return checks;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
