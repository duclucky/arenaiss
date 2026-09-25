import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('participant room history exposes the selected fallback route without provider credentials', () => {
  const f = fixture();
  try {
    const roomId = `sha256:${'d'.repeat(64)}`;
    const attemptId = `sha256:${createHash('sha256').update(`arena-pair-attempt-v1|${roomId}|1`).digest('hex')}`;
    f.runtime.put('pair-rooms-v1', roomId, { roomId, creator: 'creator-principal', creatorWallet: CREATOR,
      creatorAgentId: AGENT, creatorVersion: VERSION_A, challenger: 'challenger-principal', challengerWallet: CHALLENGER,
      challengerAgentId: AGENT, challengerVersion: VERSION_B, stake: '1000000', joinDeadline: 1000,
      resolutionDeadline: 2000, state: 'JOINED', createdAt: 100 });
    f.runtime.put('evaluation-tournament-provider-route', attemptId, { fingerprint: 'bound-run', model: 'fallback-model' });
    const room = f.coordinator.listForPrincipal('creator-principal')[0] as any;
    assert.equal(room.providerRoute, 'FALLBACK');
    assert.equal(room.providerModel, 'fallback-model');
    assert.equal(JSON.stringify(room).includes('apiKey'), false);
  } finally { f.runtime.close(); }
});

test('participant room history identifies a completed primary provider pair', () => {
  const f = fixture();
  try {
    const roomId = `sha256:${'e'.repeat(64)}`;
    const attemptId = `sha256:${createHash('sha256').update(`arena-pair-attempt-v1|${roomId}|1`).digest('hex')}`;
    f.runtime.put('pair-rooms-v1', roomId, { roomId, creator: 'creator-principal', creatorWallet: CREATOR,
      creatorAgentId: AGENT, creatorVersion: VERSION_A, challenger: 'challenger-principal', challengerWallet: CHALLENGER,
      challengerAgentId: AGENT, challengerVersion: VERSION_B, stake: '1000000', joinDeadline: 1000,
      resolutionDeadline: 2000, state: 'JOINED', createdAt: 100 });
    for (const side of ['A', 'B']) f.runtime.put('evaluation-tournament-provider-runs', `${attemptId}:${side}`, { model: 'openai-model', route: 'PRIMARY' });
    const room = f.coordinator.listForPrincipal('creator-principal')[0];
    assert.equal(room.providerRoute, 'PRIMARY');
    assert.equal(room.providerModel, 'openai-model');
  } finally { f.runtime.close(); }
});

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

test('public listing exposes only joinable rooms while private listing is participant-scoped', async () => {
  const f = fixture();
  try {
    const created = await f.coordinator.create('creator', 'creator-principal', { agentId: AGENT, version: VERSION_A, stake: '1000000', idempotencyKey: '66666666-6666-4666-8666-666666666666' });
    assert.deepEqual(f.coordinator.listOpen().map((item) => item.roomId), [created.roomId]);
    assert.deepEqual(f.coordinator.listForPrincipal('creator-principal').map((item) => item.roomId), [created.roomId]);
    assert.deepEqual(f.coordinator.listForPrincipal('stranger'), []);
    await assert.rejects(f.coordinator.join('challenger', 'challenger-principal', created.roomId, AGENT, VERSION_B), /temporary Arc read failure/);
    await f.coordinator.join('challenger', 'challenger-principal', created.roomId, AGENT, VERSION_B);
    assert.deepEqual(f.coordinator.listOpen(), []);
    assert.deepEqual(f.coordinator.listForPrincipal('challenger-principal').map((item) => item.roomId), [created.roomId]);
  } finally { f.runtime.close(); }
});

test('room numbers remain globally sequential when earlier rooms leave the open list', async () => {
  const f = fixture();
  try {
    const first = await f.coordinator.create('creator', 'creator-principal', { agentId: AGENT, version: VERSION_A, stake: '1000000', idempotencyKey: '88888888-8888-4888-8888-888888888888' });
    assert.equal(first.roomNumber, 1);
    await f.coordinator.action('creator', 'creator-principal', first.roomId, 'CANCEL');

    const second = await f.coordinator.create('creator', 'creator-principal', { agentId: AGENT, version: VERSION_A, stake: '1000000', idempotencyKey: '99999999-9999-4999-8999-999999999999' });
    assert.equal(second.roomNumber, 2);
    assert.deepEqual(f.coordinator.listOpen().map((room) => room.roomNumber), [2]);
    assert.equal(f.coordinator.get(first.roomId)?.roomNumber, 1);
  } finally { f.runtime.close(); }
});

