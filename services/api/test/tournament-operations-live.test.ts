import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import { buildBracket } from '../../../packages/domain/src/bracket.ts';
import { LiveTournamentOperations, ViemTournamentArcOperations, type TournamentArcOperations } from '../src/tournament-operations-live.ts';

const tournamentId = `sha256:${'1'.repeat(64)}`;
const operator = `0x${'2'.repeat(40)}`;
const entrants = Array.from({ length: 8 }, (_, index) => ({ entrantId: `0x${String(index + 1).padStart(64, '0')}`, agentId: `0x${String(index + 11).padStart(64, '0')}`, agentsVersion: `0x${String(index + 21).padStart(64, '0')}`, agentsCommitment: `0x${String(index + 31).padStart(64, '0')}`, stakeAmount: '1000000', tournamentId: `0x${'1'.repeat(64)}`, agentsMd: `Agent ${index}` }));
const sha = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const entropyBlockHash = `0x${'f'.repeat(64)}`;
const entropyBlockNumber = '123';

class FakeArc implements TournamentArcOperations {
  state: any = 'DRAFT'; entrantCount = 8; transactionNames: string[] = [];
  async create() { this.transactionNames.push('create'); return this.value('a'); }
  async snapshot() { return this.value(); }
  async registeredEntrants(_id: string, candidates: readonly any[]) { return candidates; }
  async startBlockEntropy() { return { blockHash: entropyBlockHash, blockNumber: entropyBlockNumber }; }
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
    const service = { listTournamentOperatorEntrants: () => entrants, publishTournament: (_caller: string, value: any) => published.push(value), publishMatch() {}, getMatch: () => null, getPublicAgent: (id: string) => ({ name: id }) } as any;
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

test('Tournament derives a public bracket seed from the locked roster and scheduled Arc start block across restart', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const arc = new FakeArc();
    arc.startBlockEntropy = async (startsAt) => { assert.equal(startsAt, 20); return { blockHash: entropyBlockHash, blockNumber: entropyBlockNumber }; };
    let currentEntrants = entrants;
    const published: any[] = [];
    const service = { listTournamentOperatorEntrants: () => currentEntrants, publishTournament: (_caller: string, value: any) => published.push(value), publishMatch() {}, getMatch: () => null, getPublicAgent: (id: string) => ({ name: id }) } as any;
    const seeds: string[] = [];
    const rosterSizes: number[] = [];
    const topicSnapshots: string[][] = [];
    const selections: string[] = [];
    const orchestrator = { async run(input: any) { seeds.push(input.seedDigest); rosterSizes.push(input.entrants.length); topicSnapshots.push([...input.topics]); selections.push(input.topicSelection); return { state: 'WAITING_FOR_JUDGE', attemptId: tournamentId, results: new Map() }; } } as any;
    const input = { tournamentId, name: 'Daily', registrationOpensAt: 10, registrationClosesAt: 20, startsAt: 20, expiresAt: 1000, minEntrants: 8, maxEntrants: 8, stakeAmount: '1000000' };
    const first = new LiveTournamentOperations(runtime, service, operator, arc, orchestrator, () => 40, ['new-a', 'new-b', 'new-c']);
    await first.create(input);
    await first.execute({ tournamentId, action: 'PROGRESS' });
    currentEntrants = [];
    const restored = new LiveTournamentOperations(runtime, service, operator, arc, orchestrator, () => 40, ['changed-a']);
    await restored.execute({ tournamentId, action: 'PROGRESS' });
    assert.deepEqual(rosterSizes, [8, 8]);
    assert.equal(seeds[0], seeds[1]);
    assert.deepEqual(topicSnapshots, [['new-a', 'new-b', 'new-c'], ['new-a', 'new-b', 'new-c']]);
    assert.deepEqual(selections, ['seeded-shuffle-v1', 'seeded-shuffle-v1']);
    const canonicalEntrants = entrants.map((item) => `sha256:${item.entrantId.slice(2)}`).sort();
    const rosterDigest = sha(JSON.stringify({ schema: 'arena-bracket-roster-v1', entrants: canonicalEntrants }));
    const expectedSeed = sha(JSON.stringify({ schema: 'arena-bracket-seed-v2', tournament_id: tournamentId, roster_digest: rosterDigest, entropy_block_hash: entropyBlockHash }));
    assert.equal(seeds[0], expectedSeed);
    assert.deepEqual(published.at(-1).bracketSeed, {
      schema: 'arena-bracket-seed-v2', seedDigest: expectedSeed, rosterDigest,
      entropyBlockHash, entropyBlockNumber,
    });
  } finally { runtime.close(); }
});

