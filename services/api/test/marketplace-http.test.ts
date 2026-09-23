import assert from 'node:assert/strict';
import test from 'node:test';
import { ArenaApiService } from '../src/service.ts';
import { ArenaHttpApi } from '../src/http.ts';
import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';

const operator = `0x${'a'.repeat(40)}`;
const alice = `0x${'b'.repeat(40)}`;
const bob = `0x${'c'.repeat(40)}`;

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

test('Marketplace eligibility is approved automatically by the configured system operator', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const certificateDigest = `sha256:${'4'.repeat(64)}`;
    const certificate = { schema: 'arena-marketplace-certificate-v1', certificateDigest,
      evidenceDigest: `sha256:${'5'.repeat(64)}`, owner: alice, agentId: `sha256:${'1'.repeat(64)}`,
      agentVersionId: `sha256:${'2'.repeat(64)}`, agentsCommitment: `sha256:${'3'.repeat(64)}`,
      packId: `sha256:${'6'.repeat(64)}`, packVersion: '1.0.0', rubricVersion: 'v1',
      coverageBps: 10000, overallScore: 90, dimensionScores: {}, maxSpread: 0,
      issuedAt: 1, expiresAt: 9999999999, state: 'ELIGIBLE' as const, erc8004TokenId: '42' };
    runtime.put('marketplace-certificates', certificateDigest, certificate);
    const service = new ArenaApiService(operator, runtime);
    service.createMarketplaceEligibility = (() => structuredClone(certificate)) as typeof service.createMarketplaceEligibility;
    let approved = '';
    let approvalCalls = 0;
    const chain = { async snapshot() { throw new Error('not used'); }, async approveEligibility(input: { digest: string }) {
      approvalCalls += 1;
      approved = input.digest;
      return { transactionId: 'automatic-approval', state: 'COMPLETE', txHash: `0x${'7'.repeat(64)}` };
    } };
    const api = new ArenaHttpApi(service, async () => true, undefined, chain as any);
    await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
    const login = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
    const headers = { cookie: login.headers['set-cookie'].split(';')[0] };
    const result = await api.handle({ method: 'POST', path: '/api/marketplace/eligibility', headers, body: {
      agentId: certificate.agentId, agentsVersion: certificate.agentVersionId,
      campaignIds: [`sha256:${'8'.repeat(64)}`, `sha256:${'9'.repeat(64)}`],
      issuedAt: certificate.issuedAt, expiresAt: certificate.expiresAt,
      network: 'studio-next', chainId: 61997, judgeAddress: operator,
    } });
    assert.equal(result.status, 201);
    assert.equal(result.body.state, 'APPROVED');
    assert.equal(approved, certificateDigest);
    const replay = await api.handle({ method: 'POST', path: '/api/marketplace/eligibility', headers, body: {
      agentId: certificate.agentId, agentsVersion: certificate.agentVersionId,
      campaignIds: [`sha256:${'8'.repeat(64)}`, `sha256:${'9'.repeat(64)}`],
      issuedAt: 2, expiresAt: certificate.expiresAt + 1,
      network: 'studio-next', chainId: 61997, judgeAddress: operator,
    } });
    assert.equal(replay.body.certificateDigest, certificateDigest);
    assert.equal(approvalCalls, 2);
  } finally { runtime.close(); }
});

test('Marketplace reconciles a submitted listing from Arc after service restart', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const agentId = `sha256:${'1'.repeat(64)}`;
    const version = `sha256:${'2'.repeat(64)}`;
    const commitment = `sha256:${'3'.repeat(64)}`;
    runtime.put('marketplace-listings', '1', {
      schema: 'arena-marketplace-listing-v1', listingId: '1', certificateDigest: `sha256:${'4'.repeat(64)}`,
      agentId, agentVersionId: version, agentsCommitment: commitment, erc8004TokenId: '42', name: 'Agent',
      seller: alice, sellerAddress: alice, price: '1000000', expiresAt: 2_000_000_000,
      state: 'SUBMITTED', transaction: { transactionId: 'circle-1', state: 'SENT', txHash: `0x${'5'.repeat(64)}` },
    });
    let reads = 0;
    const chain = { async snapshot(listingId: string) {
      reads += 1;
      return { listingId, tokenId: '42', agentId, version, commitment, sellerAddress: alice, price: '1000000',
        expiresAt: 2_000_000_000, state: 'ACTIVE' as const, registryOwner: alice, registryActive: true };
    } };
    const api = new ArenaHttpApi(new ArenaApiService(operator, runtime), async () => true, undefined, chain);
    const response = await api.handle({ method: 'GET', path: '/api/marketplace/listings' });
    assert.equal(response.status, 200);
    assert.equal(reads, 1);
    assert.deepEqual(response.body.map((row: { state: string }) => row.state), ['ACTIVE']);
    assert.equal(runtime.get<{ state: string }>('marketplace-listings', '1')?.state, 'ACTIVE');
  } finally { runtime.close(); }
});

