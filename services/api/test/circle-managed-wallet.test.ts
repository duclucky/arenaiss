import assert from 'node:assert/strict';
import test from 'node:test';

import { CircleManagedWalletAdapter } from '../src/circle-managed-wallet.ts';

test('Circle adapter creates exactly one Arc Testnet EOA and forwards the persisted idempotency key', async () => {
  const calls: any[] = [];
  const adapter = new CircleManagedWalletAdapter({
    async createWallets(input: any) {
      calls.push(input);
      return { data: { wallets: [{ id: 'wallet-id', address: '0x1111111111111111111111111111111111111111' }] } };
    },
  }, 'wallet-set-id');

  const result = await adapter.createWallet({
    userId: `usr_${'a'.repeat(64)}`,
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  });

  assert.deepEqual(calls, [{
    accountType: 'EOA',
    blockchains: ['ARC-TESTNET'],
    count: 1,
    walletSetId: 'wallet-set-id',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    metadata: [{ name: 'Arena ISS managed wallet', refId: `usr_${'a'.repeat(64)}` }],
  }]);
  assert.deepEqual(result, { walletId: 'wallet-id', address: '0x1111111111111111111111111111111111111111' });
});

test('Circle adapter rejects incomplete or multiple-wallet responses', async () => {
  const adapter = new CircleManagedWalletAdapter({
    async createWallets() { return { data: { wallets: [] } }; },
  }, 'wallet-set-id');
  await assert.rejects(
    adapter.createWallet({ userId: `usr_${'b'.repeat(64)}`, idempotencyKey: 'idempotency-key' }),
    /invalid wallet response/,
  );
});
