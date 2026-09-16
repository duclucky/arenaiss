import assert from 'node:assert/strict';
import test from 'node:test';
import { ArenaApiService } from '../src/service.ts';
import { ArenaHttpApi } from '../src/http.ts';
import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';

const operator = `0x${'a'.repeat(40)}`;
const alice = `0x${'b'.repeat(40)}`;

test('Marketplace routes are public-read, owner-private and fail closed without an Arc port', async () => {
  const api = new ArenaHttpApi(new ArenaApiService(operator), async () => true);
  assert.deepEqual((await api.handle({ method: 'GET', path: '/api/marketplace/listings' })).body, []);
  assert.equal((await api.handle({ method: 'GET', path: '/api/marketplace/certificates' })).status, 401);
  await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
  const login = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
  const headers = { cookie: login.headers['set-cookie'].split(';')[0] };
  assert.deepEqual((await api.handle({ method: 'GET', path: '/api/marketplace/certificates', headers })).body, []);
  assert.equal((await api.handle({ method: 'GET', path: '/api/marketplace/my-purchases' })).status, 401);
  assert.deepEqual((await api.handle({ method: 'GET', path: '/api/marketplace/my-purchases', headers })).body, []);
  assert.equal((await api.handle({ method: 'POST', path: '/api/marketplace/listings/1/buy', headers, body: { confirm: true } })).status, 503);
  assert.equal((await api.handle({ method: 'GET', path: '/api/marketplace/listings/1/delivery', headers })).status, 503);
});

test('Marketplace operator approval is executed by the configured Arc signer and then projected', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const certificateDigest = `sha256:${'4'.repeat(64)}`;
    runtime.put('marketplace-certificates', certificateDigest, { schema: 'arena-marketplace-certificate-v1', certificateDigest, evidenceDigest: `sha256:${'5'.repeat(64)}`, owner: alice, agentId: `sha256:${'1'.repeat(64)}`, agentVersionId: `sha256:${'2'.repeat(64)}`, agentsCommitment: `sha256:${'3'.repeat(64)}`, packId: `sha256:${'6'.repeat(64)}`, packVersion: '1.0.0', rubricVersion: 'v1', coverageBps: 10000, overallScore: 90, dimensionScores: {}, maxSpread: 0, issuedAt: 1, expiresAt: 9999999999, state: 'ELIGIBLE' });
    let approved = '';
    const chain = { async snapshot() { throw new Error('not used'); }, async approveEligibility(input: { digest: string }) { approved = input.digest; return { transactionId: 'approval', state: 'COMPLETE', txHash: `0x${'7'.repeat(64)}` }; } };
    const api = new ArenaHttpApi(new ArenaApiService(operator, runtime), async () => true, undefined, chain as any);
    await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: operator } });
    const login = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: operator, signature: 'ok' } });
    const headers = { cookie: login.headers['set-cookie'].split(';')[0] };
    assert.equal((await api.handle({ method: 'GET', path: '/api/marketplace/operator/certificates', headers })).body.length, 1);
    const result = await api.handle({ method: 'POST', path: `/api/marketplace/certificates/${certificateDigest}/approve`, headers, body: {} });
    assert.equal(result.status, 200); assert.equal(result.body.state, 'APPROVED'); assert.equal(approved, certificateDigest);
  } finally { runtime.close(); }
});
