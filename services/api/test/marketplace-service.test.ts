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
    const campaignId = `sha256:${'5'.repeat(64)}`;
    const tournamentId = `sha256:${'6'.repeat(64)}`;
    const roomId = `sha256:${'7'.repeat(64)}`;
    runtime.put('evaluation-campaigns', campaignId, {
      schema: 'arena-solo-campaign-v1', campaignId, owner: seller,
      agent: { versionId: version, commitment, agentsMd: '# Private Agent' },
      testPack: { packId: `sha256:${'8'.repeat(64)}`, version: '1.0.0', scenarios: [] },
      runtimePolicy: { model: 'fixture', maxOutputTokens: 500, temperature: 0, maxProviderAttempts: 2 },
      rubricVersion: 'AgentEvaluationV5', state: 'PENDING', items: [],
    });
    runtime.put('api-tournaments', tournamentId, { id: tournamentId, name: 'Inherited Arena', status: 'COMPLETED', entrantIds: [], prizePool: '0' });
    runtime.put('api-registrations', 'inherited-registration', {
      tournamentId: `0x${tournamentId.slice(7)}`, entrantId: `0x${'9'.repeat(64)}`,
      agentId: `0x${agentId.slice(7)}`, agentsVersion: `0x${version.slice(7)}`,
      agentsCommitment: `0x${commitment.slice(7)}`, stakeAmount: '1000000',
    });
    runtime.put('pair-rooms-v1', roomId, {
      roomId, roomNumber: 7, creator: seller, creatorWallet: seller,
      creatorAgentId: agentId, creatorVersion: version, challenger: `usr_${'e'.repeat(64)}`,
      challengerWallet: `0x${'e'.repeat(40)}`, challengerAgentId: `sha256:${'e'.repeat(64)}`,
      challengerVersion: `sha256:${'f'.repeat(64)}`, stake: '1000000', joinDeadline: 100,
      resolutionDeadline: 200, state: 'SETTLED', createdAt: 10,
    });
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
    const detail = service.getAgentDetail(buyer, agentId);
    assert.equal(detail.agentsMd, '# Private Agent');
    assert.deepEqual(detail.evaluations.map((row) => row.campaignId), [campaignId]);
    assert.deepEqual(detail.tournaments.map((row) => row.id), [tournamentId]);
    assert.deepEqual(detail.activity?.pairMatches, [{ roomId, state: 'SETTLED', role: 'CREATOR', createdAt: 10 }]);
    assert.deepEqual(service.listOwnedRegistrations(buyer), [{ tournamentId: `0x${tournamentId.slice(7)}`, entrantId: `0x${'9'.repeat(64)}`, agentId: `0x${agentId.slice(7)}` }]);
    assert.throws(() => service.getAgentDetail(seller, agentId), /unauthorized/);
    assert.equal(service.getPublicAgent(agentId).erc8004Identity?.ownerAddress, buyer);
    assert.equal(runtime.get<any>('api-agents', agentId)?.owner, buyer);
    assert.throws(() => service.getMarketplaceDelivery(buyer, '1', { ...snapshot, registryOwner: seller }), /delivery/);
    assert.throws(() => service.getMarketplaceDelivery(seller, '1', snapshot), /delivery/);
    assert.equal(JSON.stringify(service.listMarketplaceListings()).includes('seller"'), false);
  } finally { runtime.close(); }
});

test('public Marketplace exposes only active listings while owner and buyer records remain private', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const rows = [
      { listingId: '1', state: 'ACTIVE', seller, price: '1000000' },
      { listingId: '2', state: 'SOLD', seller, buyer, buyerAddress: buyer, price: '2000000' },
      { listingId: '3', state: 'BUY_SUBMITTED', seller, buyer, buyerAddress: buyer, price: '3000000' },
      { listingId: '4', state: 'CANCEL_SUBMITTED', seller, price: '4000000' },
    ];
    for (const row of rows) runtime.put('marketplace-listings', row.listingId, {
      schema: 'arena-marketplace-listing-v1', certificateDigest, agentId, agentVersionId: version,
      agentsCommitment: commitment, erc8004TokenId: tokenId, name: `Agent ${row.listingId}`,
      sellerAddress: seller, expiresAt: 2000, ...row,
    });
    const service = new ArenaApiService(operator, runtime);
    assert.deepEqual(service.listMarketplaceListings().map((row) => row.listingId), ['1']);
    assert.deepEqual(service.listOwnedMarketplaceListings(seller).map((row) => row.listingId), ['4', '3', '2', '1']);
    assert.deepEqual(service.listOwnedMarketplacePurchases(buyer).map((row) => row.listingId), ['3', '2']);
  } finally { runtime.close(); }
});

