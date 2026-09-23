import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import { ArenaApiService } from '../src/service.ts';

const operator = `0x${'a'.repeat(40)}`;
const seller = `0x${'b'.repeat(40)}`;
const buyer = `0x${'c'.repeat(40)}`;
const agentId = `sha256:${'1'.repeat(64)}` as const;
const version = `sha256:${'2'.repeat(64)}` as const;
const commitment = `sha256:${'3'.repeat(64)}` as const;
const certificateDigest = `sha256:${'4'.repeat(64)}` as const;
const tokenId = '42';

function seedAgent(runtime: SqliteRuntimeStore, owner = seller, ownerAddress = seller) {
  runtime.put('api-agents', agentId, {
    agentId, owner, name: 'Private Agent', active: true,
    erc8004Identity: {
      schema: 'arena-erc8004-identity-v1', network: 'Arc Testnet', chainId: 5_042_002,
      registryAddress: `0x${'d'.repeat(40)}`, tokenId, ownerAddress,
      agentUri: 'https://arenaiss.xyz/api/agents/example/erc8004.json',
      transaction: { transactionId: 'identity', state: 'COMPLETE' },
    },
    versions: [{ agentId, agentsVersion: version, agentsCommitment: commitment, agentsMd: '# Private Agent', createdAt: 1 }],
  });
}

test('Marketplace projection requires exact Arc bindings and delivery requires current buyer ownership', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    seedAgent(runtime);
    runtime.put('marketplace-listings', '1', { schema: 'arena-marketplace-listing-v1', listingId: '1', certificateDigest, agentId, agentVersionId: version, agentsCommitment: commitment, erc8004TokenId: tokenId, name: 'Private Agent', seller, sellerAddress: seller, price: '1000000', expiresAt: 2000, state: 'BUY_SUBMITTED', buyer, buyerAddress: buyer });
    const service = new ArenaApiService(operator, runtime);
    const snapshot = { listingId: '1', tokenId, agentId, version, commitment, sellerAddress: seller, buyerAddress: buyer, price: '1000000', expiresAt: 2000, state: 'SOLD' as const, registryOwner: buyer, registryActive: true };
    assert.throws(() => service.publishMarketplaceListing(seller, snapshot), /operator/);
    assert.throws(() => service.publishMarketplaceListing(operator, { ...snapshot, registryOwner: seller }), /buyer/);
    assert.throws(() => service.publishMarketplaceListing(operator, { ...snapshot, price: '1000001' }), /binding/);
    assert.equal(service.publishMarketplaceListing(operator, snapshot).state, 'SOLD');
    assert.deepEqual(service.listOwnedMarketplacePurchases(buyer).map((row) => row.listingId), ['1']);
    assert.deepEqual(service.listOwnedMarketplacePurchases(seller), []);
    assert.deepEqual(service.listOwnedAgents(buyer).map((row) => row.agentId), [agentId]);
    assert.deepEqual(service.listOwnedAgents(seller), []);
    assert.equal(service.getAgentDetail(buyer, agentId).agentsMd, '# Private Agent');
    assert.throws(() => service.getAgentDetail(seller, agentId), /unauthorized/);
    assert.equal(service.getPublicAgent(agentId).erc8004Identity?.ownerAddress, buyer);
    assert.equal(runtime.get<any>('api-agents', agentId)?.owner, buyer);
    assert.throws(() => service.getMarketplaceDelivery(buyer, '1', { ...snapshot, registryOwner: seller }), /delivery/);
    assert.throws(() => service.getMarketplaceDelivery(seller, '1', snapshot), /delivery/);
    assert.equal(JSON.stringify(service.listMarketplaceListings()).includes('seller"'), false);
  } finally { runtime.close(); }
});

