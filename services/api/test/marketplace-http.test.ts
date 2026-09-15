import assert from 'node:assert/strict';
import test from 'node:test';
import { ArenaApiService } from '../src/service.ts';
import { ArenaHttpApi } from '../src/http.ts';

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
  assert.equal((await api.handle({ method: 'POST', path: '/api/marketplace/listings/1/buy', headers, body: { confirm: true } })).status, 503);
  assert.equal((await api.handle({ method: 'GET', path: '/api/marketplace/listings/1/delivery', headers })).status, 503);
});
