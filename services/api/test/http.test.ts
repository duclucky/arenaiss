import assert from 'node:assert/strict';
import test from 'node:test';

import { ArenaApiService } from '../src/service.ts';
import { ArenaHttpApi } from '../src/http.ts';
import { viemSignatureVerifier } from '../src/viem-verifier.ts';
import { privateKeyToAccount } from 'viem/accounts';
import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';

const alice = '0x1111111111111111111111111111111111111111';
const bob = '0x2222222222222222222222222222222222222222';
const operator = '0x9999999999999999999999999999999999999999';

test('wallet challenge creates an httpOnly session and agent routes never trust a caller field', async () => {
  const verified: string[] = [];
  const api = new ArenaHttpApi(new ArenaApiService(operator), async ({ address, message, signature }) => {
    verified.push(`${address}|${message}|${signature}`);
    return signature === `signed:${address}`;
  });
  const challenge = await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
  assert.equal(challenge.status, 200);
  const auth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: `signed:${alice}` } });
  assert.equal(auth.status, 204);
  assert.match(auth.headers['set-cookie'], /HttpOnly/);
  const cookie = auth.headers['set-cookie'].split(';')[0];

  const created = await api.handle({
    method: 'POST', path: '/api/agents', headers: { cookie },
    body: { caller: bob, name: 'Alice Agent', agentsMd: 'Return concise evidence.' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.owner, alice);
  assert.equal('agentsMd' in created.body, false);
  assert.equal(verified.length, 1);
});

test('private agent listing requires the owner session and never returns AGENTS.md plaintext', async () => {
  const api = new ArenaHttpApi(new ArenaApiService(operator), async ({ address }) => address === alice);
  await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
  const auth = await api.handle({ method: 'POST', path: '/olders', body: {} });
  assert.equal(auth.status, 404);
  const verified = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
  const cookie = verified.headers['set-cookie'].split(';')[0];
  await api.handle({ method: 'POST', path: '/api/agents', headers: { cookie }, body: { name: 'A', agentsMd: 'secret strategy' } });

  const anonymous = await api.handle({ method: 'GET', path: '/api/agents' });
  assert.equal(anonymous.status, 401);
  const own = await api.handle({ method: 'GET', path: '/api/agents', headers: { cookie } });
  assert.equal(own.status, 200);
  assert.equal(own.body.length, 1);
  assert.equal(JSON.stringify(own.body).includes('secret strategy'), false);
});

test('challenge is single-use and a failed signature cannot create a session', async () => {
  const api = new ArenaHttpApi(new ArenaApiService(operator), async () => false);
  await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
  const failed = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'bad' } });
  assert.equal(failed.status, 401);
  const replay = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'bad' } });
  assert.equal(replay.status, 401);
});

test('authentication capabilities expose managed login only when server configuration is complete', async () => {
  const legacy = new ArenaHttpApi(new ArenaApiService(operator), async () => true);
  assert.deepEqual((await legacy.handle({ method: 'GET', path: '/api/auth/capabilities' })).body, { wallet: true, email: false, managedWallet: false });

  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const managed = new ArenaHttpApi(new ArenaApiService(operator, runtime), async () => true, {
      runtime,
      identityPepper: 'test-only-pepper-with-at-least-32-bytes',
      circleWallets: { createWallet: async () => ({ walletId: 'wallet-id', address: alice }) },
      emailSender: { sendLoginCode: async () => undefined },
    });
    assert.deepEqual((await managed.handle({ method: 'GET', path: '/api/auth/capabilities' })).body, { wallet: true, email: true, managedWallet: true });
  } finally { runtime.close(); }
});

