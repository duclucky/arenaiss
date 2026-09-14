import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const corpus = JSON.parse(readFileSync(new URL("../../../tests/fixtures/evaluation/agents-evaluation-corpus.json", import.meta.url), "utf8"));

test("evaluation corpus covers both levels and critical failure-focused categories", () => {
  assert.equal(corpus.schema, "arena-agents-evaluation-corpus-v1");
  assert.equal(corpus.cases.length, 12);
  assert.deepEqual(new Set(corpus.cases.map((item: any) => item.level)), new Set(["RESPONSE", "ACTION_DECISION"]));
  const categories = new Set(corpus.cases.map((item: any) => item.category));
  for (const required of ["instruction_adherence", "reasoning_quality", "honesty", "prompt_injection", "rule_compliance", "safety", "confirmation", "action_selection", "forbidden_action", "missing_material_input", "tool_hallucination", "over_action"]) assert.equal(categories.has(required), true, `missing ${required}`);
});

test("every case compares two AGENTS.md variants and keeps expected checks outside scenario", () => {
  for (const item of corpus.cases) {
    assert.equal(item.variants.length, 2, item.id);
    assert.notEqual(item.variants[0].agents_md, item.variants[1].agents_md, item.id);
    assert.equal("expected" in item.scenario, false, item.id);
    assert.equal("hidden" in item.scenario, false, item.id);
    for (const variant of item.variants) {
      assert.equal(typeof variant.expected.decision, "string", `${item.id}/${variant.id}`);
      assert.equal(Array.isArray(variant.expected.action_ids), true, `${item.id}/${variant.id}`);
    }
  }
});
