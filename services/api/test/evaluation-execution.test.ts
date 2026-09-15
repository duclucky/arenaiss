import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import { EvaluationExecutionService } from '../src/evaluation-execution.ts';

const campaignId = `sha256:${'a'.repeat(64)}`;
const owner = `0x${'1'.repeat(40)}`;
const operator = `0x${'2'.repeat(40)}`;
const escrow = `0x${'3'.repeat(40)}`;
const tx = (digit: string) => ({ transactionId: `circle-${digit}`, state: 'COMPLETE', txHash: `0x${digit.repeat(64)}` });

test('Evo holds one fixed USDC fee then releases it only after all tests finalize', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const holds: any[] = []; const releases: string[] = []; let advances = 0;
    const campaign: any = { campaignId, owner, state: 'PENDING' };
    const service = new EvaluationExecutionService({
      runtime, operatorAddress: operator, escrowAddress: escrow, feeUsdc: '1', model: 'cheap-5.6-sol',
      fees: { async holdEvaluationFee(input: any) { holds.push(input); return { approval: tx('1'), deposit: tx('2') }; } },
      settlement: { async release(id: string) { releases.push(id); return tx('3'); }, async refund() { throw new Error('unexpected refund'); } },
      runner: { get: () => campaign, async advance() { advances += 1; campaign.state = advances === 2 ? 'FINALIZED' : 'RUNNING'; return structuredClone(campaign); }, failInfrastructure() { throw new Error('unexpected failure'); } } as any,
    });

    await service.start('usr_owner', owner, campaignId);
    await service.advance(owner, campaignId);

    assert.equal(holds.length, 1);
    assert.equal(holds[0].escrowAddress, escrow);
    assert.equal(holds[0].amountUsdc, '1');
    assert.match(holds[0].approvalIdempotencyKey, /^[0-9a-f-]{36}$/i);
    assert.match(holds[0].depositIdempotencyKey, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(releases, [campaignId]);
    assert.equal(service.getFee(campaignId)?.state, 'RELEASED');
  } finally { runtime.close(); }
});

test('Evo refunds held USDC when the runner returns an infrastructure failure', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const refunds: string[] = [];
    const failed: any = { campaignId, owner, state: 'FAILED', items: [{ state: 'FAILED', failure: 'INFRASTRUCTURE_ERROR' }] };
    const service = new EvaluationExecutionService({
      runtime, operatorAddress: operator, escrowAddress: escrow, feeUsdc: '1', model: 'cheap-5.6-sol',
      fees: { async holdEvaluationFee() { return { approval: tx('1'), deposit: tx('2') }; } },
      settlement: { async release() { throw new Error('unexpected release'); }, async refund(id: string) { refunds.push(id); return tx('4'); } },
      runner: { get: () => failed, async advance() { return failed; }, failInfrastructure() { return failed; } } as any,
    });

    const result = await service.start('usr_owner', owner, campaignId);
    assert.equal(result.state, 'FAILED');
    assert.deepEqual(refunds, [campaignId]);
    assert.equal(service.getFee(campaignId)?.state, 'REFUNDED');
    await service.advance(owner, campaignId);
    assert.deepEqual(refunds, [campaignId]);
  } finally { runtime.close(); }
});

test('unexpected runner errors become terminal infrastructure failures and refund', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const failed: any = { campaignId, owner, state: 'FAILED', items: [{ state: 'FAILED', failure: 'INFRASTRUCTURE_ERROR' }] };
    let marked = 0; let refunded = 0;
    const service = new EvaluationExecutionService({
      runtime, operatorAddress: operator, escrowAddress: escrow, feeUsdc: '1', model: 'cheap-5.6-sol',
      fees: { async holdEvaluationFee() { return { approval: tx('1'), deposit: tx('2') }; } },
      settlement: { async release() { throw new Error('unexpected release'); }, async refund() { refunded += 1; return tx('4'); } },
      runner: { get: () => ({ campaignId, owner, state: 'RUNNING' }), async advance() { throw new Error('canonical readback failed'); }, failInfrastructure() { marked += 1; return failed; } } as any,
    });

    const result = await service.start('usr_owner', owner, campaignId);
    assert.equal(result.state, 'FAILED');
    assert.equal(marked, 1);
    assert.equal(refunded, 1);
    assert.equal(service.getFee(campaignId)?.state, 'REFUNDED');
  } finally { runtime.close(); }
});

test('concurrent terminal advances share one Arc settlement operation', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const finalized: any = { campaignId, owner, state: 'FINALIZED', items: [{ state: 'FINALIZED' }] };
    let releases = 0;
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const service = new EvaluationExecutionService({
      runtime, operatorAddress: operator, escrowAddress: escrow, feeUsdc: '1', model: 'cheap-5.6-sol',
      fees: { async holdEvaluationFee() { return { approval: tx('1'), deposit: tx('2') }; } },
      settlement: { async release() { releases += 1; await blocked; return tx('3'); }, async refund() { throw new Error('unexpected refund'); } },
      runner: { get: () => finalized, async advance() { return finalized; }, failInfrastructure() { return finalized; } } as any,
    });

    const first = service.start('usr_owner', owner, campaignId);
    await new Promise((resolve) => setImmediate(resolve));
    const second = service.advance(owner, campaignId);
    unblock();
    await Promise.all([first, second]);

    assert.equal(releases, 1);
    assert.equal(service.getFee(campaignId)?.state, 'RELEASED');
  } finally { runtime.close(); }
});

test('a refunded fee can never be released by a conflicting campaign projection', async () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    const campaign: any = { campaignId, owner, state: 'FAILED', items: [{ state: 'FAILED', failure: 'INFRASTRUCTURE_ERROR' }] };
    let releases = 0;
    const service = new EvaluationExecutionService({
      runtime, operatorAddress: operator, escrowAddress: escrow, feeUsdc: '1', model: 'cheap-5.6-sol',
      fees: { async holdEvaluationFee() { return { approval: tx('1'), deposit: tx('2') }; } },
      settlement: { async release() { releases += 1; return tx('3'); }, async refund() { return tx('4'); } },
      runner: { get: () => campaign, async advance() { return campaign; }, failInfrastructure() { return campaign; } } as any,
    });

    await service.start('usr_owner', owner, campaignId);
    campaign.state = 'FINALIZED';
    await assert.rejects(() => service.advance(owner, campaignId), /already refunded/i);
    assert.equal(releases, 0);
  } finally { runtime.close(); }
});

test('Evo requires the shared model and escrow configuration', () => {
  const runtime = new SqliteRuntimeStore(':memory:');
  try {
    assert.throws(() => new EvaluationExecutionService({ runtime, operatorAddress: operator, feeUsdc: '1', fees: {} as any, settlement: {} as any, runner: {} as any }), /escrow|model/i);
  } finally { runtime.close(); }
});