test('logout invalidates the server session and expires the browser cookie', async () => {
  const api = new ArenaHttpApi(new ArenaApiService(operator), async () => true);
  await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
  const auth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
  const cookie = auth.headers['set-cookie'].split(';')[0];
  assert.equal((await api.handle({ method: 'GET', path: '/api/agents', headers: { cookie } })).status, 200);
  const logout = await api.handle({ method: 'POST', path: '/api/auth/logout', headers: { cookie } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers['set-cookie'], /Max-Age=0/);
  assert.equal((await api.handle({ method: 'GET', path: '/api/agents', headers: { cookie } })).status, 401);
});

test('wallet login provisions one persisted Circle wallet and exposes it through the session', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const provisions: any[] = [];
    const managed = {
      runtime,
      identityPepper: 'test-only-pepper-with-at-least-32-bytes',
      circleWallets: { createWallet: async (input: any) => {
        provisions.push(input);
        return { walletId: '11111111-1111-4111-8111-111111111111', address: '0x3333333333333333333333333333333333333333' };
      } },
      emailSender: { sendLoginCode: async () => undefined },
      generateEmailCode: () => '123456',
    };
    const api = new ArenaHttpApi(new ArenaApiService(operator, runtime), async () => true, managed as any);
    await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
    const auth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
    assert.equal(auth.status, 204);
    const cookie = auth.headers['set-cookie'].split(';')[0];
    const account = await api.handle({ method: 'GET', path: '/api/account', headers: { cookie } });
    assert.equal(account.status, 200);
    assert.equal(account.body.identity.kind, 'WALLET');
    assert.equal(account.body.managedWallet.address, '0x3333333333333333333333333333333333333333');
    assert.equal(account.body.managedWallet.blockchain, 'ARC-TESTNET');
    assert.equal(provisions.length, 1);

    await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
    await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
    assert.equal(provisions.length, 1);

    const restarted = new ArenaHttpApi(new ArenaApiService(operator, runtime), async () => true, managed as any);
    await restarted.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
    assert.equal((await restarted.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } })).status, 204);
    assert.equal(provisions.length, 1);
  } finally { runtime.close(); }
});

test('managed wallet balance, Arc withdrawal and CCTP routes require the authenticated owner and validate inputs', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const calls: any[] = [];
    let releaseBridge!: () => void;
    const bridgeGate = new Promise<void>((resolve) => { releaseBridge = resolve; });
    const managed = {
      runtime,
      identityPepper: 'test-only-pepper-with-at-least-32-bytes',
      tournamentEscrowAddress: '0x6666666666666666666666666666666666666666',
      circleWallets: {
        createWallet: async () => ({ walletId: '11111111-1111-4111-8111-111111111111', address: '0x3333333333333333333333333333333333333333' }),
        listUsdcBalances: async () => [
          { chain: 'ARC-TESTNET', label: 'Arc Testnet', amount: '2', isArc: true, available: true },
          { chain: 'ARB-SEPOLIA', label: 'Arbitrum Sepolia', amount: '3', isArc: false, available: true },
        ],
        transferUsdc: async (input: any) => { calls.push(['transfer', input]); return { transactionId: 'tx-1', state: 'SENT' }; },
        withdrawTournamentCredit: async (input: any) => { calls.push(['claim', input]); return { transactionId: 'claim-1', state: 'COMPLETE' }; },
        bridgeUsdcToArc: async (input: any) => {
          calls.push(['bridge', input]);
          input.onProgress?.('APPROVING');
          await bridgeGate;
          input.onProgress?.('BURNING');
          return { transactionId: 'tx-2', state: 'SENT', txHash: `0x${'2'.repeat(64)}`, explorerUrl: `https://sepolia.arbiscan.io/tx/0x${'2'.repeat(64)}` };
        },
      },
      emailSender: { sendLoginCode: async () => undefined },
    };
    const api = new ArenaHttpApi(new ArenaApiService(operator, runtime), async () => true, managed as any);
    assert.equal((await api.handle({ method: 'GET', path: '/api/account/usdc-balances' })).status, 401);
    assert.equal((await api.handle({ method: 'POST', path: '/api/account/cctp-transfers', body: { sourceChain: 'ARB-SEPOLIA', amount: '2' } })).status, 401);
    await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
    const auth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
    const cookie = auth.headers['set-cookie'].split(';')[0];
    assert.equal((await api.handle({ method: 'GET', path: '/api/account/usdc-balances', headers: { cookie } })).body[0].chain, 'ARC-TESTNET');
    assert.equal((await api.handle({ method: 'POST', path: '/api/account/usdc-transfers', headers: { cookie }, body: { destinationAddress: 'bad', amount: '1' } })).status, 400);
    assert.equal((await api.handle({ method: 'POST', path: '/api/account/usdc-transfers', headers: { cookie }, body: { destinationAddress: '0x5555555555555555555555555555555555555555', amount: '1.0000001' } })).status, 400);
    assert.equal((await api.handle({ method: 'POST', path: '/api/account/usdc-transfers', headers: { cookie }, body: { destinationAddress: '0x5555555555555555555555555555555555555555', amount: '1.25' } })).status, 202);
    const tournamentId = `sha256:${'a'.repeat(64)}`;
    assert.equal((await api.handle({ method: 'POST', path: `/api/account/tournament-credits/${tournamentId}/withdraw`, headers: { cookie }, body: { idempotencyKey: '11111111-1111-4111-8111-111111111111' } })).status, 202);
    assert.equal((await api.handle({ method: 'POST', path: '/api/account/cctp-transfers', headers: { cookie }, body: { sourceChain: 'ETH-SEPOLIA', amount: '2' } })).status, 400);
    const bridgePromise = api.handle({ method: 'POST', path: '/api/account/cctp-transfers', headers: { cookie }, body: { sourceChain: 'ARB-SEPOLIA', amount: '2' } });
    const bridge = await Promise.race([
      bridgePromise,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 20)),
    ]);
    assert.notEqual(bridge, 'timeout');
    assert.equal(typeof bridge, 'object');
    assert.equal(bridge.status, 202);
    assert.match(bridge.body.operationId, /^[0-9a-f-]{36}$/);
    assert.equal(bridge.body.state, 'PENDING');
    assert.equal((await api.handle({ method: 'GET', path: `/api/account/cctp-transfers/${bridge.body.operationId}` })).status, 401);
    releaseBridge();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const status = await api.handle({ method: 'GET', path: `/api/account/cctp-transfers/${bridge.body.operationId}`, headers: { cookie } });
      if (status.body.state === 'SUBMITTED') {
        assert.equal(status.body.transactionId, 'tx-2');
        assert.match(status.body.explorerUrl, /^https:\/\/sepolia\.arbiscan\.io\/tx\//);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (attempt === 9) assert.fail('CCTP operation did not reach SUBMITTED');
    }
    await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: bob } });
    const bobAuth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: bob, signature: 'ok' } });
    const bobCookie = bobAuth.headers['set-cookie'].split(';')[0];
    assert.equal((await api.handle({ method: 'GET', path: `/api/account/cctp-transfers/${bridge.body.operationId}`, headers: { cookie: bobCookie } })).status, 400);
    assert.deepEqual(calls.map(([kind]) => kind), ['transfer', 'claim', 'bridge']);
  } finally { runtime.close(); }
});