test('locked nine entrant roster publishes the playable opening match and survives a paused runner', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const arc = new FakeArc(); arc.entrantCount = 9;
    const roster = [...entrants, { ...entrants[0], entrantId: `0x${'9'.padStart(64, '0')}`, agentId: `0x${'19'.padStart(64, '0')}` }];
    const matches = new Map<string, any>(); const tournaments: any[] = [];
    const service = { listTournamentOperatorEntrants: () => roster, publishTournament: (_caller: string, row: any) => tournaments.push(row), publishMatch: (_caller: string, match: any) => matches.set(match.id, match), getMatch: (id: string) => matches.get(id) ?? null, getPublicAgent: (id: string) => ({ name: `Agent ${id.slice(-4)}` }) } as any;
    const orchestrator = { async run() { return { state: 'RECOVERY_REQUIRED', attemptId: tournamentId, matchId: tournamentId, reason: 'PROVIDER_ERROR', results: new Map() }; } } as any;
    const input = { tournamentId, name: 'Daily', registrationOpensAt: 10, registrationClosesAt: 20, startsAt: 20, expiresAt: 1000, minEntrants: 8, maxEntrants: 32, stakeAmount: '1000000' };
    const operations = new LiveTournamentOperations(runtime, service, operator, arc, orchestrator, () => 40);
    await operations.create(input);
    assert.equal((await operations.execute({ tournamentId, action: 'PROGRESS' })).state, 'RECOVERY_REQUIRED');
    assert.equal(tournaments.at(-1).operationState, 'RECOVERY_REQUIRED');
    assert.equal([...matches.values()].filter((match) => match.round === 0 && match.state === 'SCHEDULED').length, 1);
    const first = [...matches.values()][0];
    assert.match(first.agentA, /^Agent /);
    await operations.get(tournamentId);
    assert.deepEqual(matches.get(first.id), first);
  } finally { runtime.close(); }
});

test('finalized opening result publishes the winner and newly playable next pairing', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const arc = new FakeArc(); arc.entrantCount = 9;
    const roster = [...entrants, { ...entrants[0], entrantId: `0x${'9'.padStart(64, '0')}`, agentId: `0x${'19'.padStart(64, '0')}` }];
    const matches = new Map<string, any>();
    const service = { listTournamentOperatorEntrants: () => roster, publishTournament() {}, publishMatch: (_caller: string, match: any) => matches.set(match.id, match), getMatch: (id: string) => matches.get(id) ?? null, getPublicAgent: (id: string) => ({ name: `Agent ${id.slice(-4)}` }) } as any;
    const orchestrator = { async run(input: any) {
      const bracket = buildBracket({ tournamentId, seedDigest: input.seedDigest, entrants: input.entrants.map((item: any) => item.entrantId), bracketRevision: 1 });
      const opening = bracket.matches[0];
      return { state: 'WAITING_FOR_JUDGE', matchId: bracket.matches[1].matchId, attemptId: tournamentId, results: new Map([[opening.matchId, 'A_WIN']]) };
    } } as any;
    const operations = new LiveTournamentOperations(runtime, service, operator, arc, orchestrator, () => 40);
    await operations.create({ tournamentId, name: 'Daily', registrationOpensAt: 10, registrationClosesAt: 20, startsAt: 20, expiresAt: 1000, minEntrants: 8, maxEntrants: 32, stakeAmount: '1000000' });
    await operations.execute({ tournamentId, action: 'PROGRESS' });
    const finalized = [...matches.values()].find((item) => item.round === 0);
    assert.equal(finalized.state, 'FINALIZED');
    assert.equal(finalized.winner, finalized.agentA);
    assert.ok([...matches.values()].some((item) => item.round === 1 && item.state === 'SCHEDULED'));
  } finally { runtime.close(); }
});

test('Arc entropy lookup selects the first block at or after the locked start time', async () => {
  const port = Object.create(ViemTournamentArcOperations.prototype) as ViemTournamentArcOperations;
  const calls: bigint[] = [];
  (port as any).client = {
    async getChainId() { return 5042002; },
    async getBlockNumber() { return 127n; },
    async getBlock({ blockNumber }: { blockNumber: bigint }) { calls.push(blockNumber); return { timestamp: blockNumber < 123n ? 19n : 20n, hash: blockNumber === 123n ? entropyBlockHash : `0x${'e'.repeat(64)}` }; },
  };
  assert.deepEqual(await port.startBlockEntropy(20), { blockHash: entropyBlockHash, blockNumber: '123' });
  assert.ok(calls.includes(122n) && calls.includes(123n));
  (port as any).client.getBlock = async () => ({ timestamp: 19n, hash: entropyBlockHash });
  await assert.rejects(() => port.startBlockEntropy(20), /not available yet/i);
});

test('Tournament operation created before topic pool v2 keeps the legacy selection policy', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const arc = new FakeArc();
    const service = { listTournamentOperatorEntrants: () => entrants, publishTournament() {}, publishMatch() {}, getMatch: () => null, getPublicAgent: (id: string) => ({ name: id }) } as any;
    const seen: any[] = [];
    const orchestrator = { async run(input: any) { seen.push(input); return { state: 'WAITING_FOR_JUDGE', attemptId: tournamentId, results: new Map() }; } } as any;
    const operations = new LiveTournamentOperations(runtime, service, operator, arc, orchestrator, () => 40, ['new-topic']);
    await operations.create({ tournamentId, name: 'Legacy', registrationOpensAt: 10, registrationClosesAt: 20, startsAt: 20, expiresAt: 1000, minEntrants: 8, maxEntrants: 8, stakeAmount: '1000000' });
    const legacy = runtime.get<any>('tournament-operations', tournamentId)!;
    delete legacy.topicPoolVersion;
    runtime.put('tournament-operations', tournamentId, legacy);
    await operations.execute({ tournamentId, action: 'PROGRESS' });
    assert.equal(seen[0].topicSelection, undefined);
    assert.equal(seen[0].topics.length, 6);
    assert.equal(seen[0].topics.includes('new-topic'), false);
  } finally { runtime.close(); }
});
