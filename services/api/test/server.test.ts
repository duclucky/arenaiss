import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { privateKeyToAccount } from 'viem/accounts';

import { createArenaServer, managedIdentityFromEnvironment } from '../src/server.ts';
import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';

test('Node HTTP boundary performs signed session and private agent lifecycle', async () => {
  const operator = '0x9999999999999999999999999999999999999999';
  const account = privateKeyToAccount(`0x${'02'.repeat(32)}`);
  const server = createArenaServer(operator);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const base = `http://127.0.0.1:${address.port}`;
    const challengeResponse = await fetch(`${base}/api/auth/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: account.address }) });
    const challenge = await challengeResponse.json();
    const signature = await account.signMessage({ message: challenge.message });
    const auth = await fetch(`${base}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: account.address, signature }) });
    assert.equal(auth.status, 204);
    const cookie = auth.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const created = await fetch(`${base}/api/agents`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Live local', agentsMd: 'private' }) });
    assert.equal(created.status, 201);
    const list = await fetch(`${base}/api/agents`, { headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal(JSON.stringify(await list.json()).includes('private'), false);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('Node HTTP boundary decodes canonical digest IDs before public routing', async () => {
  const operator = '0x9999999999999999999999999999999999999999';
  const tournamentId = `sha256:${'a'.repeat(64)}`;
  const database = new SqliteRuntimeStore(':memory:');
  database.put('api-tournaments', tournamentId, { id: tournamentId, name: 'Encoded ID Arena', status: 'ACTIVE', entrantIds: [], prizePool: '800000' });
  const server = createArenaServer(operator, database);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/tournaments/${encodeURIComponent(tournamentId)}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).id, tournamentId);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('Node HTTP boundary exposes a minimal health check without application data', async () => {
  const server = createArenaServer('0x9999999999999999999999999999999999999999');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('Node HTTP boundary rate limits mutation bursts and emits secret-free structured logs', async () => {
  const logs: Array<Record<string, unknown>> = [];
  const server = createArenaServer('0x9999999999999999999999999999999999999999', undefined, {
    rateLimit: { maxRequests: 2, windowMs: 60_000 },
    now: () => 1_000,
    logger: (entry) => logs.push(entry),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const base = `http://127.0.0.1:${address.port}`;
    const body = JSON.stringify({ address: '0x1111111111111111111111111111111111111111', signature: 'must-not-be-logged' });
    const headers = { 'content-type': 'application/json', cookie: 'arena_session=must-not-be-logged' };
    assert.equal((await fetch(`${base}/api/auth/challenge`, { method: 'POST', headers, body })).status, 200);
    assert.equal((await fetch(`${base}/api/auth/challenge`, { method: 'POST', headers, body })).status, 200);
    const limited = await fetch(`${base}/api/auth/challenge`, { method: 'POST', headers, body });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal(logs.some((entry) => entry.status === 429), true);
    const serialized = JSON.stringify(logs);
    assert.equal(serialized.includes('must-not-be-logged'), false);
    for (const entry of logs) {
      assert.equal(entry.event, 'http_request');
      assert.equal(typeof entry.method, 'string');
      assert.equal(typeof entry.path, 'string');
      assert.equal(typeof entry.status, 'number');
      assert.equal(typeof entry.durationMs, 'number');
    }
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('managed identity configuration is optional but rejects every partial secret set', () => {
  const database = new SqliteRuntimeStore(':memory:');
  try {
    assert.equal(managedIdentityFromEnvironment(database, {}), undefined);
    assert.throws(
      () => managedIdentityFromEnvironment(database, { CIRCLE_API_KEY: 'secret-value' }),
      /configuration is incomplete: CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_SET_ID, ARC_AGENT_REGISTRY_ADDRESS, ARENA_IDENTITY_PEPPER, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM/,
    );
  } finally { database.close(); }
});