test('CCTP operation resumes after API restart with the persisted approval and burn keys', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const bridgeCalls: any[] = [];
    const managed = {
      runtime,
      identityPepper: 'test-only-pepper-with-at-least-32-bytes',
      circleWallets: {
        createWallet: async () => ({ walletId: '11111111-1111-4111-8111-111111111111', address: '0x3333333333333333333333333333333333333333' }),
        bridgeUsdcToArc: async (input: any) => {
          bridgeCalls.push(input);
          return { transactionId: 'burn-id', state: 'SENT', txHash: `0x${'6'.repeat(64)}` };
        },
      },
      emailSender: { sendLoginCode: async () => undefined },
    };
    const initial = new ArenaHttpApi(new ArenaApiService(operator, runtime), async () => true, managed as any);
    await initial.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
    const login = await initial.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
    const initialCookie = login.headers['set-cookie'].split(';')[0];
    const account = await initial.handle({ method: 'GET', path: '/api/account', headers: { cookie: initialCookie } });
    const operationId = '33333333-3333-4333-8333-333333333333';
    runtime.put('circle-cctp-transfers', operationId, {
      operationId,
      state: 'BURNING',
      userId: account.body.userId,
      walletId: account.body.managedWallet.walletId,
      address: account.body.managedWallet.address,
      sourceChain: 'BASE-SEPOLIA',
      amount: '1',
      approvalIdempotencyKey: '44444444-4444-4444-8444-444444444444',
      burnIdempotencyKey: '55555555-5555-4555-8555-555555555555',
      updatedAt: 1,
    });

    const restarted = new ArenaHttpApi(new ArenaApiService(operator, runtime), async () => true, managed as any);
    await restarted.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
    const restartedLogin = await restarted.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
    const cookie = restartedLogin.headers['set-cookie'].split(';')[0];
    let status = await restarted.handle({ method: 'GET', path: `/api/account/cctp-transfers/${operationId}`, headers: { cookie } });
    for (let attempt = 0; attempt < 20 && status.body.state !== 'SUBMITTED'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      status = await restarted.handle({ method: 'GET', path: `/api/account/cctp-transfers/${operationId}`, headers: { cookie } });
    }

    assert.equal(status.body.state, 'SUBMITTED');
    assert.equal(bridgeCalls.length, 1);
    assert.equal(bridgeCalls[0].approvalIdempotencyKey, '44444444-4444-4444-8444-444444444444');
    assert.equal(bridgeCalls[0].burnIdempotencyKey, '55555555-5555-4555-8555-555555555555');
  } finally {
    runtime.close();
  }
});

