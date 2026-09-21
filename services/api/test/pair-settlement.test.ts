import assert from 'node:assert/strict';
import test from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';

import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import type { ArcPairChainPort } from '../src/pair-arc.ts';
import { LivePairAutomaticRefund, LivePairSettlementArc } from '../src/pair-settlement-live.ts';
import { PAIR_COMPARISON_SCENARIOS, pairScenarioForAttempt } from '../src/pair-settlement-live.ts';
import { PairSettlementWorker, type PairOutcomePort, type PairSettlementArcPort } from '../src/pair-settlement.ts';
import type { PairRoom, ChainRoom } from '../src/pair-rooms.ts';

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const address = (character: string) => `0x${character.repeat(40)}`;
const room: PairRoom = {
  roomId: digest('a'), creator: 'creator', creatorWallet: address('1'), creatorAgentId: digest('b'), creatorVersion: digest('c'),
  challenger: 'challenger', challengerWallet: address('2'), challengerAgentId: digest('d'), challengerVersion: digest('e'),
  stake: '1000000', joinDeadline: 100, resolutionDeadline: 1000, state: 'JOINED',
  createTx: `0x${'1'.repeat(64)}`, joinTx: `0x${'2'.repeat(64)}`, createdAt: 1,
};
const chainRoom: ChainRoom = {
  creator: room.creatorWallet, challenger: room.challengerWallet!, creatorAgentVersion: `0x${room.creatorVersion.slice(7)}`,
  challengerAgentVersion: `0x${room.challengerVersion!.slice(7)}`, stake: 1_000_000n,
  joinDeadline: room.joinDeadline, resolutionDeadline: room.resolutionDeadline, state: 2, winner: address('0'),
};

function fixture() {
  const runtime = new SqliteRuntimeStore(':memory:');
  runtime.put('pair-rooms-v1', room.roomId, room);
  let arcRoom = { ...chainRoom };
  let outcome: Awaited<ReturnType<PairOutcomePort['resolve']>> = { state: 'WAITING', failureCode: 'VERDICT_PENDING' };
  let now = 200;
  let settlements = 0;
  let expirations = 0;
  let refunds = 0;
  let resolves = 0;
  let arcFailure: Error | undefined;
  const arc: PairSettlementArcPort = {
    async getRoom() { if (arcFailure) throw arcFailure; return structuredClone(arcRoom); },
    async settle(_roomId, winner, verdictDigest) {
      settlements++;
      arcRoom = { ...arcRoom, state: 3, winner, verdictDigest: `0x${verdictDigest.slice(7)}` } as ChainRoom;
      return `0x${'3'.repeat(64)}`;
    },
    async expire() { expirations++; arcRoom = { ...arcRoom, state: 4 }; return `0x${'4'.repeat(64)}`; },
    async refund() { refunds++; arcRoom = { ...arcRoom, state: 4 }; return `0x${'6'.repeat(64)}`; },
  };
  const judge: PairOutcomePort = { async resolve() { resolves++; return outcome; } };
  const worker = new PairSettlementWorker(runtime, arc, judge, () => now);
  return { runtime, worker, get settlements() { return settlements; }, get expirations() { return expirations; }, get refunds() { return refunds; }, get resolves() { return resolves; },
    setOutcome(value: typeof outcome) { outcome = value; }, setArc(value: ChainRoom) { arcRoom = value; }, setArcFailure(value?: Error) { arcFailure = value; }, setNow(value: number) { now = value; } };
}

test('each no-consensus retry uses a different fixed scenario', () => {
  assert.equal(PAIR_COMPARISON_SCENARIOS.length, 4);
  assert.equal(new Set(PAIR_COMPARISON_SCENARIOS).size, 4);
  assert.deepEqual([1, 2, 3, 4].map(pairScenarioForAttempt), [...PAIR_COMPARISON_SCENARIOS]);
  assert.throws(() => pairScenarioForAttempt(5), /attempt is invalid/);
});

test('settles only a canonical finalized comparison, persists its intent, and reconciles retry', async () => {
  const f = fixture();
  try {
    await f.worker.tick();
    assert.equal(f.settlements, 0);
    assert.equal(f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)?.evaluationStage, 'WAITING_VERDICT');
    f.setOutcome({ state: 'FINAL', result: 'B_WIN', transactionHash: `0x${'5'.repeat(64)}` });
    await f.worker.tick();
    const settled = f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)!;
    assert.equal(settled.state, 'SETTLED');
    assert.equal(settled.verdictTx, `0x${'5'.repeat(64)}`);
    assert.equal(settled.settleTx, `0x${'3'.repeat(64)}`);
    assert.equal(f.settlements, 1);
    await f.worker.tick();
    assert.equal(f.settlements, 1);
  } finally { f.runtime.close(); }
});

