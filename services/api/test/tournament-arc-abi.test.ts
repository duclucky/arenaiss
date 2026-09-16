import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeFunctionResult, encodeFunctionResult, parseAbi } from 'viem';

import { TOURNAMENT_ABI } from '../src/tournament-operations-live.ts';

test('Arc getTournament ABI decodes the deployed struct as named fields', () => {
  const deployedAbi = parseAbi([
    'function getTournament(bytes32) view returns (((uint64 registrationOpensAt,uint64 registrationClosesAt,uint64 startsAt,uint64 expiresAt,uint32 minEntrants,uint32 maxEntrants,uint128 stakeAmount,address operatorAddress,address feeRecipient,uint16[5] payoutBps) policy,uint8 state,uint32 entrantCount,uint256 totalLockedStakes,uint256 totalLiability,uint256 platformFeeCredit,bytes32 rankingDigest,uint256 settlementNonce) tournament)',
  ]);
  const value = {
    policy: { registrationOpensAt: 100n, registrationClosesAt: 1_900n, startsAt: 1_900n, expiresAt: 100_000n, minEntrants: 8, maxEntrants: 8, stakeAmount: 1_000_000n, operatorAddress: `0x${'1'.repeat(40)}`, feeRecipient: `0x${'2'.repeat(40)}`, payoutBps: [4_000, 2_500, 1_500, 1_000, 1_000] },
    state: 0,
    entrantCount: 0,
    totalLockedStakes: 0n,
    totalLiability: 0n,
    platformFeeCredit: 0n,
    rankingDigest: `0x${'0'.repeat(64)}`,
    settlementNonce: 0n,
  };
  const data = encodeFunctionResult({ abi: deployedAbi, functionName: 'getTournament', result: value });
  const decoded = decodeFunctionResult({ abi: TOURNAMENT_ABI, functionName: 'getTournament', data });
  assert.equal(Array.isArray(decoded), false);
  assert.equal(Number(decoded.state), 0);
  assert.equal(decoded.policy.stakeAmount, 1_000_000n);
});