test('Marketplace reconciliation repairs a previously finalized sale with stale Arena ownership', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    seedAgent(runtime);
    runtime.put('marketplace-listings', '9', {
      schema: 'arena-marketplace-listing-v1', listingId: '9', certificateDigest, agentId,
      agentVersionId: version, agentsCommitment: commitment, erc8004TokenId: tokenId,
      name: 'Private Agent', seller, sellerAddress: seller, buyer, buyerAddress: buyer,
      price: '3000000', expiresAt: 3000, state: 'SOLD',
    });
    const service = new ArenaApiService(operator, runtime);
    assert.deepEqual(service.listMarketplaceListingsForReconciliation().map((row) => row.listingId), ['9']);
    const snapshot = { listingId: '9', tokenId, agentId, version, commitment, sellerAddress: seller,
      buyerAddress: buyer, price: '3000000', expiresAt: 3000, state: 'SOLD' as const,
      registryOwner: buyer, registryActive: true };
    assert.equal(service.publishMarketplaceListing(operator, snapshot).state, 'SOLD');
    assert.deepEqual(service.listMarketplaceListingsForReconciliation(), []);
    const restarted = new ArenaApiService(operator, runtime);
    assert.deepEqual(restarted.listOwnedAgents(buyer).map((row) => row.agentId), [agentId]);
    assert.throws(() => restarted.updateAgent(seller, agentId, '# Seller must not retain control'), /unauthorized/);
    assert.equal(restarted.updateAgent(buyer, agentId, '# Buyer controls the Agent').agentsVersion.startsWith('sha256:'), true);
  } finally { runtime.close(); }
});

test('Marketplace purchase binds buyer and replay keys before Circle and recovers a sale after restart', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    seedAgent(runtime);
    runtime.put('marketplace-listings', '2', { schema: 'arena-marketplace-listing-v1', listingId: '2',
      certificateDigest, agentId, agentVersionId: version, agentsCommitment: commitment, erc8004TokenId: tokenId,
      name: 'Agent', seller, sellerAddress: seller, price: '1000000', expiresAt: 2000, state: 'ACTIVE' });
    const service = new ArenaApiService(operator, runtime);
    const keys = { approvalIdempotencyKey: '11111111-1111-4111-8111-111111111111',
      buyIdempotencyKey: '22222222-2222-4222-8222-222222222222' };
    const prepared = service.beginMarketplacePurchase(buyer, '2', buyer, keys);
    assert.deepEqual(prepared, keys);
    assert.equal(runtime.get<{ state: string }>('marketplace-listings', '2')?.state, 'BUY_SUBMITTED');
    const restarted = new ArenaApiService(operator, runtime);
    assert.deepEqual(restarted.beginMarketplacePurchase(buyer, '2', buyer, { approvalIdempotencyKey: 'new', buyIdempotencyKey: 'new' }), keys);
    assert.throws(() => restarted.beginMarketplacePurchase(operator, '2', operator, keys), /unavailable/);
    const snapshot = { listingId: '2', tokenId, agentId, version, commitment, sellerAddress: seller,
      buyerAddress: buyer, price: '1000000', expiresAt: 2000, state: 'SOLD' as const,
      registryOwner: buyer, registryActive: true };
    assert.equal(restarted.publishMarketplaceListing(operator, snapshot).state, 'SOLD');
    assert.deepEqual(restarted.listOwnedMarketplacePurchases(buyer).map((row) => row.listingId), ['2']);
    assert.equal(JSON.stringify(restarted.listMarketplaceListings()).includes(keys.buyIdempotencyKey), false);
  } finally { runtime.close(); }
});

