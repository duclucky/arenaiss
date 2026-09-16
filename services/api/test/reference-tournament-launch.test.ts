import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import { launchReferenceTournament } from '../src/reference-tournament-launch.ts';
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
