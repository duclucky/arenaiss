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
  } as any, 'wallet-set-id');

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
  } as any, 'wallet-set-id');
  await assert.rejects(
    adapter.createWallet({ userId: `usr_${'b'.repeat(64)}`, idempotencyKey: 'idempotency-key' }),
    /invalid wallet response/,
  );
});

test('Circle adapter reads Arc plus non-zero crosschain USDC balances and submits Arc withdrawal', async () => {
  const transfers: any[] = [];
  const adapter = new CircleManagedWalletAdapter({
    async deriveWallet({ blockchain }: any) { return { data: { wallet: { id: blockchain, address: '0x1111111111111111111111111111111111111111' } } }; },
    async getWalletTokenBalance({ id }: any) {
      const amount = id === 'wallet-id' ? '2.5' : id === 'BASE-SEPOLIA' ? '1' : '0';
      return { data: { tokenBalances: [{ amount, token: { symbol: 'USDC', isNative: false } }] } };
    },
    async createTransaction(input: any) { transfers.push(input); return { data: { id: 'transaction-id', state: 'INITIATED' } }; },
    async getTransaction() { return { data: { transaction: { id: 'transaction-id', state: 'SENT', txHash: `0x${'3'.repeat(64)}` } } }; },
  } as any, 'wallet-set-id');

  const balances = await adapter.listUsdcBalances({ walletId: 'wallet-id', address: '0x1111111111111111111111111111111111111111' });
  assert.deepEqual(balances.map(({ chain, amount }) => ({ chain, amount })), [
    { chain: 'ARC-TESTNET', amount: '2.5' }, { chain: 'BASE-SEPOLIA', amount: '1' },
  ]);
  const result = await adapter.transferUsdc({ walletId: 'wallet-id', destinationAddress: '0x2222222222222222222222222222222222222222', amount: '1.25', idempotencyKey: '11111111-1111-4111-8111-111111111111' });
  assert.equal(result.transactionId, 'transaction-id');
  assert.equal(transfers[0].tokenAddress, '0x3600000000000000000000000000000000000000');
  assert.deepEqual(transfers[0].amount, ['1.25']);
});
