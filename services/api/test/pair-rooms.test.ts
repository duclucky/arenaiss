import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import type { ArenaApiService } from '../src/service.ts';
import { PairRoomCoordinator, type ChainRoom, type PairChainPort, type PairWalletPort } from '../src/pair-rooms.ts';

const CREATOR = '0x1111111111111111111111111111111111111111';
const CHALLENGER = '0x2222222222222222222222222222222222222222';
const ESCROW = '0x3333333333333333333333333333333333333333';
const AGENT = `sha256:${'a'.repeat(64)}`;
const VERSION_A = `sha256:${'b'.repeat(64)}`;
const VERSION_B = `sha256:${'c'.repeat(64)}`;
const CREATE_TX = `0x${'1'.repeat(64)}`;
const JOIN_TX = `0x${'2'.repeat(64)}`;
const CANCEL_TX = `0x${'3'.repeat(64)}`;
const REFUND_TX = `0x${'4'.repeat(64)}`;
const emptyRoom = (): ChainRoom => ({ creator: '0x0000000000000000000000000000000000000000', challenger: '0x0000000000000000000000000000000000000000', creatorAgentVersion: `0x${'0'.repeat(64)}`, challengerAgentVersion: `0x${'0'.repeat(64)}`, stake: 0n, joinDeadline: 0, resolutionDeadline: 0, state: 0, winner: '0x0000000000000000000000000000000000000000' });

function fixture() {
  const runtime = new SqliteRuntimeStore(':memory:');
  const rooms = new Map<string, ChainRoom>();
  const credits = new Map<string, bigint>();
  let creatorBalance = 1_000_000n;
  let challengerBalance = 1_000_000n;
  let failNextRead = false;
  let rejectWithdrawal = false;
  let rejectJoin = false;
  let creates = 0;
  let joins = 0;
  const chain: PairChainPort = {
    escrowAddress: ESCROW,
    async assertReady() {},
    async balanceOf(wallet) { return wallet === CREATOR ? creatorBalance : challengerBalance; },
    async getRoom(roomId) { if (failNextRead) { failNextRead = false; throw new Error('temporary Arc read failure'); } return rooms.get(roomId) ?? emptyRoom(); },
    async creditOf(roomId, wallet) { return credits.get(`${roomId}:${wallet}`) ?? 0n; },
  };
  const wallet: PairWalletPort = {
    async account(userId) { return { address: userId === 'creator' ? CREATOR : CHALLENGER }; },
    async create(userId, input) {
      assert.equal(userId, 'creator'); creates++;
      rooms.set(input.roomId, { ...emptyRoom(), creator: CREATOR, creatorAgentVersion: `0x${VERSION_A.slice(7)}`, stake: BigInt(input.stake), joinDeadline: input.joinDeadline, resolutionDeadline: input.resolutionDeadline, state: 1 });
      return { txHash: CREATE_TX };
    },
    async join(userId, input) {
      assert.equal(userId, 'challenger'); joins++;
      if (rejectJoin) throw new Error('temporary Circle join failure');
      rooms.set(input.roomId, { ...rooms.get(input.roomId)!, challenger: CHALLENGER, challengerAgentVersion: `0x${VERSION_B.slice(7)}`, state: 2 });
      failNextRead = true;
      return { txHash: JOIN_TX };
    },
    async action(userId, input) {
      assert.equal(userId, 'creator');
      if (input.kind === 'CANCEL') {
        rooms.set(input.roomId, { ...rooms.get(input.roomId)!, state: 4 });
        credits.set(`${input.roomId}:${CREATOR}`, 1_000_000n);
        return { txHash: CANCEL_TX };
      }
      if (input.kind === 'WITHDRAW') {
        if (rejectWithdrawal) throw new Error('temporary Circle withdrawal failure');
        credits.set(`${input.roomId}:${CREATOR}`, 0n);
        return { txHash: REFUND_TX };
      }
      throw new Error('unused');
    },
  };
  const agents = { getAgentVersion() { return {}; } } as unknown as ArenaApiService;
  const coordinator = new PairRoomCoordinator(runtime, agents, wallet, chain, () => 100);
  return { runtime, coordinator, get creates() { return creates; }, get joins() { return joins; }, setCreatorBalance(value: bigint) { creatorBalance = value; }, setChallengerBalance(value: bigint) { challengerBalance = value; }, rejectWithdrawal() { rejectWithdrawal = true; }, rejectJoin() { rejectJoin = true; } };
}

