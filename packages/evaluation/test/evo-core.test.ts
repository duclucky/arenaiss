import test from 'node:test';
import assert from 'node:assert/strict';
import { EVO_CORE_SCENARIOS, selectEvoCoreScenarios } from '../src/evo-core.ts';
import { validateEvaluationScenario } from '../src/protocol.ts';

test('Evo pool offers three valid variants for each of six capabilities', () => {
  assert.equal(EVO_CORE_SCENARIOS.length, 18);
  const counts = new Map<string, number>();
  for (const scenario of EVO_CORE_SCENARIOS) {
    validateEvaluationScenario(scenario);
    const category = scenario.scenarioId.split('_')[0];
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  assert.equal(counts.size, 6);
  assert.equal([...counts.values()].every((count) => count === 3), true);
});

test('Evo selection picks one scenario per capability and is reproducible for a cohort', () => {
  const first = selectEvoCoreScenarios('seed-a');
  assert.equal(first.length, 6);
  assert.equal(new Set(first.map((scenario) => scenario.scenarioId.split('_')[0])).size, 6);
  assert.deepEqual(selectEvoCoreScenarios('seed-a'), first);
  assert.notDeepEqual(selectEvoCoreScenarios('seed-b').map((scenario) => scenario.scenarioId), first.map((scenario) => scenario.scenarioId));
});
