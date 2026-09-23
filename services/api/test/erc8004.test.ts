import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeAbiParameters, encodeEventTopics } from 'viem';

import {
  buildErc8004RegistrationFile,
  Erc8004ReputationService,
  parseNewFeedbackIndex,
  parseRegisteredAgentId,
} from '../src/erc8004.ts';
import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';

const registry = `0x${'8'.repeat(40)}` as const;
const owner = `0x${'4'.repeat(40)}` as const;

test('ERC-8004 registration file exposes discovery metadata without private AGENTS.md', () => {
  const file = buildErc8004RegistrationFile({
    name: 'Safety Scout',
    active: true,
    arenaAgentId: `sha256:${'a'.repeat(64)}`,
    agentsVersion: `sha256:${'b'.repeat(64)}`,
    agentsCommitment: `sha256:${'c'.repeat(64)}`,
    identityRegistry: registry,
    tokenId: '17',
    chainId: 5_042_002,
    applicationUrl: 'http://localhost:5173/agents',
  });

  assert.equal(file.type, 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
  assert.deepEqual(file.registrations, [{ agentId: 17, agentRegistry: `eip155:5042002:${registry.toLowerCase()}` }]);
  assert.deepEqual(file.services, [{ name: 'web', endpoint: 'http://localhost:5173/agents' }]);
  assert.equal(file.active, true);
  assert.equal(file.arena.agentsCommitment, `sha256:${'c'.repeat(64)}`);
  assert.equal(JSON.stringify(file).includes('AGENTS.md'), false);
  assert.equal(JSON.stringify(file).includes('private'), false);
});

test('NewFeedback receipt parser preserves the official one-based feedback index', () => {
  const reputation = '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const;
  const evaluator = `0x${'9'.repeat(40)}` as const;
  const abi = [{ type: 'event', name: 'NewFeedback', inputs: [
    { indexed: true, name: 'agentId', type: 'uint256' }, { indexed: true, name: 'clientAddress', type: 'address' },
    { indexed: false, name: 'feedbackIndex', type: 'uint64' }, { indexed: false, name: 'value', type: 'int128' },
    { indexed: false, name: 'valueDecimals', type: 'uint8' }, { indexed: true, name: 'indexedTag1', type: 'string' },
    { indexed: false, name: 'tag1', type: 'string' }, { indexed: false, name: 'tag2', type: 'string' },
    { indexed: false, name: 'endpoint', type: 'string' }, { indexed: false, name: 'feedbackURI', type: 'string' },
    { indexed: false, name: 'feedbackHash', type: 'bytes32' },
  ] }] as const;
  const topics = encodeEventTopics({ abi, eventName: 'NewFeedback', args: { agentId: 17n, clientAddress: evaluator, indexedTag1: 'arena-evo' } });
  const data = encodeAbiParameters([
    { type: 'uint64' }, { type: 'int128' }, { type: 'uint8' }, { type: 'string' }, { type: 'string' },
    { type: 'string' }, { type: 'string' }, { type: 'bytes32' },
  ], [1n, 85n, 0, 'arena-evo', 'AgentEvaluationV5', '', 'https://arena/evidence.json', `0x${'a'.repeat(64)}`]);
  assert.equal(parseNewFeedbackIndex({ status: 'success', logs: [{ address: reputation, topics, data }] }, {
    reputationRegistryAddress: reputation, agentId: '17', evaluatorAddress: evaluator, value: 85, valueDecimals: 0,
    tag1: 'arena-evo', tag2: 'AgentEvaluationV5',
  }), 1);
});

test('Registered receipt parser binds exact registry, owner and URI', () => {
  const uri = `https://arenaiss.xyz/api/agents/sha256:${'a'.repeat(64)}/erc8004.json`;
  const topics = encodeEventTopics({
    abi: [{ type: 'event', name: 'Registered', inputs: [
      { indexed: true, name: 'agentId', type: 'uint256' },
      { indexed: false, name: 'agentURI', type: 'string' },
      { indexed: true, name: 'owner', type: 'address' },
    ] }],
    eventName: 'Registered', args: { agentId: 17n, owner },
  });
  const receipt = { status: 'success', logs: [{ address: registry, topics, data: encodeAbiParameters([{ type: 'string' }], [uri]) }] };

  assert.equal(parseRegisteredAgentId(receipt, { registryAddress: registry, owner, agentUri: uri }), '17');
  assert.throws(() => parseRegisteredAgentId(receipt, { registryAddress: registry, owner: `0x${'5'.repeat(40)}`, agentUri: uri }), /matching Registered event/i);
  assert.throws(() => parseRegisteredAgentId({ ...receipt, status: 'reverted' }, { registryAddress: registry, owner, agentUri: uri }), /did not succeed/i);
});

test('finalized Evo queues one durable ERC-8004 feedback and retry never blocks settlement', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    let writes = 0;
    const service = new Erc8004ReputationService({
      runtime,
      publicBaseUrl: 'http://localhost:5173',
      registryAddress: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
      evaluatorAddress: `0x${'9'.repeat(40)}`,
      resolveIdentity: () => ({
        schema: 'arena-erc8004-identity-v1', network: 'Arc Testnet', chainId: 5_042_002,
        registryAddress: registry, tokenId: '17', ownerAddress: owner,
        agentUri: 'http://localhost:5173/api/agents/a/erc8004.json', transaction: { transactionId: 'identity', state: 'COMPLETE' },
      }),
      writer: { async giveFeedback(input: any) { writes += 1; if (writes === 1) throw new Error('temporary'); return { transactionId: 'feedback', state: 'COMPLETE', txHash: `0x${'7'.repeat(64)}` }; } },
      chain: { async confirmFeedback() { return { feedbackIndex: 1 }; } },
    });
    const campaign: any = {
      campaignId: `sha256:${'d'.repeat(64)}`, owner, state: 'FINALIZED', rubricVersion: 'AgentEvaluationV5',
      agent: { versionId: `sha256:${'b'.repeat(64)}` },
      items: [{ scenarioId: 'one', scorecard: { overall_score: 80 } }, { scenarioId: 'two', scorecard: { overall_score: 90 } }],
    };

    const failed = await service.recordFinalizedCampaign(campaign);
    assert.equal(failed?.state, 'FAILED');
    assert.equal(failed?.value, 85);
    assert.match(failed?.feedbackHash || '', /^0x[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(service.getFeedbackDocument(campaign.campaignId)).includes('agentsMd'), false);
    assert.deepEqual(await service.resumePending(), { attempted: 1, succeeded: 1, failed: 0 });
    assert.equal(service.get(campaign.campaignId)?.state, 'COMPLETE');
    assert.equal(service.get(campaign.campaignId)?.feedbackIndex, 1);
    await service.recordFinalizedCampaign(campaign);
    assert.equal(writes, 2);
  } finally { runtime.close(); }
});
