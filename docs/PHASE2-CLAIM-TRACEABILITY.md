# Phase 2 claim-to-code traceability draft

> **Superseded claim map:** replace in active Phase 1. The current MVP claims only
> GenLayer judgment over submitted bytes, backend-operated tournament state and
> Arc operator-authorized accounting; no cross-chain proof claim survives.

This matrix maps the MVP claims to planned public boundaries before the ABI is
frozen. Names may change only through Phase 4 change control; every replacement
must preserve the same observable behavior and tests.

| Product claim | Planned public write/boundary | Canonical state/view | Required test IDs | User-facing path |
| --- | --- | --- | --- | --- |
| A creator locks one tournament policy before value enters | Arc `createTournament(policy)` | `tournamentConfig`, `policyDigest`, phase | `ARC-CFG-*`, `ARC-CREATE-*` | Create-tournament form and immutable policy summary |
| A player enters once with one prompt version and exact USDC stake | Arc `registerEntrant` | `entrantView`, `grossPool`, `totalLiability` | `ARC-REG-*`, `SEC-PROV-*` | Agent selection, fee/stake confirmation, submitted/confirmed states |
| Registration closes even if stored phase is stale | Arc `lockRoster`; local deadline guard remains inside `registerEntrant` | roster count/digest/revision, phase | `ARC-REG-004`, `ARC-ROSTER-*` | Registration closed/refundable status |
| Pairing, byes and topics cannot be rerolled by the operator | Arc `lockRoster` precommits seed block; `finalizeSeed` reads it internally | seed block/hash/commitment, bracket digest | `ARC-SEED-*`, `PRT-BRACKET-*`, `SEC-RANDOM-*` | Read-only bracket/source verification drawer |
| Tournament starts without players returning | Permissionless Arc `startTournament`; scheduler is only the primary caller | phase, start timestamp, snapshot digest | `ARC-START-*`, `COR-SCAN-*` | Scheduled/running state; no player action requested |
| GenLayer receives the exact Arc roster/seed snapshot | GenLayer `importArcSnapshot(tournamentId, snapshotBlock)` with `ArcSourcePolicyV1` | imported snapshot digest, source block, judge phase | `GLJ-SOURCE-*`, `NET-GL-SOURCE-*` | Contextual source health/retry state |
| Both agents run under the same locked model policy | Attested pair-runner plus GenLayer `submitInferencePair` | attempt, A/B output and receipt digests, provenance status | `INF-*`, `GLJ-PROV-*`, `SEC-PROV-*` | Match attempt/retry status; raw prompt hidden from public surface |
| GenLayer—not the backend—decides each match | GenLayer `judgeMatch`, `retryMatch`, `finalizeRound`, `finalizeRanking` | criterion mapping, verdict, append-only attempts, bracket, ranking | `GLJ-VERDICT-*`, `GLJ-RETRY-*`, `GLJ-ROUND-*`, `GLJ-RANK-*` | Bracket and finalized/retryable match views |
| A finalized ranking can settle Arc only once | Arc `deliverSettlementProof` through `ResultVerifier` | proof digest/epoch/nonce, settlement status, credits | `VRF-*`, `ARC-SET-*`, `SEC-REPLAY-*` | Settlement pending/verified/failed states |
| Exactly 10% becomes platform credit and 90% becomes top-five credits | Arc settlement code derives amounts; `withdrawCredit` transfers them | accounting view, fee/winner credits, liability | `ARC-ACC-*`, `ARC-WITHDRAW-*` | Prize/fee breakdown and withdrawal receipt |
| Failure never silently forfeits a player's stake | Arc `cancelTournament`, `withdrawCredit`, `closeTournament` | cancellation reason, refund credits, zero-liability closure | `ARC-CANCEL-*`, `ARC-WITHDRAW-*`, `SYS-REFUND-*` | Refund available/withdrawn/closed states |

## Admission interpretation

The planned boundaries cover the material product claims, but this is not a
claim that the methods, tests, frontend, or deployed views exist. Phase 4 must
freeze the ABI and assign exact acceptance IDs before implementation. The
Projects `Full lifecycle` gate remains open until the real frontend and network
lifecycle are executed under their later phase gates.
