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
      runner: { get: () => campaign, async advance() { advances += 1; return campaign; } } as any,
    });

    await service.start('usr_owner', owner, campaignId);
    await service.start('usr_owner', owner, campaignId);

    assert.deepEqual(transfers, [{ userId: 'usr_owner', destinationAddress: operator, amount: '1.25', idempotencyKey: `evo-fee:${campaignId}` }]);
    assert.equal(advances, 2);
    assert.equal(service.getFee(campaignId)?.state, 'SUBMITTED');
    assert.equal(JSON.stringify(service.getFee(campaignId)).includes('gas'), false);
    await service.advance(owner, campaignId);
    await assert.rejects(service.advance(`0x${'3'.repeat(40)}`, campaignId), /not found/);
  } finally { runtime.close(); }
});

test('Evo fails closed before execution when its USDC fee transfer fails', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    let advances = 0;
    const service = new EvaluationExecutionService({
      runtime, operatorAddress: operator, feeUsdc: '1',
      fees: { async transferUsdcWithIdempotency() { throw new Error('insufficient USDC'); } },
      runner: { get: () => ({ campaignId, owner }), async advance() { advances += 1; return {} as any; } } as any,
    });
    await assert.rejects(service.start('usr_owner', owner, campaignId), /insufficient USDC/);
    assert.equal(advances, 0);
    assert.equal(service.getFee(campaignId)?.state, 'FAILED');
  } finally { runtime.close(); }
});
