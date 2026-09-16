import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import { launchReferenceTournament, runReferenceTournamentTick } from '../src/reference-tournament-launch.ts';
import type { CreateTournamentOperation, TournamentOperationsPort, TournamentOperationSnapshot } from '../src/tournament-operations.ts';

test('system launch creates one eight-place 1 USDC tournament with a durable 30-minute schedule', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  const calls: CreateTournamentOperation[] = [];
  let created: TournamentOperationSnapshot | null = null;
  const operations: TournamentOperationsPort = {
    async create(input) {
      calls.push(input);
      created = { tournamentId: input.tournamentId, name: input.name, state: 'REGISTRATION', entrantCount: 0, matchCount: 0, finalizedMatchCount: 0, nextActions: ['PROGRESS'], arc: { state: 'DRAFT', transactionHash: `0x${'a'.repeat(64)}` }, genLayer: { pendingCount: 0, finalizedCount: 0 } };
      return created;
    },
    async get() { return created; },
    async list() { return created ? [created] : []; },
    async execute() { throw new Error('not used'); },
  };
  try {
    const first = await launchReferenceTournament(runtime, operations, 1_800_000_000);
    assert.equal(first.input.registrationClosesAt - first.input.registrationOpensAt, 1_800);
    assert.equal(first.input.startsAt, first.input.registrationClosesAt);
    assert.equal(first.input.stakeAmount, '1000000');
    assert.equal(first.input.minEntrants, 8);
    assert.equal(first.input.maxEntrants, 8);
    assert.match(first.snapshot.arc?.transactionHash || '', /^0x[0-9a-f]{64}$/);
    const second = await launchReferenceTournament(runtime, operations, 1_800_000_600);
    assert.deepEqual(second.input, first.input);
    assert.equal(calls.length, 1);
  } finally { runtime.close(); }
});

test('system launch retries a failed Arc creation with the original persisted timestamps', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  const calls: CreateTournamentOperation[] = [];
  const operations: TournamentOperationsPort = {
    async create(input) {
      calls.push(input);
      if (calls.length === 1) throw new Error('temporary Arc failure');
      return { tournamentId: input.tournamentId, name: input.name, state: 'REGISTRATION', entrantCount: 0, matchCount: 0, finalizedMatchCount: 0, nextActions: ['PROGRESS'] };
    },
    async get() { return null; },
    async list() { return []; },
    async execute() { throw new Error('not used'); },
  };
  try {
    await assert.rejects(launchReferenceTournament(runtime, operations, 1_800_000_000), /temporary Arc failure/);
    await launchReferenceTournament(runtime, operations, 1_800_000_600);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
  } finally { runtime.close(); }
});

test('system advances the reference tournament only after its start and settles a ready ranking', async () => {
  const input = { tournamentId: `sha256:${'1'.repeat(64)}`, name: 'Reference', registrationOpensAt: 100, registrationClosesAt: 1_900, startsAt: 1_900, expiresAt: 100_000, minEntrants: 8, maxEntrants: 8, stakeAmount: '1000000' };
  let state: TournamentOperationSnapshot['state'] = 'REGISTRATION';
  const actions: string[] = [];
  const snapshot = (): TournamentOperationSnapshot => ({ tournamentId: input.tournamentId, name: input.name, state, entrantCount: 8, matchCount: 12, finalizedMatchCount: 0, nextActions: state === 'REGISTRATION' ? ['PROGRESS'] : state === 'SETTLEMENT_PENDING' ? ['SETTLE'] : [] });
  const operations: TournamentOperationsPort = {
    async get() { return snapshot(); },
    async execute({ action }) { actions.push(action); state = action === 'PROGRESS' ? 'SETTLEMENT_PENDING' : 'COMPLETED'; return snapshot(); },
    async list() { return []; },
    async create() { throw new Error('not used'); },
  };
  assert.equal((await runReferenceTournamentTick(operations, input, 1_899)).action, null);
  assert.deepEqual(actions, []);
  assert.equal((await runReferenceTournamentTick(operations, input, 1_900)).action, 'PROGRESS');
  assert.equal((await runReferenceTournamentTick(operations, input, 1_901)).action, 'SETTLE');
  assert.equal((await runReferenceTournamentTick(operations, input, 1_902)).action, null);
  assert.deepEqual(actions, ['PROGRESS', 'SETTLE']);
});

test('system refunds a short roster but stops on recovery-required state', async () => {
  const input = { tournamentId: `sha256:${'1'.repeat(64)}`, name: 'Reference', registrationOpensAt: 100, registrationClosesAt: 1_900, startsAt: 1_900, expiresAt: 100_000, minEntrants: 8, maxEntrants: 8, stakeAmount: '1000000' };
  let state: TournamentOperationSnapshot['state'] = 'REFUND_PENDING';
  const actions: string[] = [];
  const operations: TournamentOperationsPort = {
    async get() { return { tournamentId: input.tournamentId, name: input.name, state, entrantCount: 4, matchCount: 0, finalizedMatchCount: 0, nextActions: state === 'REFUND_PENDING' ? ['REFUND'] : ['PROGRESS'] }; },
    async execute({ action }) { actions.push(action); state = 'RECOVERY_REQUIRED'; return { tournamentId: input.tournamentId, name: input.name, state, entrantCount: 4, matchCount: 0, finalizedMatchCount: 0, nextActions: ['PROGRESS'] }; },
    async list() { return []; },
    async create() { throw new Error('not used'); },
  };
  assert.equal((await runReferenceTournamentTick(operations, input, 1_901)).action, 'REFUND');
  assert.equal((await runReferenceTournamentTick(operations, input, 1_902)).action, null);
  assert.deepEqual(actions, ['REFUND']);
});