test('legacy rooms receive stable creation-order numbers before the next room is allocated', async () => {
  const f = fixture();
  try {
    const olderId = `sha256:${'1'.repeat(64)}`;
    const newerId = `sha256:${'2'.repeat(64)}`;
    const base = { creator: 'creator-principal', creatorWallet: CREATOR, creatorAgentId: AGENT, creatorVersion: VERSION_A,
      stake: '1000000', joinDeadline: 1000, resolutionDeadline: 2000, state: 'SETTLED' as const };
    f.runtime.put('pair-rooms-v1', newerId, { ...base, roomId: newerId, createdAt: 20 });
    f.runtime.put('pair-rooms-v1', olderId, { ...base, roomId: olderId, createdAt: 10 });

    const legacy = f.coordinator.list();
    assert.deepEqual(legacy.map((room) => [room.roomId, room.roomNumber]), [[newerId, 2], [olderId, 1]]);
    assert.deepEqual(f.coordinator.list().map((room) => room.roomNumber), [2, 1]);

    const next = await f.coordinator.create('creator', 'creator-principal', { agentId: AGENT, version: VERSION_A, stake: '1000000', idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    assert.equal(next.roomNumber, 3);
  } finally { f.runtime.close(); }
});

test('mutual cancellation is rejected after evaluation starts', async () => {
  const f = fixture();
  try {
    const created = await f.coordinator.create('creator', 'creator-principal', { agentId: AGENT, version: VERSION_A, stake: '1000000', idempotencyKey: '77777777-7777-4777-8777-777777777777' });
    await assert.rejects(f.coordinator.join('challenger', 'challenger-principal', created.roomId, AGENT, VERSION_B), /temporary Arc read failure/);
    await f.coordinator.join('challenger', 'challenger-principal', created.roomId, AGENT, VERSION_B);
    f.runtime.put('pair-rooms-v1', created.roomId, { ...f.coordinator.get(created.roomId)!, evaluationStage: 'RUNNING_AGENTS' });
    await assert.rejects(f.coordinator.action('creator', 'creator-principal', created.roomId, 'REQUEST_CANCEL'), /evaluation has already started/);
  } finally { f.runtime.close(); }
});

test('participant reads a redacted finalized GenLayer judgment for a settled room', () => {
  const f = fixture();
  try {
    const sha = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
    const roomId = sha('settled-room');
    const matchId = sha(`arena-pair-match-v1|${roomId}`);
    const attemptId = sha(`arena-pair-attempt-v1|${roomId}|2`);
    const runId = sha(`arena-comparison-run-v1|${matchId}|${attemptId}`);
    const verdictTx = `0x${'8'.repeat(64)}`;
    const scenarioDigest = sha('scenario');
    const responseDigestA = sha('response-a');
    const responseDigestB = sha('response-b');
    f.runtime.put('pair-rooms-v1', roomId, { roomId, creator: 'creator-principal', creatorWallet: CREATOR, creatorAgentId: AGENT, creatorVersion: VERSION_A,
      challenger: 'challenger-principal', challengerWallet: CHALLENGER, challengerAgentId: AGENT, challengerVersion: VERSION_B,
      stake: '1000000', joinDeadline: 1000, resolutionDeadline: 2000, state: 'SETTLED', verdictTx, verdictAttempt: 2, evaluationStage: 'COMPLETE', createdAt: 100 });
    f.runtime.put('evaluation-comparison-runs', runId, {
      schema: 'arena-comparison-run-v1', comparisonRunId: runId, sourceKind: 'RICH_TOURNAMENT', source: { matchId, attemptId },
      agents: { versionIdA: VERSION_A, versionIdB: VERSION_B }, evidence: { scenarioDigest, responseDigestA, responseDigestB, rubricVersion: 'AgentComparisonV1' },
      judge: { networkChainId: 61997, address: ESCROW, transactionHash: verdictTx, finality: 'FINALIZED', execution: 'SUCCESS' }, result: 'A_WIN', progressionEligible: true,
      scorecard: { status: 'FINAL', result: 'A_WIN', score_a: 75, score_b: 25, safety_class: 'NEITHER_UNSAFE', summary: 'Creator wins safely.',
        dimensions: ['instruction_adherence', 'reasoning_quality', 'action_selection', 'rule_compliance', 'task_completion', 'safety'].map((dimension_id) => ({ dimension_id, winner: 'A', reason: dimension_id === 'instruction_adherence' ? 'Creator followed the instructions.' : 'Creator performed better.' })),
        policy_findings_a: [], policy_findings_b: [{ code: 'MISSING_CONFIRMATION' }] },
    });
    const detail = f.coordinator.verdict('creator-principal', roomId);
    assert.equal(detail.winner, 'CREATOR');
    assert.equal(detail.summary, 'Creator wins safely.');
    assert.deepEqual(detail.dimensions[0], { dimensionId: 'instruction_adherence', winner: 'CREATOR', reason: 'Creator followed the instructions.' });
    assert.deepEqual(detail.policyFindingsChallenger, ['MISSING_CONFIRMATION']);
    assert.throws(() => f.coordinator.verdict('stranger', roomId), /unauthorized/);
  } finally { f.runtime.close(); }
});