test('provider failure immediately refunds both participants through Arc', async () => {
  const f = fixture();
  try {
    f.setOutcome({ state: 'RETRY_LATER', failureCode: 'PROVIDER_ERROR' });
    await f.worker.tick();
    const stored = f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId);
    assert.equal(f.refunds, 1);
    assert.equal(stored?.state, 'REFUNDABLE');
    assert.equal(stored?.refundTx, `0x${'6'.repeat(64)}`);
    assert.equal(stored?.evaluationStage, 'COMPLETE');
    assert.equal(stored?.evaluationFailureCode, 'PROVIDER_ERROR');
  } finally { f.runtime.close(); }
});

test('provider failure refunds on the first failure without another evaluation attempt', async () => {
  const f = fixture();
  try {
    f.runtime.put('pair-rooms-v1', room.roomId, { ...room, resolutionDeadline: 5000 });
    f.setArc({ ...chainRoom, resolutionDeadline: 5000 });
    f.setOutcome({ state: 'RETRY_LATER', failureCode: 'PROVIDER_ERROR' });
    await f.worker.tick();
    await f.worker.tick();
    assert.equal(f.resolves, 1);
    assert.equal(f.refunds, 1);
    assert.equal(f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)?.evaluationStage, 'COMPLETE');
    assert.equal(f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)?.state, 'REFUNDABLE');
    f.setNow(800);
    await f.worker.tick();
    assert.equal(f.resolves, 1);
    assert.equal(f.expirations, 0);
  } finally { f.runtime.close(); }
});

test('known failed GenLayer transaction refunds immediately and preserves its hash', async () => {
  const f = fixture();
  try {
    f.runtime.put('pair-rooms-v1', room.roomId, { ...room, resolutionDeadline: 20_000 });
    f.setArc({ ...chainRoom, resolutionDeadline: 20_000 });
    f.setOutcome({ state: 'RETRY_LATER', failureCode: 'GENLAYER_ERROR', transactionHash: `0x${'5'.repeat(64)}` } as any);
    await f.worker.tick();
    assert.equal(f.resolves, 1);
    assert.equal(f.refunds, 1);
    const stored = f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId);
    assert.equal(stored?.state, 'REFUNDABLE');
    assert.equal(stored?.verdictTx, `0x${'5'.repeat(64)}`);
  } finally { f.runtime.close(); }
});

test('persists a safe evaluation failure code for participant diagnostics', async () => {
  const f = fixture();
  try {
    f.setOutcome({ state: 'RETRY_LATER', failureCode: 'GENLAYER_BUSY' });
    await f.worker.tick();
    const stored = f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId);
    assert.equal(stored?.evaluationStage, 'COMPLETE');
    assert.equal((stored as PairRoom & { evaluationFailureCode?: string })?.evaluationFailureCode, 'GENLAYER_BUSY');
    assert.equal(stored?.state, 'REFUNDABLE');
  } finally { f.runtime.close(); }
});

test('retries finalized validator disagreement before settling a later scenario', async () => {
  const f = fixture();
  try {
    f.setOutcome({ state: 'RETRY_LATER', failureCode: 'GENLAYER_NO_CONSENSUS', transactionHash: `0x${'5'.repeat(64)}` });
    await f.worker.tick();
    const retrying = f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId);
    assert.equal(retrying?.evaluationStage, 'RETRYING');
    assert.equal(retrying?.evaluationFailureCode, 'GENLAYER_NO_CONSENSUS');
    assert.equal(retrying?.evaluationAttempts, 1);
    assert.equal(retrying?.state, 'JOINED');
    assert.equal(f.refunds, 0);
    f.setOutcome({ state: 'FINAL', result: 'A_WIN', transactionHash: `0x${'7'.repeat(64)}` });
    await f.worker.tick();
    assert.equal(f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)?.state, 'SETTLED');
    assert.equal(f.settlements, 1);
  } finally { f.runtime.close(); }
});

test('refunds only after the initial comparison and three no-consensus retries', async () => {
  const f = fixture();
  try {
    f.setOutcome({ state: 'RETRY_LATER', failureCode: 'GENLAYER_NO_CONSENSUS', transactionHash: `0x${'5'.repeat(64)}` });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await f.worker.tick();
      assert.equal(f.refunds, 0);
      assert.equal(f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)?.evaluationAttempts, attempt);
    }
    await f.worker.tick();
    assert.equal(f.resolves, 4);
    assert.equal(f.refunds, 1);
    assert.equal(f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)?.state, 'REFUNDABLE');
  } finally { f.runtime.close(); }
});

