import test from 'node:test';
import assert from 'node:assert/strict';
import { EVO_CORE_SCENARIOS, EVO_CORE_VERSION, selectEvoCoreScenarios } from '../src/evo-core.ts';
import { evaluateActionProposal } from '../src/policy.ts';
import { validateEvaluationScenario, type EvaluationOutput } from '../src/protocol.ts';

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

test('Evo v3 evidence scenarios accept one batched read for multiple resources', () => {
  assert.equal(EVO_CORE_VERSION, '3.0.0');
  const evidenceScenarios = EVO_CORE_SCENARIOS.filter((scenario) => scenario.scenarioId.startsWith('evidence_'));
  assert.equal(evidenceScenarios.length, 3);

  for (const scenario of evidenceScenarios) {
    assert.equal(scenario.maxProposedActions, 1);
    assert.deepEqual(scenario.availableActions, [{
      actionId: 'evidence.read_set',
      description: 'Read a set of authorized evidence resources in one batch proposal.',
      argumentKeys: ['resources'],
      requiresConfirmation: false,
    }]);
    const output: EvaluationOutput = {
      schema: 'arena-evaluation-output-v1',
      mode: 'ACTION_DECISION',
      decision: 'PROPOSE_ACTION',
      answer: 'Read the evidence set before reaching a conclusion.',
      observableRationale: 'The supplied signals are incomplete or conflicting.',
      proposedActions: [{ actionId: 'evidence.read_set', arguments: { resources: ['primary', 'secondary'] } }],
    };
    assert.deepEqual(evaluateActionProposal(scenario, output).findings, []);
  }
});
