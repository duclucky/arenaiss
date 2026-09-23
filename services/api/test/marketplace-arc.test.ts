import assert from 'node:assert/strict';
import test from 'node:test';
import { ViemMarketplaceChainPort, marketplaceConfigured } from '../src/marketplace-arc.ts';

test('Marketplace Arc port is strict-configured and rejects invalid listing identifiers before RPC', async () => {
  assert.equal(marketplaceConfigured({} as NodeJS.ProcessEnv), false);
  assert.equal(marketplaceConfigured({ ARC_MARKETPLACE_ADDRESS: 'x', ARC_ERC8004_IDENTITY_REGISTRY_ADDRESS: 'y', ARC_TESTNET_RPC_URL: 'z' } as NodeJS.ProcessEnv), true);
  assert.throws(() => new ViemMarketplaceChainPort({ rpcUrl: 'http://localhost', identityRegistryAddress: `0x${'1'.repeat(40)}`, marketplaceAddress: `0x${'2'.repeat(40)}` }), /configuration/);
  const port = new ViemMarketplaceChainPort({ rpcUrl: 'https://rpc.testnet.arc.network', identityRegistryAddress: `0x${'1'.repeat(40)}`, marketplaceAddress: `0x${'2'.repeat(40)}` });
  await assert.rejects(() => port.snapshot('0'), /listing ID/);
});
