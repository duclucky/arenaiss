# Arc escrow ABI boundary v1

This document is the TypeScript/backend boundary for the local Solidity
`TournamentEscrow`. It builds call intents only; it performs no RPC, wallet
write or USDC transfer.

## State-changing calls

```text
createTournament(bytes32 tournamentId, Policy policy)
register(bytes32 tournamentId, bytes32 entrantId, bytes32 agentId,
         bytes32 agentsVersion, bytes32 agentsCommitment)
closeRegistration(bytes32 tournamentId)
markRunning(bytes32 tournamentId)
settleByOperator(bytes32 tournamentId, bytes32[] rankedEntrants,
                 bytes32 rankingDigest, uint256 settlementNonce)
cancelAndOpenRefunds(bytes32 tournamentId, bytes32 reason)
claimRefund(bytes32 tournamentId, bytes32 entrantId)
withdrawCredit(bytes32 tournamentId)
withdrawCreditFor(bytes32 tournamentId, address beneficiary)
withdrawPlatformFee(bytes32 tournamentId)
withdrawPlatformFeeFor(bytes32 tournamentId)
closeTournament(bytes32 tournamentId)
```

The entry stake is not caller-supplied: it is the immutable per-tournament
policy amount and is pulled from the entrant's USDC allowance. Settlement takes
only five unique registered IDs, a non-zero digest and a monotonic nonce. The
operator cannot provide fee, payout or recipient amounts. The immutable escrow
deployer (`owner`) is the only fee destination. Any relayer may pay gas for
`withdrawCreditFor`, but the supplied beneficiary is simultaneously the credit
owner and transfer destination, so there is no arbitrary recipient field.
`withdrawPlatformFeeFor` has no recipient argument and always pays the locked
owner. The original pull methods remain available as a fallback.

Read methods are `owner()`, `usdc()`, `getTournament(bytes32)`,
`getEntrant(bytes32,bytes32)` and `creditOf(bytes32,address)`.
