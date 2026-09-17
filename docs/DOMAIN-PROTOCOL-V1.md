# Domain protocol v1 — deterministic tournament IDs and bracket

This document freezes the first pure-domain boundary for the trusted-operator
MVP. It is deliberately independent of Arc, GenLayer, a database, and the
provider API. The later adapters must consume these values rather than invent
their own identifiers or ordering.

## Canonical digest encoding

All IDs are lowercase `sha256:` followed by exactly 64 lowercase hexadecimal
characters. The digest input is a byte sequence:

```text
UTF8("ASYNC_AGENT_ARENA|v1|" + kind + "|")
for each field in the declared order:
  UTF8(fieldName) + 0x00 + UTF8(fieldType) + 0x00
  + uint32_be(byte_length(UTF8(canonicalValue)))
  + UTF8(canonicalValue)
```

Object field order is the order in the function signature; it is not sorted.
`uint32` values are canonical base-10 ASCII with no sign or leading zero
(except zero itself). Text is UTF-8 and must be non-empty where the schema says
so. Addresses are lowercase `0x` plus 40 hexadecimal characters. Existing
digests are normalized lowercase and included as their 71-character text form.
Lists are ordered and encoded by the caller as repeated indexed fields; a
permutation therefore changes the digest.

The explicit domain and version prevent IDs from being replayed between entity
types or protocol revisions. Solidity parity will use the same length-prefixed
`abi.encodePacked` preimage and the native `sha256` primitive.

## ID functions

```text
tournamentId(arcChainId, escrowAddress, creatorAddress, creatorNonce)
entrantId(tournamentId, walletAddress, agentId, entryNonce)
roundId(tournamentId, roundNumber, bracketRevision)
matchId(tournamentId, stage, roundNumber, matchIndex, slotA, slotB,
        bracketRevision)
attemptId(matchId, attemptNumber)
```

`slotA` and `slotB` are persisted references (`entrant:<digest>`,
`winner:<match-id>`, or `loser:<match-id>`). A match never derives its A/B
mapping from array position after creation; the persisted slot references are
the authority.

## Tournament policy v1

- registration opens before it closes; close is at or before start; start is
  before expiry;
- entrant bounds are within 8–32 and `minEntrants <= maxEntrants`;
- entry stake is a positive canonical six-decimal USDC integer string;
- `maxStakeUnits` is a positive canonical six-decimal USDC integer and the
  configured entry stake cannot exceed it;
- platform fee is exactly `1_000` BPS;
- exactly five non-negative payout BPS values sum to `10_000`; the contract
  later derives amounts from the net pool and sends rounding remainder to rank
  1;
- retry, tie, model, topic, rubric, and operator policy versions are explicit
  non-empty strings; unknown enum values are rejected.

The policy object is immutable once a tournament is activated. Contestant
`AGENTS.md` versions are immutable after entry; their commitment is recomputed
before each generation call in a later phase.

## Bracket formation v1

Entrants are ordered by `sha256(UTF8("seed-order-v1") || UTF8(seedDigest) ||
UTF8(entrantId))` with digest bytes compared lexicographically. For `n`
entrants, let `p` be the
largest power of two less than or equal to `n`. The number of preliminary
matches is `n - p`; the remaining `2p - n` entrants receive byes. Preliminary
matches consume the first `2 * (n - p)` ordered entrants in consecutive pairs.
The preliminary winners and byes are deterministically placed into the `p`
main-round slots by sorting `sha256(UTF8("main-placement-v1") ||
UTF8(seedDigest) || UTF8(slotRef))`. Main rounds are single elimination. The two semifinal losers
feed a third-place match. The four quarterfinal losers feed a three-match
fifth-place playoff (two semifinals, then a final). The resulting rank sources
are champion, runner-up, third winner, third loser, and fifth-playoff winner.

Formation is append-only and deterministic. A different seed, tournament ID,
or bracket revision produces different match IDs. Progression and ancestry
validation are a separate domain operation; a tie or retry never advances a
slot.

## Bracket formation v2 — rolling single bye

Revision 2 removes the preliminary bracket. At the start of every competitive
round, the currently available entrant/winner slots are ordered by
`sha256(UTF8("rolling-bye-round-<round>-v1") || UTF8(seedDigest) ||
UTF8(slotRef))`. When the count is odd, the first ordered slot receives the
round's only bye. Every other slot is paired adjacently. Winners plus the bye
slot form the next round, so nine entrants progress as `9 → 5 → 3 → 2 → 1`
with exactly one bye in each of the first three rounds.

After the main finalist pair is known, the three strongest non-finalists by
elimination depth enter a two-match placement path. Its first match determines
fifth place; its winner meets the highest placement candidate to determine
third and fourth. The championship final remains last. The resulting rank
sources are champion, runner-up, third, fourth, and fifth. Revision 1 remains
readable for archived Tournaments; new operation records freeze revision 2.

## Progression boundary

`advanceBracket` accepts only the persisted blueprint and a map of finalized
match results. Results are limited to `A_WIN`, `B_WIN`, `TIE`, and `RETRYABLE`.
Unknown/extra match IDs and invalid enums are rejected. A tie/retry, a missing
predecessor, or an unresolved upstream slot returns `PENDING` without
advancing anything. Only when every rank source resolves through terminal
ancestor results does it return `COMPLETE` with exactly five unique entrant
IDs. Re-running the same map is pure and idempotent; persistence and outbox
effects belong to the next phase.
