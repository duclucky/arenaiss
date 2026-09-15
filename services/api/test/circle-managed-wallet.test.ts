import assert from 'node:assert/strict';
import test from 'node:test';

import { CircleManagedWalletAdapter } from '../src/circle-managed-wallet.ts';

test('Circle adapter creates exactly one Arc Testnet SCA for automatic Gas Station sponsorship', async () => {
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
    accountType: 'SCA',
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

test('Circle adapter registers and deactivates an Agent through the Arc registry', async () => {
  const executions: any[] = [];
  const adapter = new CircleManagedWalletAdapter({
    async createContractExecutionTransaction(input: any) { executions.push(input); return { data: { id: `tx-${executions.length}` } }; },
    async getTransaction({ id }: any) { return { data: { transaction: { id, state: 'SENT', txHash: `0x${String(executions.length).repeat(64)}` } } }; },
  } as any, 'wallet-set-id');
  const registryAddress = '0x3333333333333333333333333333333333333333';
  const agentId = `sha256:${'a'.repeat(64)}`;
  const agentsVersion = `sha256:${'b'.repeat(64)}`;
  const agentsCommitment = `sha256:${'c'.repeat(64)}`;

  const registered = await adapter.registerAgent({ walletId: 'wallet-id', registryAddress, agentId, agentsVersion, agentsCommitment, idempotencyKey: 'register-key' });
  const deactivated = await adapter.deactivateAgent({ walletId: 'wallet-id', registryAddress, agentId, idempotencyKey: 'deactivate-key' });

  assert.equal(executions[0].abiFunctionSignature, 'registerAgent(bytes32,bytes32,bytes32)');
  assert.deepEqual(executions[0].abiParameters, [`0x${'a'.repeat(64)}`, `0x${'b'.repeat(64)}`, `0x${'c'.repeat(64)}`]);
  assert.equal(executions[1].abiFunctionSignature, 'deactivateAgent(bytes32)');
  assert.deepEqual(executions[1].abiParameters, [`0x${'a'.repeat(64)}`]);
  assert.match(registered.explorerUrl!, /^https:\/\/testnet\.arcscan\.app\/tx\//);
  assert.match(deactivated.explorerUrl!, /^https:\/\/testnet\.arcscan\.app\/tx\//);
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

test('Circle adapter reuses separately persisted approval and burn idempotency keys', async () => {
  const executions: any[] = [];
  const progress: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([
    { finalityThreshold: 1000, minimumFee: 0, forwardFee: { med: '1' } },
  ]), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const adapter = new CircleManagedWalletAdapter({
      async deriveWallet({ blockchain }: any) {
        return { data: { wallet: { id: blockchain, address: '0x1111111111111111111111111111111111111111' } } };
      },
      async createContractExecutionTransaction(input: any) {
        executions.push(input);
        return { data: { id: executions.length === 1 ? 'approval-id' : 'burn-id' } };
      },
      async getTransaction({ id }: any) {
        return { data: { transaction: { id, state: id === 'approval-id' ? 'COMPLETE' : 'SENT', txHash: id === 'burn-id' ? `0x${'4'.repeat(64)}` : undefined } } };
      },
    } as any, 'wallet-set-id');

    const result = await adapter.bridgeUsdcToArc({
      walletId: 'wallet-id',
      address: '0x1111111111111111111111111111111111111111',
      sourceChain: 'BASE-SEPOLIA',
      amount: '1',
      approvalIdempotencyKey: '11111111-1111-4111-8111-111111111111',
      burnIdempotencyKey: '22222222-2222-4222-8222-222222222222',
      onProgress: (state: string) => progress.push(state),
    } as any);

    assert.equal(executions[0].idempotencyKey, '11111111-1111-4111-8111-111111111111');
    assert.equal(executions[1].idempotencyKey, '22222222-2222-4222-8222-222222222222');
    assert.deepEqual(progress, ['APPROVING', 'BURNING']);
    assert.equal(result.txHash, `0x${'4'.repeat(64)}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
