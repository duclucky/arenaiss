# Phase 2 admission audit

> **Historical audit:** this records the pre-simplification trust-minimized
> design. It does not describe the active trusted-operator MVP and must not gate
> its dependency order except as evidence of the unresolved parent policy.

## Decision

The three admission matrices are internally consistent after locking the
Arc-to-GenLayer snapshot path and the no-reroll randomness rule. Phase 2 still
cannot exit because the live authority operators and target-runtime probes do
not yet exist. This document is an audit record, not implementation approval.

## Locked topology for admission

```text
Arc TournamentManager
  - owns entrant identity, USDC stakes, roster, seed commitment and credits
  - precommits seedBlock during roster lock
  - reads blockhash(seedBlock) internally and never accepts a caller hash
  - exposes fixed-width snapshotV1(tournamentId)
        |
        | permissionless exact-block pull
        | ArcSourcePolicyV1: 3 matching of 4 locked RPC sources
        v
GenLayer TournamentJudge
  - recomputes roster/seed/bracket bindings
  - verifies one atomic ACI A/B receipt before semantic judgment
  - owns append-only attempts, match verdicts, bracket and ranking
        |
        | FinalizedRankingV1; 3-of-5 independent finality notaries
        v
Arc ResultVerifier -> TournamentManager
  - verifies source/destination/epoch/quorum/finality/execution/replay
  - manager derives the 10% fee and 90% winner credits in Solidity
```

The coordinator may trigger every permissionless step and transport bytes, but
it is never the source authority for roster, randomness, outputs, verdict,
ranking, wallet, fee, or payout amount.

## Audit findings resolved in this pass

### A1 — caller-supplied randomness removed

The earlier provisional method `lockSeed(blockNumber, blockHash)` exposed two
values that the contract must determine itself. It is replaced by:

1. `lockRoster()`, which sets the future seed block from immutable policy and
   current block height; and
2. `finalizeSeed()`, which reads `blockhash(seedBlock)` inside Arc and derives
   the seed once.

The legal block-height interval is:

```text
seedBlock < block.number < seedBlock + 256
```

If this window is missed, the MVP cancels and makes every accepted stake fully
refundable. A replacement seed is forbidden, preventing selective withholding
from becoming a reroll.

### A2 — Arc-to-GenLayer authority made explicit

The earlier matrices named an authenticated Arc roster but did not say how
GenLayer authenticated it. `importArcSnapshot(tournamentId, snapshotBlock)` now
uses a fixed-block pull rather than a relay signature:

- the judge constructor binds Arc chain `5042002`, the exact manager address,
  `snapshotV1` schema/policy digests, and the RPC source policy;
- each source must return the same chain ID, exact block hash, and exact
  fixed-width `eth_call` bytes for the manager at that block;
- three of four locked sources must match before normalization;
- GenLayer validators independently repeat the source read under strict
  equality;
- conflicts, outages, malformed responses, or wrong bindings are `RETRYABLE`
  and create no bracket state.

Current Arc documentation lists the four no-key endpoints in the bounded
fixture: public Arc RPC, Blockdaemon, dRPC, and QuickNode. On 2026-09-11 all
four returned the same hash for block `61544328`. The fixture verifier rejects
duplicate endpoints, wrong chain/block, and an insufficient matching quorum.

This is still not a target-runtime proof. Provider organizational independence
has not been established, and no Studionet Intelligent Contract has executed
the POST/normalization path.

### A3 — redundant pass-through write removed

The provisional `submitGenLayerSettlementProof` write did not own an additional
state or trust boundary. Finality notaries read the already-finalized canonical
ranking; any caller then delivers their EIP-712 statements directly to the Arc
`ResultVerifier`. No extra GenLayer proof-registration contract or write is
needed.

### A4 — Solidity parity placed at its dependency-correct phase

Phase 2 selects schemas, bindings, authorities, failure policy, and fixtures.
Byte-for-byte TypeScript/Python/Solidity parity requires the scaffold and
consumer implementations produced in Phases 5–6. It therefore remains a Phase
6 exit check and cannot be a prerequisite for authoring that same Solidity
implementation.

This does not weaken the production gate: Arc escrow, verifier, or settlement
claims remain forbidden until the parity suite is green. It only removes a
cycle where Phase 2 demanded output that the plan assigns to Phase 6.

## Matrix coverage result

| Required area | Evidence Authority Matrix | Write safety matrix | Value-destination matrix | Result |
| --- | --- | --- | --- | --- |
| Entrant/prompt/stake | Complete | Complete | Complete | `READY FOR SPEC FREEZE` |
| Roster and Arc snapshot | Complete after A2 | Complete after A2 | No value movement | `TARGET PROBE OPEN` |
| Seed/bracket/topics | Complete after A1 | Complete after A1 | Cancellation refund covered | `TARGET PROBE OPEN` |
| Atomic A/B inference | Complete format | Complete | Platform budget separated | `ARENA ACI DEPLOYMENT OPEN` |
| Semantic verdict/ranking | Complete format | Complete | No direct value movement | `GENLAYER INTEGRATION OPEN` |
| Finality proof | Complete format | Arc delivery complete | Settlement destinations complete | `REAL COMMITTEE OPEN` |
| USDC settlement/recovery | Complete | Complete | Conservation/terminal paths complete | `SOLIDITY/LIVE LIFECYCLE OPEN` |

## Remaining admission blockers

1. Deploy or select an Arena-specific ACI atomic pair-runner and verify a fresh
   per-request receipt plus key-custody policy.
2. Run a bounded Studionet probe proving GenVM can reach and normalize the
   locked Arc RPC source policy at an exact block.
3. Identify five independent finality operators, publish their verification
   policy/public keys, and prove three canonical finalized-state signatures.
4. Resolve the parent Differentiation gate or satisfy its exact structural
   question; owner acceptance of overlap does not modify the workspace rule.
5. Resolve the workspace sequencing conflict in which Phase 2 requires all 14
   gates before code while the Projects `Full lifecycle` gate itself requires a
   real frontend/transaction lifecycle. The child project cannot override that
   parent policy.

Until these items are resolved, the status remains `CANDIDATE` and Phase 3 does
not start.
