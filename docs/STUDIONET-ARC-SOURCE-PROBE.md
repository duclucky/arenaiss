# Bounded Studionet Arc-source probe

> **Post-MVP TM-2 only:** GenLayer does not read Arc snapshots in the trusted
> MVP. This probe is retained for later bracket/randomness trust minimization.

## Status and purpose

This document specifies the first target-runtime availability probe for
`ArcSourcePolicyV1`. It authorizes no deployment, wallet action, funding, or
value transfer. The probe can run only after candidate admission permits a
minimal Intelligent Contract and the user separately authorizes the required
network write/deployment.

The question is narrow: can GenVM validators obtain and normalize the same
exact Arc Testnet snapshot from the locked RPC source set?

## Locked inputs

- Arc chain ID: `5042002`;
- exact snapshot block number, never `latest` inside consensus work;
- exact deployed `TournamentManager` address and `snapshotV1` selector;
- four endpoint identities pinned by deployment policy;
- threshold: at least three unique endpoints returning the same complete
  normalized tuple;
- GenLayer source: Studionet under the workspace's locked D1 decision.

Endpoint membership is immutable for an active tournament. Redirects or aliases
do not create independent sources, and the live probe must record the resolved
provider identity where observable.

## GenVM acquisition shape

The probe uses the current production contract API family:

1. `gl.nondet.web.post` sends bounded JSON-RPC POST requests;
2. each source checks `eth_chainId`;
3. each source reads `eth_getBlockByNumber` for the exact block tag;
4. each source performs `eth_call` against `snapshotV1` at that same block;
5. the nondeterministic function returns a fixed-size normalized tuple, not raw
   JSON or prose;
6. `gl.eq_principle.strict_eq` requires validators to agree on the normalized
   result;
7. contract code additionally enforces unique source membership and the 3-of-4
   identical-result threshold before storing anything.

The normalized tuple is limited to:

```text
arc_chain_id
snapshot_block_number
snapshot_block_hash
manager_address
tournament_id
roster_commitment
bracket_commitment
seed_block_number
seed_block_hash
snapshot_status
```

No claimant-supplied replacement block hash, fallback seed, or free-form
authority field is accepted.

## Deterministic failure classes

| Condition | Result | State/value effect |
| --- | --- | --- |
| Fewer than three matching complete tuples | `RETRYABLE_SOURCE_QUORUM` | No snapshot import |
| Wrong chain, manager, block, tournament, or status | `UNVERIFIABLE_SOURCE` | No snapshot import |
| Timeout, malformed JSON-RPC, oversized body, or decode error | `RETRYABLE_SOURCE` | No snapshot import |
| Same endpoint repeated or aliased | Reject source set | No snapshot import |
| Exact block unavailable after bounded retry window | Tournament recovery | Arc cancellation/refund; no reroll |
| Valid tuple and validator equivalence | Import once | Store exact snapshot digest only |

## Probe procedure and safe evidence

The eventual probe must be intentionally small and non-value-bearing:

1. pin the exact runner hash/API family and lint the probe;
2. exercise normalization in direct tests with raw and normalized RPC fixtures;
3. deploy only after explicit authorization and record the sanitized deployment
   identity;
4. call one exact historical Arc block known to all four sources;
5. read the finalized probe result through a canonical view;
6. repeat one negative case with one malformed/split source fixture only in a
   controlled environment, never by spoofing a production endpoint;
7. archive an allowlisted evidence record.

Allowed evidence fields are network IDs, contract address, safe transaction ID,
finalization status/timestamp, exact Arc block number/hash, source-count and
matching-count, normalized tuple digest, and result enum. Do not store full
Studio receipts, traces, validator configuration, node configuration, secrets,
or raw RPC payloads.

## Acceptance criteria

The probe passes only when current Studionet evidence shows:

- the pinned contract lints and direct tests pass;
- at least three unique locked sources agree on one exact block and snapshot;
- validators finalize the same normalized tuple using the locked nondeterminism
  and equivalence APIs;
- the canonical view exactly matches the independently computed expected digest;
- retry/unverifiable paths cannot import a snapshot or alter accounting;
- evidence names the runner version, source policy revision, contract revision,
  network, and observation time.

A successful Node/PowerShell fetch or the existing 4-of-4 Arc observation does
not satisfy this target-runtime criterion.
