import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import { EvaluationExecutionService } from '../src/evaluation-execution.ts';

const campaignId = `sha256:${'a'.repeat(64)}`;
const owner = `0x${'1'.repeat(40)}`;
const operator = `0x${'2'.repeat(40)}`;

test('Evo charges the configured USDC fee once and keeps GenLayer gas outside the fee boundary', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const transfers: any[] = []; let advances = 0;
    const campaign = { campaignId, owner, state: 'PENDING' } as any;
    const service = new EvaluationExecutionService({
      runtime, operatorAddress: operator, feeUsdc: '1.25',
      fees: { async transferUsdcWithIdempotency(userId, destinationAddress, amount, idempotencyKey) { transfers.push({ userId, destinationAddress, amount, idempotencyKey }); return { transactionId: 'circle_1', state: 'SUBMITTED' }; } },
      model: 'cheap-5.6-sol', runner: { get: () => campaign, async advance() { advances += 1; return campaign; } } as any,
    });

    await service.start('usr_owner', owner, campaignId);
    await service.start('usr_owner', owner, campaignId);

    assert.equal(transfers.length, 1);
    assert.deepEqual({ ...transfers[0], idempotencyKey: '<uuid>' }, { userId: 'usr_owner', destinationAddress: operator, amount: '1.25', idempotencyKey: '<uuid>' });
    assert.match(transfers[0].idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(advances, 2);
    assert.equal(service.getFee(campaignId)?.state, 'SUBMITTED');
    assert.equal(JSON.stringify(service.getFee(campaignId)).includes('gas'), false);
    await service.advance(owner, campaignId);
    await assert.rejects(service.advance(`0x${'3'.repeat(40)}`, campaignId), /not found/);
  } finally { runtime.close(); }
});

test('Evo retries a rejected fee with the same persisted UUID and advances only after submission', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    let advances = 0;
    const keys: string[] = []; let calls = 0;
    const service = new EvaluationExecutionService({
      runtime, operatorAddress: operator, feeUsdc: '1',
      fees: { async transferUsdcWithIdempotency(_userId, _destination, _amount, key) { keys.push(key); calls += 1; if (calls === 1) throw new Error('API parameter invalid'); return { transactionId: 'circle_2', state: 'SUBMITTED', txHash: `0x${'a'.repeat(64)}` }; } },
      model: 'cheap-5.6-sol', runner: { get: () => ({ campaignId, owner }), async advance() { advances += 1; return {} as any; } } as any,
    });
    await assert.rejects(service.start('usr_owner', owner, campaignId), /API parameter invalid/);
    assert.equal(advances, 0);
    assert.equal(service.getFee(campaignId)?.state, 'FAILED');
    await service.start('usr_owner', owner, campaignId);
    assert.equal(advances, 1);
    assert.equal(keys[0], keys[1]);
    assert.match(keys[0], /^[0-9a-f-]{36}$/i);
  } finally { runtime.close(); }
});

test('Evo requires the shared Tournament model instead of inventing a default', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    assert.throws(() => new EvaluationExecutionService({ runtime, operatorAddress: operator, feeUsdc: '1', fees: {} as any, runner: {} as any }), /model/i);
  } finally { runtime.close(); }
});
