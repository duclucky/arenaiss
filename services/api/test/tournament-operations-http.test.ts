import assert from 'node:assert/strict';
import test from 'node:test';

import { ArenaHttpApi } from '../src/http.ts';
import { ArenaApiService } from '../src/service.ts';
import type { TournamentOperationsPort } from '../src/tournament-operations.ts';

const operator = `0x${'9'.repeat(40)}`;
const outsider = `0x${'1'.repeat(40)}`;
const tournamentId = `sha256:${'a'.repeat(64)}`;

async function session(api: ArenaHttpApi, address: string): Promise<string> {
  await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address } });
  const login = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address, signature: 'ok' } });
  return login.headers['set-cookie'].split(';')[0];
}

test('Tournament control plane is operator-only and never accepts caller-supplied ranking or payouts', async () => {
  const calls: unknown[] = [];
  const snapshot = { tournamentId, name: 'Safety Cup', state: 'REGISTRATION' as const, entrantCount: 0, matchCount: 0, finalizedMatchCount: 0, nextActions: ['PROGRESS', 'EXPIRE'] as const };
  const operations: TournamentOperationsPort = {
    async list() { return [snapshot]; }, async get() { return snapshot; },
    async create(input) { calls.push(input); return snapshot; },
    async execute(input) { calls.push(input); return { ...snapshot, state: 'RUNNING', nextActions: ['PROGRESS', 'SETTLE', 'EXPIRE'] }; },
  };
  const api = new ArenaHttpApi(new ArenaApiService(operator), async () => true, undefined, undefined, undefined, undefined, operations);
  const outsiderCookie = await session(api, outsider);
  assert.equal((await api.handle({ method: 'GET', path: '/api/tournament-operations', headers: { cookie: outsiderCookie } })).status, 401);

  const cookie = await session(api, operator);
  const rejected = await api.handle({ method: 'POST', path: '/api/tournament-operations', headers: { cookie }, body: { tournamentId, name: 'Safety Cup', registrationOpensAt: 10, registrationClosesAt: 20, startsAt: 30, expiresAt: 40, minEntrants: 8, maxEntrants: 8, stakeAmount: '1000000', payoutAmounts: ['100'] } });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /unsupported/i);

  const created = await api.handle({ method: 'POST', path: '/api/tournament-operations', headers: { cookie }, body: { tournamentId, name: 'Safety Cup', registrationOpensAt: 10, registrationClosesAt: 20, startsAt: 30, expiresAt: 40, minEntrants: 8, maxEntrants: 8, stakeAmount: '1000000' } });
  assert.equal(created.status, 201);
  assert.deepEqual(calls[0], { tournamentId, name: 'Safety Cup', registrationOpensAt: 10, registrationClosesAt: 20, startsAt: 30, expiresAt: 40, minEntrants: 8, maxEntrants: 8, stakeAmount: '1000000' });

  const progressed = await api.handle({ method: 'POST', path: `/api/tournament-operations/${tournamentId}/actions/PROGRESS`, headers: { cookie }, body: {} });
  assert.equal(progressed.status, 202);
  assert.deepEqual(calls[1], { tournamentId, action: 'PROGRESS' });
  assert.equal((await api.handle({ method: 'POST', path: `/api/tournament-operations/${tournamentId}/actions/SETTLE`, headers: { cookie }, body: { rankedEntrants: ['forged'] } })).status, 400);
  assert.equal((await api.handle({ method: 'POST', path: `/api/tournament-operations/${tournamentId}/actions/REFUND`, headers: { cookie }, body: {} })).status, 400);
  assert.equal(calls.length, 2);
});

test('Tournament operation routes fail closed when the live runner is unavailable', async () => {
  const api = new ArenaHttpApi(new ArenaApiService(operator), async () => true);
  const cookie = await session(api, operator);
  const response = await api.handle({ method: 'GET', path: '/api/tournament-operations', headers: { cookie } });
  assert.equal(response.status, 503);
});
