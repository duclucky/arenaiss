import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import { LiveTournamentOperations, type TournamentArcOperations } from '../src/tournament-operations-live.ts';

const tournamentId = `sha256:${'1'.repeat(64)}`;
const operator = `0x${'2'.repeat(40)}`;
const entrants = Array.from({ length: 8 }, (_, index) => ({ entrantId: `0x${String(index + 1).padStart(64, '0')}`, agentId: `0x${String(index + 11).padStart(64, '0')}`, agentsVersion: `0x${String(index + 21).padStart(64, '0')}`, agentsCommitment: `0x${String(index + 31).padStart(64, '0')}`, stakeAmount: '1000000', tournamentId: `0x${'1'.repeat(64)}`, agentsMd: `Agent ${index}` }));

class FakeArc implements TournamentArcOperations {
  state: any = 'DRAFT'; entrantCount = 8; transactionNames: string[] = [];
  async create() { this.transactionNames.push('create'); return this.value('a'); }
  async snapshot() { return this.value(); }
  async registeredEntrants(_id: string, candidates: readonly any[]) { return candidates; }
  async closeRegistration() { this.transactionNames.push('close'); this.state = 'REGISTRATION_CLOSED'; return this.value('b'); }
  async markRunning() { this.transactionNames.push('run'); this.state = 'RUNNING'; return this.value('c'); }
  async settle() { this.transactionNames.push('settle'); this.state = 'SETTLED'; return this.value('d'); }
  async refund() { this.transactionNames.push('refund'); this.state = 'CANCELLED_REFUNDABLE'; return this.value('e'); }
  private value(hash?: string) { return { state: this.state, entrantCount: this.state === 'DRAFT' ? 0 : this.entrantCount, totalLockedStakes: this.state === 'SETTLED' ? '0' : String(this.entrantCount * 1_000_000), totalLiability: this.state === 'SETTLED' ? String(this.entrantCount * 1_000_000) : '0', ...(hash ? { transactionHash: `0x${hash.repeat(64)}` } : {}) }; }
}

test('production Tournament runner derives ranking, persists it, then settles on Arc without caller ranking input', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const arc = new FakeArc(); const published: any[] = []; let runs = 0;
    const service = { listTournamentOperatorEntrants: () => entrants, publishTournament: (_caller: string, value: any) => published.push(value) } as any;
    const ranking = entrants.slice(0, 5).map((row) => `sha256:${row.entrantId.slice(2)}`);
    const orchestrator = { async run(input: any) { runs += 1; assert.equal(input.entrants.length, 8); return { state: 'RANKING_READY', ranking, results: new Map(Array.from({ length: 12 }, (_, index) => [`sha256:${String(index + 101).padStart(64, '0')}`, 'A_WIN'])) }; } } as any;
    const operations = new LiveTournamentOperations(runtime, service, operator, arc, orchestrator, () => 40);
    const input = { tournamentId, name: 'Production Cup', registrationOpensAt: 10, registrationClosesAt: 20, startsAt: 30, expiresAt: 1000, minEntrants: 8, maxEntrants: 8, stakeAmount: '1000000' };

    assert.equal((await operations.create(input)).state, 'REGISTRATION');
    const progressed = await operations.execute({ tournamentId, action: 'PROGRESS' });
    assert.equal(progressed.state, 'SETTLEMENT_PENDING');
    assert.deepEqual(progressed.nextActions, ['SETTLE', 'EXPIRE']);
    assert.equal(progressed.finalizedMatchCount, 12);
    assert.equal(runs, 1);
    assert.deepEqual(arc.transactionNames, ['create', 'close', 'run']);

    const restored = new LiveTournamentOperations(runtime, service, operator, arc, { async run() { throw new Error('ranking must be restored'); } } as any, () => 40);
    const settled = await restored.execute({ tournamentId, action: 'SETTLE' });
    assert.equal(settled.state, 'COMPLETED');
    assert.deepEqual(arc.transactionNames, ['create', 'close', 'run', 'settle']);
    assert.equal(published.at(-1).status, 'COMPLETED');
    assert.equal(published.at(-1).prizePool, '8');
  } finally { runtime.close(); }
});

test('production Tournament runner opens Arc refunds when registration closes below the minimum', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const arc = new FakeArc();
    arc.entrantCount = 4;
    arc.registeredEntrants = async (_id, candidates) => candidates.slice(0, 4);
    const service = { listTournamentOperatorEntrants: () => entrants.slice(0, 4), publishTournament() {} } as any;
    const operations = new LiveTournamentOperations(runtime, service, operator, arc, { async run() { throw new Error('must not run'); } } as any, () => 40);
    await operations.create({ tournamentId, name: 'Refund Cup', registrationOpensAt: 10, registrationClosesAt: 20, startsAt: 30, expiresAt: 1000, minEntrants: 8, maxEntrants: 8, stakeAmount: '1000000' });
    arc.state = 'REGISTRATION_CLOSED';
    const pending = await operations.execute({ tournamentId, action: 'PROGRESS' });
    assert.equal(pending.state, 'REFUND_PENDING');
    const refunded = await operations.execute({ tournamentId, action: 'REFUND' });
    assert.equal(refunded.state, 'REFUNDED');
    assert.deepEqual(arc.transactionNames, ['create', 'refund']);
  } finally { runtime.close(); }
});

test('Tournament start snapshots its roster and random bracket seed across retries and restart', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const arc = new FakeArc();
    let currentEntrants = entrants;
    const service = { listTournamentOperatorEntrants: () => currentEntrants, publishTournament() {} } as any;
    const seeds: string[] = [];
    const rosterSizes: number[] = [];
    const orchestrator = { async run(input: any) { seeds.push(input.seedDigest); rosterSizes.push(input.entrants.length); return { state: 'WAITING_FOR_JUDGE', attemptId: tournamentId, results: new Map() }; } } as any;
    const input = { tournamentId, name: 'Daily', registrationOpensAt: 10, registrationClosesAt: 20, startsAt: 20, expiresAt: 1000, minEntrants: 8, maxEntrants: 8, stakeAmount: '1000000' };
    const first = new LiveTournamentOperations(runtime, service, operator, arc, orchestrator, () => 40);
    await first.create(input);
    await first.execute({ tournamentId, action: 'PROGRESS' });
    currentEntrants = [];
    const restored = new LiveTournamentOperations(runtime, service, operator, arc, orchestrator, () => 40);
    await restored.execute({ tournamentId, action: 'PROGRESS' });
    assert.deepEqual(rosterSizes, [8, 8]);
    assert.equal(seeds[0], seeds[1]);
    assert.match(seeds[0], /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(seeds[0], `sha256:${'0'.repeat(64)}`);
  } finally { runtime.close(); }
});