test('email OTP login is bounded, stores no plaintext email, and provisions the same managed wallet once', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const deliveries: Array<{ email: string; code: string }> = [];
    let provisions = 0;
    const registryCalls: string[] = [];
    let now = 1_000_000;
    const managed = {
      runtime,
      identityPepper: 'test-only-pepper-with-at-least-32-bytes',
      agentRegistryAddress: '0x3333333333333333333333333333333333333333',
      circleWallets: {
        createWallet: async () => {
          provisions += 1;
          return { walletId: '22222222-2222-4222-8222-222222222222', address: '0x4444444444444444444444444444444444444444' };
        },
        registerAgent: async ({ agentId }: any) => { registryCalls.push(`register:${agentId}`); return { transactionId: 'register-tx', state: 'SENT', txHash: `0x${'a'.repeat(64)}`, explorerUrl: `https://testnet.arcscan.app/tx/0x${'a'.repeat(64)}` }; },
        deactivateAgent: async ({ agentId }: any) => { registryCalls.push(`deactivate:${agentId}`); return { transactionId: 'deactivate-tx', state: 'SENT', txHash: `0x${'b'.repeat(64)}`, explorerUrl: `https://testnet.arcscan.app/tx/0x${'b'.repeat(64)}` }; },
      },
      emailSender: { sendLoginCode: async (email: string, code: string) => { deliveries.push({ email, code }); } },
      generateEmailCode: () => '654321',
      now: () => now,
    };
    const api = new ArenaHttpApi(new ArenaApiService(operator, runtime), async () => false, managed as any);
    const challenge = await api.handle({ method: 'POST', path: '/api/auth/email/challenge', body: { email: ' User@Example.COM ' } });
    assert.equal(challenge.status, 202);
    assert.deepEqual(deliveries, [{ email: 'user@example.com', code: '654321' }]);
    assert.equal(JSON.stringify(runtime.list('auth-identities')).includes('user@example.com'), false);
    assert.equal((await api.handle({ method: 'POST', path: '/api/auth/email/verify', body: { email: 'user@example.com', code: '000000' } })).status, 401);
    const verified = await api.handle({ method: 'POST', path: '/api/auth/email/verify', body: { email: 'user@example.com', code: '654321' } });
    assert.equal(verified.status, 204);
    const cookie = verified.headers['set-cookie'].split(';')[0];
    const account = await api.handle({ method: 'GET', path: '/api/account', headers: { cookie } });
    assert.equal(account.body.identity.kind, 'EMAIL');
    assert.equal('email' in account.body.identity, false);
    assert.equal(account.body.managedWallet.address, '0x4444444444444444444444444444444444444444');
    assert.equal(JSON.stringify(runtime.list('auth-identities')).includes('user@example.com'), false);
    assert.equal(provisions, 1);

    const agent = await api.handle({ method: 'POST', path: '/api/agents', headers: { cookie }, body: { name: 'Email Agent', agentsMd: 'private' } });
    assert.equal(agent.status, 201);
    assert.match(agent.body.owner, /^usr_[0-9a-f]{64}$/);
    assert.equal(agent.body.registration.transactionId, 'register-tx');
    const detail = await api.handle({ method: 'GET', path: `/api/agents/${agent.body.agentId}`, headers: { cookie } });
    assert.equal(detail.body.agentsMd, 'private');
    assert.equal((await api.handle({ method: 'DELETE', path: `/api/agents/${agent.body.agentId}`, headers: { cookie }, body: { name: 'wrong' } })).status, 400);
    const deleted = await api.handle({ method: 'DELETE', path: `/api/agents/${agent.body.agentId}`, headers: { cookie }, body: { name: 'Email Agent' } });
    assert.equal(deleted.body.deactivation.transactionId, 'deactivate-tx');
    assert.deepEqual(registryCalls, [`register:${agent.body.agentId}`, `deactivate:${agent.body.agentId}`]);
    assert.equal((await api.handle({ method: 'POST', path: '/api/auth/email/verify', body: { email: 'user@example.com', code: '654321' } })).status, 401);

    await api.handle({ method: 'POST', path: '/api/auth/email/challenge', body: { email: 'second@example.com' } });
    now += 601_000;
    const expired = await api.handle({ method: 'POST', path: '/api/auth/email/verify', body: { email: 'second@example.com', code: '654321' } });
    assert.equal(expired.status, 401);
  } finally { runtime.close(); }
});

