import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import { runDailyTournamentTick, summarizeTournamentRecovery } from '../src/daily-tournament.ts';
import type { CreateTournamentOperation, TournamentOperationSnapshot, TournamentOperationsPort } from '../src/tournament-operations.ts';

const midnight = Date.UTC(2026, 8, 17) / 1_000;

class FakeOperations implements TournamentOperationsPort {
  records = new Map<string, { input: CreateTournamentOperation; state: TournamentOperationSnapshot['state']; message?: string }>();
  actions: string[] = [];
  async list() { return Promise.all([...this.records].map(([id]) => this.get(id) as Promise<TournamentOperationSnapshot>)); }
  async get(id: string) {
    const row = this.records.get(id);
    return row ? { tournamentId: id, name: row.input.name, state: row.state, entrantCount: 8, matchCount: 12, finalizedMatchCount: 0, ...(row.message ? { message: row.message } : {}), nextActions: row.state === 'SETTLEMENT_PENDING' ? ['SETTLE'] as const : row.state === 'COMPLETED' || row.state === 'REFUNDED' ? [] as const : ['PROGRESS', 'REFUND', 'EXPIRE'] as const } : null;
  }
  async create(input: CreateTournamentOperation) {
    this.actions.push(`CREATE:${input.startsAt}`);
    this.records.set(input.tournamentId, { input, state: 'REGISTRATION' });
    return (await this.get(input.tournamentId))!;
  }
  async execute({ tournamentId, action }: { tournamentId: string; action: 'PROGRESS' | 'SETTLE' | 'EXPIRE' | 'REFUND' }) {
    this.actions.push(action);
    const row = this.records.get(tournamentId)!;
    if (action === 'SETTLE') row.state = 'COMPLETED';
    else if (action === 'REFUND' || action === 'EXPIRE') row.state = 'REFUNDED';
    else row.state = 'WAITING_FOR_JUDGE';
    return (await this.get(tournamentId))!;
  }
}

test('daily tournament registers until next 00:00 UTC, progresses once, and waits for a final result before opening the next', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const operations = new FakeOperations();
    const first = await runDailyTournamentTick(runtime, operations, midnight - 3_600, '1000000');
    assert.equal(first?.state, 'REGISTRATION');
    const input = operations.records.get(first!.tournamentId)!.input;
    assert.equal(input.registrationOpensAt, midnight - 3_600);
    assert.equal(input.registrationClosesAt, midnight);
    assert.equal(input.startsAt, midnight);
    assert.equal(input.minEntrants, 8);
    assert.equal(input.maxEntrants, 32);
    await runDailyTournamentTick(runtime, operations, midnight - 1, '1000000');
    assert.deepEqual(operations.actions, [`CREATE:${midnight}`]);
    await runDailyTournamentTick(runtime, operations, midnight, '1000000');
    assert.deepEqual(operations.actions, [`CREATE:${midnight}`, 'PROGRESS']);
    await runDailyTournamentTick(runtime, operations, midnight + 86_400, '1000000');
    assert.equal(operations.records.size, 1);
    operations.records.get(first!.tournamentId)!.state = 'SETTLEMENT_PENDING';
    const next = await runDailyTournamentTick(runtime, operations, midnight + 86_400 + 60, '1000000');
    assert.equal(operations.records.get(first!.tournamentId)!.state, 'COMPLETED');
    assert.equal(next?.state, 'REGISTRATION');
    assert.equal(operations.records.get(next!.tournamentId)!.input.startsAt, midnight + 2 * 86_400);
  } finally { runtime.close(); }
});

test('daily tournament recovers a persisted create intent and never opens another while refund is pending', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const operations = new FakeOperations();
    const first = await runDailyTournamentTick(runtime, operations, midnight - 60, '1000000');
    operations.records.delete(first!.tournamentId);
    await runDailyTournamentTick(runtime, operations, midnight - 30, '1000000');
    assert.equal(operations.records.size, 1);
    assert.equal(operations.records.get(first!.tournamentId)!.input.registrationOpensAt, midnight - 60);
    operations.records.get(first!.tournamentId)!.state = 'REFUND_PENDING';
    await runDailyTournamentTick(runtime, operations, midnight + 1, '1000000');
    assert.equal(operations.records.get(first!.tournamentId)!.state, 'REFUNDED');
    assert.equal(operations.records.size, 2);
  } finally { runtime.close(); }
});

test('recovery diagnostic reports persisted side and submission states without provider output', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const attempt = `sha256:${'a'.repeat(64)}`;
    runtime.put('evaluation-tournament-provider-runs', `${attempt}:A`, { rawOutput: 'PRIVATE', fingerprint: 'fingerprint' });
    runtime.put('comparison-submissions', `sha256:${'b'.repeat(64)}:${attempt}`, { key: `sha256:${'b'.repeat(64)}:${attempt}`, state: 'SUBMISSION_PERSISTED', submission: { responseJsonA: 'PRIVATE' } });
    assert.deepEqual(summarizeTournamentRecovery(runtime, `Runner requires recovery for attempt ${attempt}.`), {
      attemptId: attempt,
      reasonCode: 'UNKNOWN',
      providerA: true,
      providerB: false,
      fallbackSelected: false,
      comparisonState: 'SUBMISSION_PERSISTED',
      comparisonHashRecorded: false,
    });
  } finally { runtime.close(); }
});

test('daily worker retries one-sided provider output with a cooldown but never replays a judge submission', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const operations = new FakeOperations();
    const first = await runDailyTournamentTick(runtime, operations, midnight - 60, '1000000');
    const attempt = `sha256:${'a'.repeat(64)}`;
    const match = `sha256:${'b'.repeat(64)}`;
    const row = operations.records.get(first!.tournamentId)!;
    row.state = 'RECOVERY_REQUIRED';
    row.message = `Runner requires recovery for attempt ${attempt}.`;
    runtime.put('evaluation-tournament-provider-runs', `${attempt}:A`, { fingerprint: 'saved', rawOutput: 'PRIVATE' });
    await runDailyTournamentTick(runtime, operations, midnight + 1, '1000000');
    assert.deepEqual(operations.actions.slice(-1), ['PROGRESS']);
    const previousCount = operations.actions.length;
    row.state = 'RECOVERY_REQUIRED';
    await runDailyTournamentTick(runtime, operations, midnight + 2, '1000000');
    assert.equal(operations.actions.length, previousCount);
    runtime.put('comparison-submissions', `${match}:${attempt}`, { key: `${match}:${attempt}`, state: 'SUBMISSION_PERSISTED' });
    await runDailyTournamentTick(runtime, operations, midnight + 301, '1000000');
    assert.equal(operations.actions.length, previousCount);
  } finally { runtime.close(); }
});

test('partial provider replay allows one recovery after the fallback upgrade and remains bounded', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const operations = new FakeOperations();
    const first = await runDailyTournamentTick(runtime, operations, midnight - 60, '1000000');
    const attempt = `sha256:${'c'.repeat(64)}`;
    const row = operations.records.get(first!.tournamentId)!;
    row.message = `Runner requires recovery for attempt ${attempt}.`;
    runtime.put('evaluation-tournament-provider-runs', `${attempt}:A`, { fingerprint: 'saved' });
    for (let number = 0; number < 5; number += 1) {
      row.state = 'RECOVERY_REQUIRED';
      await runDailyTournamentTick(runtime, operations, midnight + 1 + number * 300, '1000000');
    }
    assert.equal(operations.actions.filter((action) => action === 'PROGRESS').length, 4);
  } finally { runtime.close(); }
});