test('insufficient Arc USDC leaves no visible room and never submits a wallet transaction', async () => {
  const f = fixture();
  try {
    f.setCreatorBalance(0n);
    await assert.rejects(f.coordinator.create('creator', 'creator-principal', { agentId: AGENT, version: VERSION_A, stake: '1000000', idempotencyKey: '11111111-1111-4111-8111-111111111111' }), /insufficient Arc USDC/);
    assert.equal(f.creates, 0);
    assert.deepEqual(f.coordinator.list(), []);
  } finally { f.runtime.close(); }
});

test('creator cancellation leaves a pull refund when automatic delivery fails', async () => {
  const f = fixture();
  try {
    const created = await f.coordinator.create('creator', 'creator-principal', { agentId: AGENT, version: VERSION_A, stake: '1000000', idempotencyKey: '44444444-4444-4444-8444-444444444444' });
    f.rejectWithdrawal();
    const refunded = await f.coordinator.action('creator', 'creator-principal', created.roomId, 'CANCEL');
    assert.equal(refunded.state, 'REFUNDABLE');
    assert.equal(refunded.cancelTx, CANCEL_TX);
    assert.equal(refunded.refundTx, undefined);
    assert.equal(await f.coordinator.credit('creator', 'creator-principal', created.roomId), '1000000');
  } finally { f.runtime.close(); }
});

test('creator cancellation opens a refund and records its completed withdrawal against the same room', async () => {
  const f = fixture();
  try {
    const created = await f.coordinator.create('creator', 'creator-principal', { agentId: AGENT, version: VERSION_A, stake: '1000000', idempotencyKey: '33333333-3333-4333-8333-333333333333' });
    const refunded = await f.coordinator.action('creator', 'creator-principal', created.roomId, 'CANCEL');
    assert.equal(refunded.state, 'REFUNDABLE');
    assert.equal(refunded.createTx, CREATE_TX);
    assert.equal(refunded.cancelTx, CANCEL_TX);
    assert.equal(refunded.refundTx, REFUND_TX);
    assert.equal(await f.coordinator.credit('creator', 'creator-principal', created.roomId), '0');
  } finally { f.runtime.close(); }
});

test('creator may cancel while a failed challenger join has not reached Arc', async () => {
  const f = fixture();
  try {
    const created = await f.coordinator.create('creator', 'creator-principal', { agentId: AGENT, version: VERSION_A, stake: '1000000', idempotencyKey: '55555555-5555-4555-8555-555555555555' });
    f.rejectJoin();
    await assert.rejects(f.coordinator.join('challenger', 'challenger-principal', created.roomId, AGENT, VERSION_B), /temporary Circle join failure/);
    assert.equal(f.coordinator.get(created.roomId)?.state, 'JOINING');
    const refunded = await f.coordinator.action('creator', 'creator-principal', created.roomId, 'CANCEL');
    assert.equal(refunded.state, 'REFUNDABLE');
    assert.equal(refunded.cancelTx, CANCEL_TX);
    assert.equal(refunded.refundTx, REFUND_TX);
  } finally { f.runtime.close(); }
});

test('backend durably links both Arc deposit transactions to one room across a failed join readback', async () => {
  const f = fixture();
  try {
    const created = await f.coordinator.create('creator', 'creator-principal', { agentId: AGENT, version: VERSION_A, stake: '1000000', idempotencyKey: '11111111-1111-4111-8111-111111111111' });
    assert.equal(created.createTx, CREATE_TX);
    await assert.rejects(f.coordinator.join('challenger', 'challenger-principal', created.roomId, AGENT, VERSION_B), /temporary Arc read failure/);
    const pending = f.runtime.get<{ joinTx?: string }>('pair-rooms-v1', created.roomId);
    assert.equal(pending?.joinTx, JOIN_TX);
    const joined = await f.coordinator.join('challenger', 'challenger-principal', created.roomId, AGENT, VERSION_B);
    assert.equal(joined.createTx, CREATE_TX);
    assert.equal(joined.joinTx, JOIN_TX);
    assert.equal(joined.creatorWallet, CREATOR);
    assert.equal(joined.challengerWallet, CHALLENGER);
    assert.equal(f.creates, 1);
    assert.equal(f.joins, 1);
  } finally { f.runtime.close(); }
});