test('marks a submitted comparison as verdict pending without treating it as a provider error', async () => {
  const f = fixture();
  try {
    f.setOutcome({ state: 'WAITING', failureCode: 'VERDICT_PENDING' });
    await f.worker.tick();
    const stored = f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId);
    assert.equal(stored?.evaluationStage, 'WAITING_VERDICT');
    assert.equal((stored as PairRoom & { evaluationFailureCode?: string })?.evaluationFailureCode, 'VERDICT_PENDING');
  } finally { f.runtime.close(); }
});

test('backfills a legacy exhausted retry from its private error without another external call', async () => {
  const f = fixture();
  try {
    f.runtime.put('pair-room-worker-retries', room.roomId, { failures: 3, nextAt: 9000 });
    f.runtime.put('pair-room-worker-errors', room.roomId, { at: 100, message: 'GenLayer RPC error: Server busy: all 8 execution slots occupied, retry later' });
    await f.worker.tick();
    const stored = f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId);
    assert.equal((stored as PairRoom & { evaluationFailureCode?: string })?.evaluationFailureCode, 'GENLAYER_BUSY');
    assert.equal(f.resolves, 0);
  } finally { f.runtime.close(); }
});

test('reports an Arc infrastructure failure without exposing its raw message', async () => {
  const f = fixture();
  try {
    f.setArcFailure(new Error('Arc RPC unavailable at a private upstream URL'));
    await f.worker.tick();
    const stored = f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId);
    assert.equal(stored?.evaluationFailureCode, 'ARC_ERROR');
    assert.equal(stored?.evaluationStage, 'RETRYING');
    assert.equal(JSON.stringify(stored).includes('private upstream URL'), false);
  } finally { f.runtime.close(); }
});

test('rejects a changed Arc participant binding before paying provider or settling', async () => {
  const f = fixture();
  try {
    f.setOutcome({ state: 'FINAL', result: 'A_WIN', transactionHash: `0x${'5'.repeat(64)}` });
    f.setArc({ ...chainRoom, challenger: address('9') });
    await f.worker.tick();
    assert.equal(f.settlements, 0);
    assert.equal(f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)?.state, 'JOINED');
  } finally { f.runtime.close(); }
});

test('a tie immediately opens both refunds without choosing a winner', async () => {
  const f = fixture();
  try {
    f.setOutcome({ state: 'FINAL', result: 'TIE', transactionHash: `0x${'5'.repeat(64)}` });
    await f.worker.tick();
    assert.equal(f.settlements, 0);
    assert.equal(f.refunds, 1);
    assert.equal(f.expirations, 0);
    assert.equal(f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)?.state, 'REFUNDABLE');
  } finally { f.runtime.close(); }
});

test('failed pending join stays cancelable and expires from Arc open state', async () => {
  const f = fixture();
  try {
    f.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'JOINING', joinTx: undefined });
    f.setArc({ ...chainRoom, state: 1, challenger: address('0'), challengerAgentVersion: `0x${'0'.repeat(64)}` });
    f.setNow(99);
    await f.worker.tick();
    assert.equal(f.expirations, 0);
    f.setNow(100);
    await f.worker.tick();
    assert.equal(f.expirations, 1);
    assert.equal(f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)?.state, 'REFUNDABLE');
  } finally { f.runtime.close(); }
});

test('confirmed pending join is reconciled from Arc and becomes eligible for judgment', async () => {
  const f = fixture();
  try {
    f.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'JOINING' });
    await f.worker.tick();
    assert.equal(f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)?.state, 'JOINED');
    assert.equal(f.resolves, 0);
    await f.worker.tick();
    assert.equal(f.resolves, 1);
  } finally { f.runtime.close(); }
});

test('Arc confirming a join before its transaction hash is stored does not delay evaluation', async () => {
  const f = fixture();
  try {
    f.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'JOINING', joinTx: undefined, evaluationStage: undefined });
    await f.worker.tick();
    const pending = f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)!;
    assert.equal(pending.state, 'JOINING');
    assert.equal(pending.evaluationFailureCode, undefined);
    assert.equal(f.runtime.get('pair-room-worker-retries', room.roomId), undefined);
    f.runtime.put('pair-rooms-v1', room.roomId, { ...pending, state: 'JOINED', joinTx: room.joinTx, evaluationStage: 'QUEUED' });
    await f.worker.tick();
    assert.equal(f.resolves, 1);
    assert.equal(f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)?.evaluationStage, 'WAITING_VERDICT');
  } finally { f.runtime.close(); }
});

test('an unrecorded join with a different Arc challenger is not accepted', async () => {
  const f = fixture();
  try {
    f.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'JOINING', joinTx: undefined });
    f.setArc({ ...chainRoom, challenger: address('9') });
    await f.worker.tick();
    assert.equal(f.resolves, 0);
    assert.equal(f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)?.evaluationFailureCode, 'ARC_ERROR');
  } finally { f.runtime.close(); }
});