test('production verifier accepts only the address that signed the exact challenge', async () => {
  const account = privateKeyToAccount(`0x${'01'.repeat(32)}`);
  const message = 'Arena ISS exact challenge';
  const signature = await account.signMessage({ message });
  assert.equal(await viemSignatureVerifier({ address: account.address, message, signature }), true);
  assert.equal(await viemSignatureVerifier({ address: bob, message, signature }), false);
  assert.equal(await viemSignatureVerifier({ address: account.address, message: `${message}!`, signature }), false);
});

test('deleting a legacy Agent missing from Arc cleans the orphan without submitting a reverting transaction', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    let deactivateCalls = 0;
    const managed = {
      runtime,
      identityPepper: 'test-only-pepper-with-at-least-32-bytes',
      agentRegistryAddress: '0x3333333333333333333333333333333333333333',
      circleWallets: {
        createWallet: async () => ({ walletId: '11111111-1111-4111-8111-111111111111', address: '0x4444444444444444444444444444444444444444' }),
        registerAgent: async () => ({ transactionId: 'legacy-registration', state: 'SENT', txHash: `0x${'a'.repeat(64)}` }),
        deactivateAgent: async () => { deactivateCalls += 1; throw new Error('must not submit'); },
      },
      emailSender: { sendLoginCode: async () => undefined },
    };
    const registry = { async readAgent() { return { owner: '0x0000000000000000000000000000000000000000', active: false }; } };
    const api = new ArenaHttpApi(new ArenaApiService(operator, runtime), async () => true, managed as any, undefined, undefined, undefined, undefined, registry);
    await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
    const auth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
    const cookie = auth.headers['set-cookie'].split(';')[0];
    const created = await api.handle({ method: 'POST', path: '/api/agents', headers: { cookie }, body: { name: 'Orphan Agent', agentsMd: 'private' } });
    const deleted = await api.handle({ method: 'DELETE', path: `/api/agents/${created.body.agentId}`, headers: { cookie }, body: { name: 'Orphan Agent' } });
    assert.equal(deleted.status, 202);
    assert.match(deleted.body.deactivation.transactionId, /^arc-readback:/);
    assert.equal(deactivateCalls, 0);
  } finally { runtime.close(); }
});

test('authenticated owner can prepare an exact Arc registration payload', async () => {
  const service = new ArenaApiService(operator);
  const tournamentId = `sha256:${'a'.repeat(64)}`;
  service.publishTournament(operator, { id: tournamentId, name: 'Registration Arena', status: 'UPCOMING', entrantIds: [], stakeAmount: '100000', prizePool: '0' });
  const api = new ArenaHttpApi(service, async () => true);
  await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
  const auth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
  const cookie = auth.headers['set-cookie'].split(';')[0];
  const created = await api.handle({ method: 'POST', path: '/api/agents', headers: { cookie }, body: { name: 'A', agentsMd: 'v1' } });
  const prepared = await api.handle({ method: 'POST', path: `/api/tournaments/${tournamentId}/registrations`, headers: { cookie }, body: { agentId: created.body.agentId } });
  assert.equal(prepared.status, 200);
  assert.match(prepared.body.entrantId, /^0x[0-9a-f]{64}$/);
  assert.equal(prepared.body.stakeAmount, '100000');

  const owned = await api.handle({ method: 'GET', path: '/api/registrations', headers: { cookie } });
  assert.equal(owned.status, 200);
  assert.deepEqual(owned.body, [{ tournamentId: prepared.body.tournamentId, entrantId: prepared.body.entrantId }]);
  assert.equal((await api.handle({ method: 'GET', path: '/api/registrations' })).status, 401);
});

