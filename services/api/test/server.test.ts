import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { privateKeyToAccount } from 'viem/accounts';

import { createArenaServer, createPairWorkerTick, managedIdentityFromEnvironment, purgeArchivedTournamentLogs } from '../src/server.ts';
import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';

test('Pair worker ticks overlap so a slow room batch cannot block the next scan', async () => {
  let calls = 0;
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const worker = {
    async tick() {
      calls += 1;
      if (calls === 1) await firstBlocked;
    },
  };
  const pairTick = createPairWorkerTick(worker, { success() {}, failure() {} });
  const first = pairTick();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = pairTick();
  await second;
  try { assert.equal(calls, 2); }
  finally { releaseFirst(); await first; }
});

test('startup purge removes only the three archived Tournament graphs and is idempotent', () => {
  const database = new SqliteRuntimeStore(':memory:');
  try {
    const recoveryId = `sha256:4cd199d746966f2df0325d307267e23ffbf9bc0c3605ab372132e0478ff06fcd`;
    const referenceId = `sha256:3a326a6030c4cbfa6171c380805e6f7fb8bce366d237f4ada69cddaead722a61`;
    const referenceCupId = 'sha256:17b7579726b7fde3cd3e793aa0e7acb6a3c529f09bfd6c05ea33f732bf431480';
    const recoveryArcId = `0x4cd199d746966f2df0325d307267e23ffbf9bc0c3605ab372132e0478ff06fcd`;
    const referenceArcId = `0x3a326a6030c4cbfa6171c380805e6f7fb8bce366d237f4ada69cddaead722a61`;
    const pairId = `sha256:${'9'.repeat(64)}`;
    database.put('api-tournaments', recoveryId, { id: recoveryId });
    database.put('tournament-operations', referenceId, { input: { tournamentId: referenceId } });
    database.put('api-tournaments', referenceCupId, { id: referenceCupId, name: 'Arena ISS Reference Cup', status: 'CANCELLED' });
    database.put('api-registrations', 'recovery-registration', { tournamentId: recoveryArcId });
    database.put('api-registrations', 'reference-registration', { tournamentId: referenceArcId });
    database.put('pair-rooms-v1', pairId, { roomId: pairId, state: 'JOINED' });
    database.increment('inference-cost', recoveryId, 3);
    database.claimLease('tournament-operation-leases', referenceId, referenceId, 'worker', 1, 100);

    assert.deepEqual(purgeArchivedTournamentLogs(database), { records: 5, counters: 1, leases: 1 });
    assert.deepEqual(database.list('api-tournaments'), []);
    assert.deepEqual(database.list('tournament-operations'), []);
    assert.deepEqual(database.list('api-registrations'), []);
    assert.deepEqual(database.list('pair-rooms-v1'), [{ roomId: pairId, state: 'JOINED' }]);
    assert.deepEqual(purgeArchivedTournamentLogs(database), { records: 0, counters: 0, leases: 0 });
  } finally { database.close(); }
});

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

test('rate limiting ignores spoofed forwarding headers and trusts only the Caddy-owned header when configured', async () => {
  const operator = '0x9999999999999999999999999999999999999999';
  const start = async (trustProxy: boolean) => {
    const server = createArenaServer(operator, undefined, { rateLimit: { maxRequests: 1, windowMs: 60_000, maxEntries: 10 }, now: () => 1_000, logger: () => undefined, trustProxy });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server;
  };
  const direct = await start(false);
  try {
    const location = direct.address(); if (!location || typeof location === 'string') throw new Error('missing port');
    const url = `http://127.0.0.1:${location.port}/api/auth/challenge`;
    const request = (headers: Record<string, string>) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ address: '0x1111111111111111111111111111111111111111' }) });
    assert.equal((await request({ 'x-forwarded-for': '198.51.100.1' })).status, 200);
    assert.equal((await request({ 'x-forwarded-for': '198.51.100.2', 'x-arena-client-ip': '198.51.100.2' })).status, 429);
  } finally { direct.close(); await once(direct, 'close'); }
  const proxied = await start(true);
  try {
    const location = proxied.address(); if (!location || typeof location === 'string') throw new Error('missing port');
    const url = `http://127.0.0.1:${location.port}/api/auth/challenge`;
    const request = (ip: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-arena-client-ip': ip }, body: JSON.stringify({ address: '0x1111111111111111111111111111111111111111' }) });
    assert.equal((await request('198.51.100.1')).status, 200);
    assert.equal((await request('198.51.100.2')).status, 200);
  } finally { proxied.close(); await once(proxied, 'close'); }
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

test('partial Evo configuration disables execution without crashing the API', () => {
  const database = new SqliteRuntimeStore(':memory:');
  const names = ['CIRCLE_API_KEY', 'CIRCLE_ENTITY_SECRET', 'CIRCLE_WALLET_SET_ID', 'ARC_AGENT_REGISTRY_ADDRESS', 'ARENA_IDENTITY_PEPPER', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'EVALUATION_FEE_USDC', 'ARC_EVO_FEE_ESCROW_ADDRESS', 'GENLAYER_EVALUATION_JUDGE_ADDRESS', 'API_KEY', 'END_POINT', 'MODEL', 'STUDIONET_PRIVATE_KEY'] as const;
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, { CIRCLE_API_KEY: 'x', CIRCLE_ENTITY_SECRET: 'x', CIRCLE_WALLET_SET_ID: 'x', ARC_AGENT_REGISTRY_ADDRESS: `0x${'1'.repeat(40)}`, ARENA_IDENTITY_PEPPER: 'x'.repeat(32), SMTP_HOST: 'localhost', SMTP_PORT: '25', SMTP_USER: 'x', SMTP_PASS: 'x', SMTP_FROM: 'x@example.com', EVALUATION_FEE_USDC: '1', GENLAYER_EVALUATION_JUDGE_ADDRESS: `0x${'2'.repeat(40)}` });
  try {
    const server = createArenaServer(`0x${'3'.repeat(40)}`, database);
    server.close();
  } finally {
    for (const name of names) before[name] === undefined ? delete process.env[name] : process.env[name] = before[name];
    database.close();
  }
});