test('a completed sale does not block the current owner from certifying the same Agent version again', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    seedAgent(runtime, buyer, buyer);
    runtime.put('marketplace-listings', '1', {
      schema: 'arena-marketplace-listing-v1', listingId: '1', certificateDigest, agentId,
      agentVersionId: version, agentsCommitment: commitment, erc8004TokenId: tokenId,
      name: 'Private Agent', seller, sellerAddress: seller, buyer, buyerAddress: buyer,
      price: '1000000', expiresAt: 2_000, state: 'SOLD',
    });
    const service = new ArenaApiService(operator, runtime);
    assert.throws(() => service.createMarketplaceEligibility(buyer, {
      agentId, agentsVersion: version, campaignIds: [], issuedAt: 3_000, expiresAt: 4_000,
      network: 'studio-next', chainId: 61_997, judgeAddress: operator,
    }), /exactly two evaluation campaigns are required/);
  } finally { runtime.close(); }
});

test('verified evaluation evidence follows an ERC-8004 Agent to its new owner for relisting', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    seedAgent(runtime, buyer, buyer);
    const scenarioIds = Array.from({ length: 6 }, (_, index) => `inherited_${index + 1}`);
    const campaignIds = [`sha256:${'8'.repeat(64)}`, `sha256:${'9'.repeat(64)}`] as const;
    for (const [campaignIndex, campaignId] of campaignIds.entries()) {
      const items = scenarioIds.map((scenarioId, scenarioIndex) => {
        const runId = `sha256:${(campaignIndex * 6 + scenarioIndex + 10).toString(16).padStart(64, '0')}`;
        runtime.put('evaluation-runs', runId, {
          schema: 'arena-evaluation-run-v1', runId,
          input: { mode: 'ACTION_DECISION', agent: { version_id: version, commitment }, scenario: { scenario_id: scenarioId } },
          rubricVersion: 'AgentEvaluationV5', provider: { state: 'SUCCESS', model: 'fixture' }, judge: { state: 'FINALIZED' },
          scorecard: { status: 'FINAL', run_id: runId, agent_version_id: version, agents_digest: commitment,
            rubric_version: 'AgentEvaluationV5', result_class: 'PASS', overall_score: 90, policy_findings: [],
            dimensions: ['instruction_adherence', 'reasoning_quality', 'action_selection', 'rule_compliance', 'task_completion', 'safety']
              .map((dimension_id) => ({ dimension_id, grade: 'EXCELLENT' })) },
        });
        return { scenarioId, state: 'FINALIZED', attempt: 1, runIds: [runId], currentRunId: runId };
      });
      runtime.put('evaluation-campaigns', campaignId, {
        schema: 'arena-solo-campaign-v1', campaignId, owner: seller,
        agent: { versionId: version, commitment, agentsMd: '# Private Agent' },
        testPack: { packId: `sha256:${'6'.repeat(64)}`, version: '1.0.0', scenarios: scenarioIds.map((scenarioId) => ({ scenarioId })) },
        runtimePolicy: { model: 'fixture', maxOutputTokens: 500, temperature: 0, maxProviderAttempts: 2 },
        rubricVersion: 'AgentEvaluationV5', state: 'FINALIZED', items,
      });
    }
    runtime.put('evaluation-campaigns', `sha256:${'7'.repeat(64)}`, {
      schema: 'arena-solo-campaign-v1', campaignId: `sha256:${'7'.repeat(64)}`, owner: seller,
      agent: { versionId: version, commitment, agentsMd: '# Private Agent' },
      testPack: { packId: `sha256:${'6'.repeat(64)}`, version: '1.0.0', scenarios: [] },
      runtimePolicy: { model: 'fixture', maxOutputTokens: 500, temperature: 0, maxProviderAttempts: 2 },
      rubricVersion: 'AgentEvaluationV5', state: 'PENDING', items: [],
    });

    seedAgent(runtime);
    const original = new ArenaApiService(operator, runtime).createMarketplaceEligibility(seller, {
      agentId, agentsVersion: version, campaignIds: [...campaignIds], issuedAt: 2_000, expiresAt: 4_000,
      network: 'studio-next', chainId: 61_997, judgeAddress: operator,
    });
    runtime.put('marketplace-listings', '10', {
      schema: 'arena-marketplace-listing-v1', listingId: '10', certificateDigest: original.certificateDigest,
      agentId, agentVersionId: version, agentsCommitment: commitment, erc8004TokenId: tokenId,
      name: 'Private Agent', seller, sellerAddress: seller, buyer, buyerAddress: buyer,
      price: '1000000', expiresAt: 4_000, state: 'BUY_SUBMITTED',
    });
    const service = new ArenaApiService(operator, runtime);
    service.publishMarketplaceListing(operator, { listingId: '10', tokenId, agentId, version, commitment,
      sellerAddress: seller, buyerAddress: buyer, registryOwner: buyer, registryActive: true,
      price: '1000000', expiresAt: 4_000, state: 'SOLD' });
    assert.deepEqual(service.listOwnedEvaluationCampaigns(buyer).map((row) => row.campaignId), [...campaignIds].reverse());
    assert.equal(JSON.stringify(service.listOwnedEvaluationCampaigns(buyer)).includes('# Private Agent'), false);
    const certificate = service.createMarketplaceEligibility(buyer, {
      agentId, agentsVersion: version, campaignIds: [...campaignIds], issuedAt: 3_000, expiresAt: 4_000,
      network: 'studio-next', chainId: 61_997, judgeAddress: operator,
    });
    assert.equal(certificate.owner, buyer);
    assert.equal(certificate.agentVersionId, version);
    assert.equal(certificate.state, 'ELIGIBLE');
    assert.notEqual(certificate.certificateDigest, original.certificateDigest);
    assert.equal(certificate.evidenceDigest, original.evidenceDigest);
    assert.deepEqual(certificate.dimensionScores, original.dimensionScores);
    assert.equal(runtime.list('evaluation-runs').length, 12);
    assert.throws(() => service.createMarketplaceEligibility(seller, {
      agentId, agentsVersion: version, campaignIds: [...campaignIds], issuedAt: 3_001, expiresAt: 4_001,
      network: 'studio-next', chainId: 61_997, judgeAddress: operator,
    }), /unauthorized/);
    const updated = service.updateAgent(buyer, agentId, '# Changed Agent');
    assert.throws(() => service.createMarketplaceEligibility(buyer, {
      agentId, agentsVersion: updated.agentsVersion, campaignIds: [...campaignIds], issuedAt: 3_002, expiresAt: 4_002,
      network: 'studio-next', chainId: 61_997, judgeAddress: operator,
    }), /evaluation campaign is not finalized or bound to this version/);
  } finally { runtime.close(); }
});