test('Public Agent reconciliation transfers Arena control after a canonical ERC-8004 sale', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const agentId = `sha256:${'1'.repeat(64)}`;
    const version = `sha256:${'2'.repeat(64)}`;
    const commitment = `sha256:${'3'.repeat(64)}`;
    runtime.put('api-agents', agentId, {
      agentId, owner: alice, name: 'Transferred Agent', active: true,
      erc8004Identity: { schema: 'arena-erc8004-identity-v1', network: 'Arc Testnet', chainId: 5_042_002,
        registryAddress: `0x${'d'.repeat(40)}`, tokenId: '42', ownerAddress: alice,
        agentUri: 'https://arenaiss.xyz/api/agents/example/erc8004.json', transaction: { transactionId: 'identity', state: 'COMPLETE' } },
      versions: [{ agentId, agentsVersion: version, agentsCommitment: commitment, agentsMd: '# Private', createdAt: 1 }],
    });
    runtime.put('marketplace-listings', '7', {
      schema: 'arena-marketplace-listing-v1', listingId: '7', certificateDigest: `sha256:${'4'.repeat(64)}`,
      agentId, agentVersionId: version, agentsCommitment: commitment, erc8004TokenId: '42',
      name: 'Transferred Agent', seller: alice, sellerAddress: alice, buyer: bob, buyerAddress: bob,
      price: '3000000', expiresAt: 2_000_000_000, state: 'SOLD',
    });
    let reads = 0;
    const chain = { async snapshot(listingId: string) {
      reads += 1;
      return { listingId, tokenId: '42', agentId, version, commitment, sellerAddress: alice,
        buyerAddress: bob, price: '3000000', expiresAt: 2_000_000_000, state: 'SOLD' as const,
        registryOwner: bob, registryActive: true };
    } };
    const service = new ArenaApiService(operator, runtime);
    const api = new ArenaHttpApi(service, async () => true, undefined, chain);
    const response = await api.handle({ method: 'GET', path: '/api/public/agents' });
    assert.equal(response.status, 200);
    assert.equal(reads, 1);
    assert.equal(response.body[0].owner, bob);
    assert.equal(response.body[0].erc8004Identity.ownerAddress, bob);
    assert.deepEqual(service.listOwnedAgents(bob).map((agent) => agent.agentId), [agentId]);
    assert.deepEqual(service.listOwnedAgents(alice), []);
  } finally { runtime.close(); }
});

test('Marketplace listing records intent before Circle and reuses the receipt after projection failure', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const agentId = `sha256:${'1'.repeat(64)}`;
    const version = `sha256:${'2'.repeat(64)}`;
    const commitment = `sha256:${'3'.repeat(64)}`;
    const certificateDigest = `sha256:${'4'.repeat(64)}`;
    const userId = `usr_${'9'.repeat(64)}`;
    runtime.put('api-agents', agentId, { agentId, owner: alice, name: 'Agent', erc8004Identity: { tokenId: '42' }, versions: [
      { agentId, agentsVersion: version, agentsCommitment: commitment, agentsMd: '# Agent', createdAt: 1 },
    ], active: true });
    runtime.put('marketplace-certificates', certificateDigest, { schema: 'arena-marketplace-certificate-v1',
      certificateDigest, evidenceDigest: `sha256:${'5'.repeat(64)}`, owner: alice, agentId,
      agentVersionId: version, agentsCommitment: commitment, packId: `sha256:${'6'.repeat(64)}`,
      packVersion: '1.0.0', rubricVersion: 'v1', coverageBps: 10000, overallScore: 90,
      dimensionScores: {}, maxSpread: 0, issuedAt: 1, expiresAt: 3_000_000_000, state: 'APPROVED', erc8004TokenId: '42' });
    let calls = 0;
    let resolves = 0;
    const managed = { loginWallet: async () => ({ principal: alice, userId, identity: { kind: 'WALLET' } }),
      getAccount: async () => ({ principal: alice, userId, identity: { kind: 'WALLET' }, managedWallet: { address: alice } }),
      marketplaceCreateListing: async (inputUserId: string, input: { listingIdempotencyKey: string }) => {
        assert.equal(inputUserId, userId);
        assert.equal(runtime.get<any>('marketplace-listing-intents', certificateDigest)?.listingIdempotencyKey, input.listingIdempotencyKey);
        calls += 1;
        return { transactionId: 'circle-list', state: 'COMPLETE', txHash: `0x${'7'.repeat(64)}` };
      },
      resumeCctpTransfers: async () => {}, resumeUsdcTransfers: async () => {} };
    const chain = { async snapshot() { throw new Error('unused'); }, async approveEligibility() { return { transactionId: 'marketplace-v2-readback', state: 'COMPLETE' }; }, async resolveCreatedListingId() {
      resolves += 1;
      if (resolves === 1) throw new Error('Arc receipt temporarily unavailable');
      return '3';
    } };
    const api = new ArenaHttpApi(new ArenaApiService(operator, runtime), async () => true, undefined, chain as any, undefined, managed as any);
    await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
    const login = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
    const headers = { cookie: login.headers['set-cookie'].split(';')[0] };
    const body = { listingId: '123', agentId, agentsVersion: version, agentsCommitment: commitment,
      certificateDigest, price: '1000000', expiresAt: 2_000_000_000,
      nftApprovalIdempotencyKey: '11111111-1111-4111-8111-111111111111', listingIdempotencyKey: '22222222-2222-4222-8222-222222222222' };
    assert.equal((await api.handle({ method: 'POST', path: '/api/marketplace/listings', headers, body })).status, 503);
    assert.equal(calls, 1);
    const recovered = await api.handle({ method: 'POST', path: '/api/marketplace/listings', headers,
      body: { ...body, nftApprovalIdempotencyKey: '33333333-3333-4333-8333-333333333333', listingIdempotencyKey: '44444444-4444-4444-8444-444444444444' } });
    assert.equal(recovered.status, 202);
    assert.equal(recovered.body.listingId, '3');
    assert.equal(calls, 1);
    assert.equal((await api.handle({ method: 'POST', path: '/api/marketplace/listings', headers, body })).body.listingId, '3');
    assert.equal(calls, 1);
  } finally { runtime.close(); }
});