test('Marketplace listing validates and persists a reusable Circle intent before an Arc write', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    runtime.put('api-agents', agentId, { agentId, owner: seller, name: 'Agent', erc8004Identity: { tokenId: '42' }, versions: [
      { agentId, agentsVersion: version, agentsCommitment: commitment, agentsMd: '# Agent', createdAt: 1 },
    ], active: true });
    runtime.put('marketplace-certificates', certificateDigest, { schema: 'arena-marketplace-certificate-v1',
      certificateDigest, evidenceDigest: `sha256:${'5'.repeat(64)}`, owner: seller,
      agentId, agentVersionId: version, agentsCommitment: commitment, packId: `sha256:${'6'.repeat(64)}`,
      packVersion: '1.0.0', rubricVersion: 'v1', coverageBps: 10000, overallScore: 90,
      dimensionScores: {}, maxSpread: 0, issuedAt: 1, expiresAt: 3_000_000_000, state: 'APPROVED', erc8004TokenId: '42' });
    const input = { certificateDigest, agentId, agentsVersion: version, agentsCommitment: commitment,
      sellerAddress: seller, price: '1000000', expiresAt: 2_000_000_000,
      nftApprovalIdempotencyKey: '11111111-1111-4111-8111-111111111111', listingIdempotencyKey: '22222222-2222-4222-8222-222222222222' };
    const service = new ArenaApiService(operator, runtime);
    assert.throws(() => service.beginMarketplaceListing(buyer, input), /approved marketplace certificate/);
    assert.equal(runtime.list('marketplace-listing-intents').length, 0);
    assert.throws(() => service.beginMarketplaceListing(seller, { ...input, expiresAt: 1 }), /invalid marketplace listing/);
    assert.throws(() => service.beginMarketplaceListing(seller, { ...input, price: (2n ** 128n).toString() }), /invalid marketplace listing/);
    assert.equal(runtime.list('marketplace-listing-intents').length, 0);
    const prepared = service.beginMarketplaceListing(seller, input);
    assert.equal(runtime.get<any>('marketplace-listing-intents', certificateDigest)?.nftApprovalIdempotencyKey, input.nftApprovalIdempotencyKey);
    const restarted = new ArenaApiService(operator, runtime);
    assert.equal(restarted.beginMarketplaceListing(seller, { ...input, nftApprovalIdempotencyKey: '33333333-3333-4333-8333-333333333333', listingIdempotencyKey: '44444444-4444-4444-8444-444444444444' }).listingIdempotencyKey, prepared.listingIdempotencyKey);
    assert.throws(() => restarted.beginMarketplaceListing(seller, { ...input, price: '2000000' }), /conflicting marketplace listing intent/);
    restarted.recordMarketplaceListingTransaction(seller, certificateDigest, { transactionId: 'circle-listing', state: 'COMPLETE', txHash: `0x${'7'.repeat(64)}` });
    const listing = restarted.finishMarketplaceListing(seller, certificateDigest, '3');
    assert.equal(listing.state, 'SUBMITTED');
    assert.equal(restarted.finishMarketplaceListing(seller, certificateDigest, '3').listingId, '3');
  } finally { runtime.close(); }
});

test('Marketplace cancellation stores one Circle key and reconciles after restart', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    runtime.put('marketplace-listings', '4', { schema: 'arena-marketplace-listing-v1', listingId: '4',
      certificateDigest, agentId, agentVersionId: version, agentsCommitment: commitment,
      name: 'Agent', seller, sellerAddress: seller, price: '1000000', expiresAt: 2000, state: 'ACTIVE' });
    const first = new ArenaApiService(operator, runtime);
    const key = '11111111-1111-4111-8111-111111111111';
    assert.equal(first.beginMarketplaceCancellation(seller, '4', seller, key), key);
    assert.equal(runtime.get<{ state: string }>('marketplace-listings', '4')?.state, 'CANCEL_SUBMITTED');
    const restarted = new ArenaApiService(operator, runtime);
    assert.equal(restarted.beginMarketplaceCancellation(seller, '4', seller, 'another-key'), key);
    assert.throws(() => restarted.beginMarketplacePurchase(buyer, '4', buyer, { approvalIdempotencyKey: key, buyIdempotencyKey: key }), /unavailable/);
    assert.deepEqual(restarted.listMarketplaceListingsForReconciliation().map((row) => row.listingId), ['4']);
    const snapshot = { listingId: '4', agentId, version, commitment, sellerAddress: seller,
      price: '1000000', expiresAt: 2000, state: 'CANCELLED' as const,
      registryOwner: seller, registryActive: true };
    assert.equal(restarted.publishMarketplaceListing(operator, snapshot).state, 'CANCELLED');
    assert.equal(JSON.stringify(restarted.listMarketplaceListings()).includes(key), false);
  } finally { runtime.close(); }
});
