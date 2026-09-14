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
