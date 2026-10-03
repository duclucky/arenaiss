import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { seedLiveDemo } from '../../scripts/ops/seed-live-demo.mjs';
import { ArenaApiService } from '../../services/api/src/service.ts';
import { SqliteRuntimeStore } from '../../packages/persistence/src/sqlite-runtime.ts';

test('sanitized live evidence seeds idempotent public projections without private outputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'arena-live-seed-'));
  const databasePath = join(directory, 'arena.sqlite');
  const evidencePath = resolve('docs/evidence/live/trusted-operator-lifecycle-settlement-2.json');
  const evidenceText = readFileSync(evidencePath, 'utf8');
  const operator = '0xC495ef51618D03267A1f227aFe5b27B38c748272';
  try {
    const first = seedLiveDemo({ databasePath, evidencePath, operator });
    const second = seedLiveDemo({ databasePath, evidencePath, operator });
    assert.deepEqual(second, first);
    assert.equal(first.tournaments, 1);
    assert.ok(first.matches >= 1);

    const runtime = new SqliteRuntimeStore(databasePath);
    const api = new ArenaApiService(operator, runtime);
    const tournaments = api.listTournaments();
    assert.equal(tournaments[0].status, 'COMPLETED');
    assert.equal(tournaments[0].prizePool, '0.008');
    const matches = api.listMatches(tournaments[0].id);
    assert.equal(matches.length, first.matches);
    assert.equal(matches.filter((match) => match.stage === 'main').length, 7);
    assert.equal(matches.filter((match) => match.stage === 'third_place').length, 1);
    assert.equal(matches.filter((match) => match.stage === 'fifth_place').length, 3);
    assert.deepEqual(
      matches.filter((match) => match.stage === 'main' && match.round === 1).map((match) => [match.agentA, match.agentB, match.winner]),
      [
        ['Agent Atlas', 'Agent Beacon', 'Agent Atlas'],
        ['Agent Cipher', 'Agent Delta', 'Agent Delta'],
        ['Agent Echo', 'Agent Forge', 'Agent Echo'],
        ['Agent Grove', 'Agent Helix', 'Agent Helix'],
      ],
    );
    assert.equal(matches.find((match) => match.stage === 'main' && match.round === 3)?.winner, 'Agent Atlas');
    const verdict = api.getVerdict(matches[0].id);
    assert.match(verdict?.transactionHash || '', /^0x[0-9a-fA-F]{64}$/);
    assert.equal(verdict?.source, 'LIVE');
    assert.equal(verdict?.finality, 'FINALIZED');
    assert.equal(verdict?.execution, 'SUCCESS');
    assert.equal(verdict?.criteria?.length, 5);
    assert.equal(JSON.stringify({ tournaments, matches, verdict }).includes('outputA'), false);
    assert.equal(JSON.stringify({ tournaments, matches, verdict }).includes('agentsMd'), false);
    runtime.close();
    assert.equal(evidenceText.includes('"outputA"'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('sanitized live evidence replaces the unreadable legacy demo projection only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'arena-live-migration-'));
  const databasePath = join(directory, 'arena.sqlite');
  const evidencePath = resolve('docs/evidence/live/trusted-operator-lifecycle-settlement-2.json');
  const operator = '0xC495ef51618D03267A1f227aFe5b27B38c748272';
  try {
    const seeded = seedLiveDemo({ databasePath, evidencePath, operator });
    const runtime = new SqliteRuntimeStore(databasePath);
    const tournament = runtime.list<any>('api-tournaments')[0];
    const match = runtime.list<any>('api-matches')[0];
    runtime.put('api-matches', match.id, { ...match, agentA: 'Entrant A · legacy', stage: undefined });
    runtime.delete('live-demo-projection', tournament.id);
    runtime.put('unrelated', 'keep-me', { value: true });
    runtime.close();

    assert.deepEqual(seedLiveDemo({ databasePath, evidencePath, operator }), seeded);
    const migratedRuntime = new SqliteRuntimeStore(databasePath);
    const api = new ArenaApiService(operator, migratedRuntime);
    assert.equal(api.listMatches(tournament.id)[0].agentA, 'Agent Atlas');
    assert.deepEqual(migratedRuntime.get('unrelated', 'keep-me'), { value: true });
    migratedRuntime.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('production startup republishes the verified walkthrough and opens the approved October Tournament', () => {
  const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8');
  const compose = readFileSync(resolve('compose.yaml'), 'utf8');
  assert.match(dockerfile, /node scripts\/ops\/seed-live-demo\.mjs/);
  assert.match(compose, /ARENA_ONE_SHOT_TOURNAMENT: october-open-2026-v1/);
  assert.match(compose, /ARENA_TOURNAMENTS_PAUSED: 0/);
});