test('public read routes expose normalized tournament, match and verdict data anonymously', async () => {
  const service = new ArenaApiService(operator);
  const tournamentId = `sha256:${'c'.repeat(64)}`;
  const matchId = `sha256:${'d'.repeat(64)}`;
  service.publishTournament(operator, { id: tournamentId, name: 'Arena One', status: 'ACTIVE', entrantIds: [], stakeAmount: '100000', prizePool: '800000' });
  service.publishMatch(operator, { id: matchId, tournamentId, state: 'FINALIZED', agentA: 'Agent A', agentB: 'Agent B', winner: 'Agent A', round: 1 });
  service.publishVerdict(operator, { id: `sha256:${'e'.repeat(64)}`, matchId, winner: 'A', reasons: ['r1', 'r2', 'r3', 'r4', 'r5'], summary: 'Agent A wins.', transactionHash: `0x${'ab'.repeat(32)}` });
  const api = new ArenaHttpApi(service, async () => false);

  assert.equal((await api.handle({ method: 'GET', path: '/api/tournaments' })).body[0].name, 'Arena One');
  assert.equal((await api.handle({ method: 'GET', path: `/api/tournaments/${tournamentId}` })).body.id, tournamentId);
  assert.equal((await api.handle({ method: 'GET', path: `/api/tournaments/${tournamentId}/matches` })).body[0].id, matchId);
  assert.equal((await api.handle({ method: 'GET', path: `/api/matches/${matchId}` })).body.state, 'FINALIZED');
  const verdict = await api.handle({ method: 'GET', path: `/api/matches/${matchId}/verdict` });
  assert.equal(verdict.status, 200);
  assert.equal(verdict.body.winner, 'A');
  assert.equal(JSON.stringify(verdict.body).includes('agentsMd'), false);
});

test('evaluation Run Detail routes separate anonymous redacted state from owner detail', async () => {
  const runtime = new (await import('../../../packages/persistence/src/sqlite-runtime.ts')).SqliteRuntimeStore(':memory:');
  try {
    const service = new ArenaApiService(operator, runtime);
    const api = new ArenaHttpApi(service, async () => true);
    await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
    const auth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
    const cookie = auth.headers['set-cookie'].split(';')[0];
    const agent = await api.handle({ method: 'POST', path: '/api/agents', headers: { cookie }, body: { name: 'Solo', agentsMd: 'private profile' } });
    const runId = `sha256:${'f'.repeat(64)}`;
    runtime.put('evaluation-runs', runId, {
      schema: 'arena-evaluation-run-v1', runId, rubricVersion: 'AgentEvaluationV5', scenarioJson: '{}', scenarioDigest: `sha256:${'1'.repeat(64)}`,
      input: { mode: 'RESPONSE', agent: { version_id: agent.body.agentsVersion, content: 'private profile' }, scenario: { scenario_id: 'solo_01', version: '1.0.0', context: 'hidden context' } },
      provider: { state: 'PENDING', operationKey: 'private-key' }, judge: { state: 'NOT_SUBMITTED' },
    });
    const publicResult = await api.handle({ method: 'GET', path: `/api/evaluation-runs/${runId}` });
    assert.equal(publicResult.status, 200);
    assert.equal(JSON.stringify(publicResult.body).includes('private profile'), false);
    assert.equal((await api.handle({ method: 'GET', path: `/api/evaluation-runs/${runId}/private` })).status, 401);
    const privateResult = await api.handle({ method: 'GET', path: `/api/evaluation-runs/${runId}/private`, headers: { cookie } });
    assert.equal(privateResult.status, 200);
    assert.equal(privateResult.body.runId, runId);
    assert.equal((await api.handle({ method: 'GET', path: '/api/evaluation-runs', headers: { cookie } })).body.length, 1);
  } finally {
    runtime.close();
  }
});

