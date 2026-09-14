import assert from 'node:assert/strict';
import test from 'node:test';

import { SdkGenLayerPort } from '../src/sdk-port.ts';

const id = (char: string) => `sha256:${char.repeat(64)}`;
const pair = { matchId: id('a'), attemptId: id('b'), topic: 'Topic', outputA: 'A', outputB: 'B', outputADigest: id('c'), outputBDigest: id('d'), rubricVersion: 'GeneralResponseV7' };
const judge = '0x1111111111111111111111111111111111111111';
const fees = { distribution: { rotations: [0] }, messageAllocations: [], feeValue: 123n };

test('SDK port submits the exact ArenaMatchJudge ABI order and reads accepted canonical state', async () => {
  const calls: Array<{ kind: string; input: any }> = [];
  const client = {
    async estimateTransactionFeesForWrite(input: any) { calls.push({ kind: 'estimate', input }); return fees; },
    async writeContract(input: any) { calls.push({ kind: 'write', input }); return `0x${'ab'.repeat(32)}`; },
    async getTransaction(input: any) { calls.push({ kind: 'receipt', input }); return { statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN' }; },
    async readContract(input: any) { calls.push({ kind: 'read', input }); return { match_id: pair.matchId }; },
  };
  const port = new SdkGenLayerPort(client);

  const hash = await port.submit(pair, judge);
  await port.getReceipt(hash);
  await port.getResult(judge, pair.matchId, pair.attemptId);

  const writeInput = {
    address: judge, functionName: 'submit_match',
    args: [pair.matchId, pair.attemptId, pair.topic, pair.outputA, pair.outputB, pair.outputADigest, pair.outputBDigest, pair.rubricVersion],
  };
  assert.deepEqual(calls[0], { kind: 'estimate', input: writeInput });
  assert.deepEqual(calls[1], { kind: 'write', input: { ...writeInput, fees } });
  assert.deepEqual(calls[2], { kind: 'receipt', input: { hash } });
  assert.deepEqual(calls[3], { kind: 'read', input: { address: judge, functionName: 'get_match_result', args: [pair.matchId, pair.attemptId], jsonSafeReturn: true } });
});
