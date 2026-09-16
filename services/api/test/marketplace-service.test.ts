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

test('Marketplace projection requires exact Arc bindings and delivery requires current buyer ownership', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    runtime.put('marketplace-listings', '1', { schema: 'arena-marketplace-listing-v1', listingId: '1', certificateDigest, agentId, agentVersionId: version, agentsCommitment: commitment, name: 'Private Agent', seller, sellerAddress: seller, price: '1000000', expiresAt: 2000, state: 'BUY_SUBMITTED', buyer, buyerAddress: buyer });
    const service = new ArenaApiService(operator, runtime);
    const snapshot = { listingId: '1', agentId, version, commitment, sellerAddress: seller, buyerAddress: buyer, price: '1000000', expiresAt: 2000, state: 'SOLD' as const, registryOwner: buyer, registryActive: true };
    assert.throws(() => service.publishMarketplaceListing(seller, snapshot), /operator/);
    assert.throws(() => service.publishMarketplaceListing(operator, { ...snapshot, registryOwner: seller }), /buyer/);
    assert.throws(() => service.publishMarketplaceListing(operator, { ...snapshot, price: '1000001' }), /binding/);
    assert.equal(service.publishMarketplaceListing(operator, snapshot).state, 'SOLD');
    assert.deepEqual(service.listOwnedMarketplacePurchases(buyer).map((row) => row.listingId), ['1']);
    assert.deepEqual(service.listOwnedMarketplacePurchases(seller), []);
    assert.throws(() => service.getMarketplaceDelivery(buyer, '1', { ...snapshot, registryOwner: seller }), /delivery/);
    assert.throws(() => service.getMarketplaceDelivery(seller, '1', snapshot), /delivery/);
    assert.equal(JSON.stringify(service.listMarketplaceListings()).includes('seller"'), false);
  } finally { runtime.close(); }
});