test('authenticated API creates immutable Test Pack and SOLO campaign, public status is redacted', async () => {
  const runtime = new (await import('../../../packages/persistence/src/sqlite-runtime.ts')).SqliteRuntimeStore(':memory:');
  try {
    const service = new ArenaApiService(operator, runtime);
    const api = new ArenaHttpApi(service, async () => true);
    await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
    const auth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
    const cookie = auth.headers['set-cookie'].split(';')[0];
    const agent = await api.handle({ method: 'POST', path: '/api/agents', headers: { cookie }, body: { name: 'Pack Agent', agentsMd: 'private pack profile' } });
    const pack = await api.handle({ method: 'POST', path: '/api/evaluation-packs', headers: { cookie }, body: { packId: `sha256:${'1'.repeat(64)}`, version: '1.0.0', name: 'Pack', scenarios: [{ schema: 'arena-test-scenario-v1', scenarioId: 'case_01', version: '1.0.0', level: 'RESPONSE', objective: 'Answer.', context: 'private context', constraints: [], availableActions: [], forbiddenActionIds: [], confirmationRequiredActionIds: [], maxProposedActions: 0 }] } });
    assert.equal(pack.status, 201);
    const campaign = await api.handle({ method: 'POST', path: '/api/evaluation-campaigns', headers: { cookie }, body: { campaignId: `sha256:${'2'.repeat(64)}`, agentId: agent.body.agentId, agentsVersion: agent.body.agentsVersion, packId: pack.body.packId, packVersion: '1.0.0', runtimePolicy: { model: 'fixture', maxOutputTokens: 500, temperature: 0, maxProviderAttempts: 2 } } });
    assert.equal(campaign.status, 201);
    const publicStatus = await api.handle({ method: 'GET', path: `/api/evaluation-campaigns/${campaign.body.campaignId}` });
    assert.equal(publicStatus.status, 200);
    assert.equal(JSON.stringify(publicStatus.body).includes('private pack profile'), false);
    assert.equal(JSON.stringify(publicStatus.body).includes('private context'), false);
    assert.equal((await api.handle({ method: 'GET', path: '/api/evaluation-campaigns', headers: { cookie } })).body.length, 1);
  } finally {
    runtime.close();
  }
});

test('version comparison routes require the owner session and preserve cohort arrays and regression policy', async () => {
  const service = new ArenaApiService(operator);
  let captured: any;
  const record = { schema: 'arena-version-comparison-v1', comparisonId: `sha256:${'9'.repeat(64)}`, inputDigest: `sha256:${'8'.repeat(64)}`, status: 'PASS', agentId: `sha256:${'7'.repeat(64)}`, baselineVersionId: `sha256:${'6'.repeat(64)}`, candidateVersionId: `sha256:${'5'.repeat(64)}`, coverageBps: 10_000, findings: [], sourceCampaignIds: { baseline: [], candidate: [] }, sourceRunIds: { baseline: [], candidate: [] } };
  (service as any).createVersionComparison = (owner: string, input: any) => { captured = { owner, input }; return record; };
  (service as any).listOwnedVersionComparisons = () => [record];
  (service as any).getOwnedVersionComparison = () => record;
  const api = new ArenaHttpApi(service, async ({ address, signature }) => signature === `signed:${address}`);
  const body = {
    comparisonId: record.comparisonId, agentId: record.agentId, baselineVersionId: record.baselineVersionId, candidateVersionId: record.candidateVersionId,
    baselineCampaignIds: [`sha256:${'1'.repeat(64)}`], candidateCampaignIds: [`sha256:${'2'.repeat(64)}`],
    policy: { schema: 'arena-regression-policy-v1', requiredRunsPerScenario: 1, minimumScenarioCoverageBps: 10_000, maximumOverallDrop: 5, maximumDimensionDrop: 10, maximumOverallSpread: 10, maximumDimensionSpread: 10, minimumDimensionScores: {}, criticalFindingCodes: [] },
  };
  assert.equal((await api.handle({ method: 'POST', path: '/api/evaluation-comparisons', body })).status, 401);
  await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
  const auth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: `signed:${alice}` } });
  const headers = { cookie: auth.headers['set-cookie'].split(';')[0] };
  const created = await api.handle({ method: 'POST', path: '/api/evaluation-comparisons', headers, body });
  assert.equal(created.status, 201);
  assert.equal(captured.owner, alice);
  assert.deepEqual(captured.input.baselineCampaignIds, body.baselineCampaignIds);
  assert.deepEqual(captured.input.policy, body.policy);
  assert.equal((await api.handle({ method: 'GET', path: '/api/evaluation-comparisons', headers })).body.length, 1);
  assert.equal((await api.handle({ method: 'GET', path: `/api/evaluation-comparisons/${record.comparisonId}`, headers })).body.status, 'PASS');
});