test('independent Pair Match rooms progress concurrently', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  let active = 0; let peak = 0; let started = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const rooms = Array.from({ length: 8 }, (_, index) => ({ ...room, roomId: digest((index + 1).toString(16)) }));
  for (const item of rooms) runtime.put('pair-rooms-v1', item.roomId, item);
  const arc: PairSettlementArcPort = {
    async getRoom() { return structuredClone(chainRoom); },
    async settle() { throw new Error('settlement must not run'); },
    async expire() { throw new Error('expiry must not run'); },
    async refund() { throw new Error('refund must not run'); },
  };
  const outcome: PairOutcomePort = {
    async resolve() {
      active += 1; started += 1; peak = Math.max(peak, active);
      await barrier;
      active -= 1;
      return { state: 'WAITING', failureCode: 'VERDICT_PENDING' };
    },
  };
  try {
    const pending = new PairSettlementWorker(runtime, arc, outcome, () => 200).tick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const observedStarted = started;
    release();
    await pending;
    assert.equal(observedStarted, rooms.length);
    assert.equal(peak, rooms.length);
  } finally {
    release();
    runtime.close();
  }
});

test('automatic refund opens both credits and leaves a failed delivery claimable', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  const calls: Array<{ principal: string; kind: string; executionKey: string }> = [];
  let transaction = 0;
  const identities = {
    async pairActionForPrincipal(principal: string, input: { escrowAddress: string; roomId: string; kind: 'REQUEST_CANCEL' | 'WITHDRAW'; executionKey: string }) {
      calls.push({ principal, kind: input.kind, executionKey: input.executionKey });
      if (principal === room.challenger && input.kind === 'WITHDRAW') throw new Error('delivery unavailable');
      transaction += 1;
      return { txHash: `0x${transaction.toString(16).padStart(64, '0')}` };
    },
  };
  try {
    const refunds = new LivePairAutomaticRefund(runtime, identities, address('9'));
    const refundTx = await refunds.refund(room, 'GENLAYER_BUSY');
    assert.equal(refundTx, `0x${'2'.padStart(64, '0')}`);
    assert.deepEqual(calls.map(({ principal, kind }) => ({ principal, kind })), [
      { principal: room.creator, kind: 'REQUEST_CANCEL' },
      { principal: room.challenger, kind: 'REQUEST_CANCEL' },
      { principal: room.creator, kind: 'WITHDRAW' },
      { principal: room.challenger, kind: 'WITHDRAW' },
    ]);
    assert.deepEqual(runtime.get('pair-room-automatic-refund-deliveries', room.roomId), [
      { status: 'DELIVERED', txHash: `0x${'3'.padStart(64, '0')}` },
      { status: 'CLAIM_REQUIRED' },
    ]);
    assert.equal(new Set(calls.map((call) => call.executionKey)).size, 4);
  } finally { runtime.close(); }
});

test('Pair Arc serializes transaction sends but waits for receipts concurrently', async () => {
  const privateKey = `0x${'0'.repeat(63)}1` as const;
  const operator = privateKeyToAccount(privateKey).address;
  let activeWrites = 0; let peakWrites = 0; let startedWrites = 0; let receiptWaits = 0;
  let releaseFirstWrite!: () => void;
  let releaseReceipts!: () => void;
  const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
  const receipts = new Promise<void>((resolve) => { releaseReceipts = resolve; });
  const chain = {
    escrowAddress: address('9'),
    async assertReady() {},
  } as unknown as ArcPairChainPort;
  const publicClient = {
    async simulateContract(input: any) { return { request: input }; },
    async waitForTransactionReceipt() { receiptWaits += 1; await receipts; return { status: 'success' }; },
  };
  const walletClient = {
    async writeContract() {
      activeWrites += 1; startedWrites += 1; peakWrites = Math.max(peakWrites, activeWrites);
      if (startedWrites === 1) await firstWrite;
      activeWrites -= 1;
      return `0x${String(startedWrites).repeat(64)}` as const;
    },
  };
  const arc = new LivePairSettlementArc(chain, privateKey, operator, undefined, undefined, { publicClient, walletClient });
  const first = arc.settle(digest('a'), operator, digest('b'));
  const second = arc.settle(digest('c'), operator, digest('d'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const writesBeforeFirstHash = startedWrites;
  releaseFirstWrite();
  for (let index = 0; index < 10 && startedWrites < 2; index += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  const writesWhileFirstReceiptPending = startedWrites;
  const pendingReceipts = receiptWaits;
  releaseReceipts();
  await Promise.all([first, second]);
  assert.equal(writesBeforeFirstHash, 1);
  assert.equal(writesWhileFirstReceiptPending, 2);
  assert.equal(pendingReceipts, 2);
  assert.equal(peakWrites, 1);
});
