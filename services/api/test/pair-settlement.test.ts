import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
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
  let outcome: Awaited<ReturnType<PairOutcomePort['resolve']>> = { state: 'WAITING' };
  let now = 200;
  let settlements = 0;
  let expirations = 0;
  let resolves = 0;
  const arc: PairSettlementArcPort = {
    async getRoom() { return structuredClone(arcRoom); },
    async settle(_roomId, winner, verdictDigest) {
      settlements++;
      arcRoom = { ...arcRoom, state: 3, winner, verdictDigest: `0x${verdictDigest.slice(7)}` } as ChainRoom;
      return `0x${'3'.repeat(64)}`;
    },
    async expire() { expirations++; arcRoom = { ...arcRoom, state: 4 }; return `0x${'4'.repeat(64)}`; },
  };
  const judge: PairOutcomePort = { async resolve() { resolves++; return outcome; } };
  const worker = new PairSettlementWorker(runtime, arc, judge, () => now);
  return { runtime, worker, get settlements() { return settlements; }, get expirations() { return expirations; }, get resolves() { return resolves; },
    setOutcome(value: typeof outcome) { outcome = value; }, setArc(value: ChainRoom) { arcRoom = value; }, setNow(value: number) { now = value; } };
}

test('settles only a canonical finalized comparison, persists its intent, and reconciles retry', async () => {
  const f = fixture();
  try {
    await f.worker.tick();
    assert.equal(f.settlements, 0);
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

test('provider failures have a bounded retry budget while timeout refunds remain available', async () => {
  const f = fixture();
  try {
    f.runtime.put('pair-rooms-v1', room.roomId, { ...room, resolutionDeadline: 5000 });
    f.setArc({ ...chainRoom, resolutionDeadline: 5000 });
    f.setOutcome({ state: 'RETRY_LATER' });
    await f.worker.tick();
    await f.worker.tick();
    assert.equal(f.resolves, 1);
    f.setNow(800);
    await f.worker.tick();
    f.setNow(2000);
    await f.worker.tick();
    assert.equal(f.resolves, 3);
    f.setNow(3000);
    await f.worker.tick();
    assert.equal(f.resolves, 3);
    f.setNow(5000);
    await f.worker.tick();
    assert.equal(f.expirations, 1);
    assert.equal(f.runtime.get<PairRoom>('pair-rooms-v1', room.roomId)?.state, 'REFUNDABLE');
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

test('a tie cannot choose a winner and deadline expiry opens both refunds', async () => {
  const f = fixture();
  try {
    f.setOutcome({ state: 'FINAL', result: 'TIE', transactionHash: `0x${'5'.repeat(64)}` });
    await f.worker.tick();
    assert.equal(f.settlements, 0);
    f.setNow(1000);
    await f.worker.tick();
    assert.equal(f.expirations, 1);
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