test('Marketplace cancellation reuses the persisted Circle key after an uncertain response', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const agentId = `sha256:${'1'.repeat(64)}`;
    const version = `sha256:${'2'.repeat(64)}`;
    const commitment = `sha256:${'3'.repeat(64)}`;
    const userId = `usr_${'9'.repeat(64)}`;
    runtime.put('marketplace-listings', '4', { schema: 'arena-marketplace-listing-v1', listingId: '4',
      certificateDigest: `sha256:${'4'.repeat(64)}`, agentId, agentVersionId: version,
      agentsCommitment: commitment, name: 'Agent', seller: alice, sellerAddress: alice,
      price: '1000000', expiresAt: 2_000_000_000, state: 'ACTIVE' });
    const seenKeys: string[] = [];
    const managed = { loginWallet: async () => ({ principal: alice, userId, identity: { kind: 'WALLET' } }),
      getAccount: async () => ({ principal: alice, userId, identity: { kind: 'WALLET' }, managedWallet: { address: alice } }),
      marketplaceCancel: async (_userId: string, _listingId: string, key: string) => {
        seenKeys.push(key);
        if (seenKeys.length === 1) throw new Error('Circle response unknown');
        return { transactionId: 'circle-cancel', state: 'COMPLETE', txHash: `0x${'7'.repeat(64)}` };
      }, resumeCctpTransfers: async () => {}, resumeUsdcTransfers: async () => {} };
    const chain = { async snapshot(listingId: string) { return { listingId, agentId, version, commitment,
      sellerAddress: alice, price: '1000000', expiresAt: 2_000_000_000,
      state: 'CANCELLED' as const, registryOwner: alice, registryActive: true }; } };
    async function authenticatedApi() {
      const api = new ArenaHttpApi(new ArenaApiService(operator, runtime), async () => true, undefined, chain, undefined, managed as any);
      await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
      const login = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
      return { api, headers: { cookie: login.headers['set-cookie'].split(';')[0] } };
    }
    const first = await authenticatedApi();
    const key = '11111111-1111-4111-8111-111111111111';
    assert.equal((await first.api.handle({ method: 'POST', path: '/api/marketplace/listings/4/cancel',
      headers: first.headers, body: { idempotencyKey: key } })).status, 503);
    assert.equal(runtime.get<{ state: string }>('marketplace-listings', '4')?.state, 'CANCEL_SUBMITTED');
    const restarted = await authenticatedApi();
    const retry = await restarted.api.handle({ method: 'POST', path: '/api/marketplace/listings/4/cancel',
      headers: restarted.headers, body: { idempotencyKey: '22222222-2222-4222-8222-222222222222' } });
    assert.equal(retry.status, 202);
    assert.equal(retry.body.state, 'CANCELLED');
    assert.deepEqual(seenKeys, [key, key]);
  } finally { runtime.close(); }
});
