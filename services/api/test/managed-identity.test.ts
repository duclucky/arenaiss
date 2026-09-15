import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import { ManagedIdentityService } from '../src/managed-identity.ts';

const address = '0x1111111111111111111111111111111111111111';

function options(runtime: SqliteRuntimeStore, createWallet: (input: any) => Promise<any>) {
  return {
    runtime,
    identityPepper: 'test-only-pepper-with-at-least-32-bytes',
    circleWallets: { createWallet },
    emailSender: { sendLoginCode: async () => undefined },
  };
}

test('concurrent logins share one Circle wallet provisioning operation', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = new ManagedIdentityService(options(runtime, async () => {
      calls += 1;
      await gate;
      return { walletId: 'wallet-id', address };
    }));

    const first = service.loginWallet(address);
    const second = service.loginWallet(address);
    release();
    const [one, two] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.deepEqual(one.managedWallet, two.managedWallet);
  } finally { runtime.close(); }
});

test('restart retries a failed provisioning operation with the same persisted idempotency key', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const keys: string[] = [];
    const failing = new ManagedIdentityService(options(runtime, async ({ idempotencyKey }) => {
      keys.push(idempotencyKey);
      throw new Error('temporary Circle failure');
    }));
    await assert.rejects(failing.loginWallet(address), /provisioning failed/);

    const restarted = new ManagedIdentityService(options(runtime, async ({ idempotencyKey }) => {
      keys.push(idempotencyKey);
      return { walletId: 'wallet-id', address };
    }));
    const account = await restarted.loginWallet(address);
    assert.equal(account.managedWallet.walletId, 'wallet-id');
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.match(keys[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally { runtime.close(); }
});

test('existing EOA is archived and replaced by a new SCA without reusing its creation key', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const identityKey = `wallet:${address}`;
    const userId = `usr_${'a'.repeat(64)}`;
    runtime.put('auth-identities', identityKey, { identityKey, kind: 'WALLET', userId, principal: address, createdAt: 1 });
    const legacy = { state: 'READY', userId, walletId: 'old-eoa', address,
      blockchain: 'ARC-TESTNET', accountType: 'EOA', idempotencyKey: 'old-key', updatedAt: 1 };
    runtime.put('circle-wallets', userId, legacy);
    const keys: string[] = [];
    const service = new ManagedIdentityService(options(runtime, async ({ idempotencyKey }) => {
      keys.push(idempotencyKey);
      return { walletId: 'new-sca', address: '0x2222222222222222222222222222222222222222' };
    }));
    const account = await service.getAccount(userId, 'WALLET');
    assert.equal(account.managedWallet.accountType, 'SCA');
    assert.equal(account.managedWallet.walletId, 'new-sca');
    assert.notEqual(keys[0], 'old-key');
    assert.deepEqual(runtime.get('circle-wallets-legacy', userId), legacy);
    assert.equal((await service.loginWallet(address)).managedWallet.walletId, 'new-sca');
    assert.equal(keys.length, 1);
  } finally { runtime.close(); }
});

test('failed EOA replacement retries the new SCA idempotency key after restart', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const userId = `usr_${'b'.repeat(64)}`;
    const identityKey = `wallet:${address}`;
    runtime.put('auth-identities', identityKey, { identityKey, kind: 'WALLET', userId, principal: address, createdAt: 1 });
    runtime.put('circle-wallets', userId, { state: 'READY', userId, walletId: 'old-eoa', address,
      blockchain: 'ARC-TESTNET', accountType: 'EOA', idempotencyKey: 'old-key', updatedAt: 1 });
    const keys: string[] = [];
    const failing = new ManagedIdentityService(options(runtime, async ({ idempotencyKey }) => {
      keys.push(idempotencyKey);
      throw new Error('Circle unavailable');
    }));
    await assert.rejects(failing.getAccount(userId, 'WALLET'), /provisioning failed/);
    const restarted = new ManagedIdentityService(options(runtime, async ({ idempotencyKey }) => {
      keys.push(idempotencyKey);
      return { walletId: 'new-sca', address: '0x2222222222222222222222222222222222222222' };
    }));
    assert.equal((await restarted.getAccount(userId, 'WALLET')).managedWallet.walletId, 'new-sca');
    assert.equal(keys[0], keys[1]);
    assert.notEqual(keys[0], 'old-key');
  } finally { runtime.close(); }
});

test('concurrent CCTP recovery shares one call and reuses both persisted operation keys', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const operationId = '11111111-1111-4111-8111-111111111111';
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    runtime.put('circle-cctp-transfers', operationId, {
      operationId, state: 'APPROVING', userId: `usr_${'c'.repeat(64)}`, walletId: 'wallet-id', address,
      sourceChain: 'BASE-SEPOLIA', amount: '1',
      approvalIdempotencyKey: '22222222-2222-4222-8222-222222222222',
      burnIdempotencyKey: '33333333-3333-4333-8333-333333333333', updatedAt: 1,
    });
    const service = new ManagedIdentityService({
      ...options(runtime, async () => ({ walletId: 'wallet-id', address })),
      circleWallets: {
        createWallet: async () => ({ walletId: 'wallet-id', address }),
        bridgeUsdcToArc: async (input: any) => {
          calls += 1;
          assert.equal(input.approvalIdempotencyKey, '22222222-2222-4222-8222-222222222222');
          assert.equal(input.burnIdempotencyKey, '33333333-3333-4333-8333-333333333333');
          await gate;
          return { transactionId: 'burn-id', state: 'SENT', txHash: `0x${'4'.repeat(64)}` };
        },
      },
    } as any);

    const first = service.resumeCctpTransfers();
    const second = service.resumeCctpTransfers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 1);
    release();
    await Promise.all([first, second]);
    assert.equal((runtime.get<any>('circle-cctp-transfers', operationId)).state, 'SUBMITTED');
  } finally { runtime.close(); }
});

test('legacy CCTP burn without a persisted burn key requires reconciliation and is never replayed', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const operationId = '44444444-4444-4444-8444-444444444444';
    let calls = 0;
    runtime.put('circle-cctp-transfers', operationId, {
      operationId, state: 'BURNING', userId: `usr_${'d'.repeat(64)}`, walletId: 'wallet-id', address,
      sourceChain: 'BASE-SEPOLIA', amount: '1', idempotencyKey: 'legacy-approval-key', updatedAt: 1,
    });
    const service = new ManagedIdentityService({
      ...options(runtime, async () => ({ walletId: 'wallet-id', address })),
      circleWallets: {
        createWallet: async () => ({ walletId: 'wallet-id', address }),
        bridgeUsdcToArc: async () => { calls += 1; throw new Error('must not execute'); },
      },
    } as any);

    await service.resumeCctpTransfers();
    const operation = runtime.get<any>('circle-cctp-transfers', operationId);
    assert.equal(operation.state, 'RECOVERY_REQUIRED');
    assert.match(operation.message, /manual reconciliation/);
    assert.equal(calls, 0);
  } finally { runtime.close(); }
});
