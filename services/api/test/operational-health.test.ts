import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationalHealthRegistry } from '../src/operational-health.ts';

test('optional disabled workers do not affect readiness and configured workers get startup grace', () => {
  let now = 1_000;
  const health = new OperationalHealthRegistry(() => now);
  assert.deepEqual(health.readiness(), { ready: true, components: {} });
  health.register('evaluation', 1_000);
  assert.deepEqual(health.readiness(), { ready: true, components: { evaluation: 'STARTING' } });
  now = 3_001;
  assert.deepEqual(health.readiness(), { ready: false, components: { evaluation: 'DEGRADED' } });
});

test('worker heartbeat recovers from failure and becomes degraded only after stale threshold', () => {
  let now = 1_000;
  const health = new OperationalHealthRegistry(() => now);
  health.register('pair', 1_000);
  health.success('pair');
  health.failure('pair');
  assert.equal(health.readiness().ready, false);
  now = 1_500; health.success('pair');
  assert.equal(health.readiness().ready, true);
  now = 9_501;
  assert.equal(health.readiness().ready, false);
});
