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