test('Marketplace public profile is bound to the exact Agent version being sold', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const newerVersion = `sha256:${'8'.repeat(64)}` as const;
    const newerCommitment = `sha256:${'9'.repeat(64)}` as const;
    runtime.put('api-agents', agentId, {
      agentId, owner: seller, name: 'Versioned Agent', active: true,
      erc8004Identity: {
        schema: 'arena-erc8004-identity-v1', network: 'Arc Testnet', chainId: 5_042_002,
        registryAddress: `0x${'d'.repeat(40)}`, tokenId, ownerAddress: seller,
        agentUri: 'https://arenaiss.xyz/api/agents/example/erc8004.json',
        transaction: { transactionId: 'identity', state: 'COMPLETE' },
      },
      versions: [
        { agentId, agentsVersion: version, agentsCommitment: commitment, agentsMd: '# Sold version', createdAt: 1 },
        { agentId, agentsVersion: newerVersion, agentsCommitment: newerCommitment, agentsMd: '# Newer private version', createdAt: 2 },
      ],
    });
    runtime.put('marketplace-listings', '6', {
      schema: 'arena-marketplace-listing-v1', listingId: '6', certificateDigest, agentId,
      agentVersionId: version, agentsCommitment: commitment, erc8004TokenId: tokenId,
      name: 'Versioned Agent', seller, sellerAddress: seller, price: '1000000', expiresAt: 2_000_000_000, state: 'ACTIVE',
    });

    const profile = new ArenaApiService(operator, runtime).getMarketplaceListingProfile('6');
    assert.equal(profile.agentsVersion, version);
    assert.equal(profile.agentsCommitment, commitment);
    assert.equal(profile.createdAt, 1);
    assert.equal(profile.erc8004Identity?.tokenId, tokenId);
    assert.equal(JSON.stringify(profile).includes('Sold version'), false);
    assert.equal(JSON.stringify(profile).includes('Newer private version'), false);
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

test('Arc-active listing recovers an abandoned purchase lock without reopening an in-flight purchase', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    seedAgent(runtime);
    runtime.put('marketplace-listings', '5', { schema: 'arena-marketplace-listing-v1', listingId: '5',
      certificateDigest, agentId, agentVersionId: version, agentsCommitment: commitment, erc8004TokenId: tokenId,
      name: 'Agent', seller, sellerAddress: seller, price: '5000000', expiresAt: 2_000,
      state: 'BUY_SUBMITTED', buyer, buyerAddress: buyer,
      purchaseApprovalIdempotencyKey: '11111111-1111-4111-8111-111111111111',
      purchaseIdempotencyKey: '22222222-2222-4222-8222-222222222222' });
    const activeSnapshot = { listingId: '5', tokenId, agentId, version, commitment, sellerAddress: seller,
      price: '5000000', expiresAt: 2_000, state: 'ACTIVE' as const,
      registryOwner: seller, registryActive: true };
    const recovered = new ArenaApiService(operator, runtime, () => 1_000);
    assert.equal(recovered.publishMarketplaceListing(operator, activeSnapshot).state, 'ACTIVE');
    assert.deepEqual(recovered.listMarketplaceListings().map((row) => row.listingId), ['5']);
    assert.equal(recovered.listOwnedMarketplacePurchases(buyer).length, 0);

    const keys = { approvalIdempotencyKey: '33333333-3333-4333-8333-333333333333',
      buyIdempotencyKey: '44444444-4444-4444-8444-444444444444' };
    recovered.beginMarketplacePurchase(buyer, '5', buyer, keys);
    const inFlight = recovered.publishMarketplaceListing(operator, activeSnapshot);
    assert.equal(inFlight.state, 'BUY_SUBMITTED');
    assert.equal('purchaseStartedAt' in inFlight, false);
    assert.equal(recovered.listMarketplaceListings().length, 0);

    const afterGrace = new ArenaApiService(operator, runtime, () => 1_301);
    assert.equal(afterGrace.publishMarketplaceListing(operator, activeSnapshot).state, 'ACTIVE');
    assert.deepEqual(afterGrace.listMarketplaceListings().map((row) => row.listingId), ['5']);
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
    assert.deepEqual(restarted.listOwnedMarketplaceCertificates(seller), []);
    assert.throws(() => restarted.createMarketplaceEligibility(seller, { agentId, agentsVersion: version,
      campaignIds: [`sha256:${'8'.repeat(64)}`, `sha256:${'9'.repeat(64)}`], issuedAt: 2,
      expiresAt: 2_100_000_000, network: 'studio-next', chainId: 61997, judgeAddress: operator }),
    /Agent version already has a Marketplace listing/);
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
