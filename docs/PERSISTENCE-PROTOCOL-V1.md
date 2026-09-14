# Persistence Protocol v1

The Arena Phase 3B persistence layer implements an offline, in-memory/reference adapter for append-only storage and outbox semantics. It serves as an exact behavior specification and mock runtime before a database driver is selected.

## Intended Use

This reference adapter is completely offline. It **does not** provide database durability, scalable querying, or trustless state. Callers are responsible for cryptographic verification, wall-clock temporal boundaries, and unique ID derivation. The adapter does not generate local IDs or timestamps; everything must be provided by the protocol execution boundary.

## Records and Identifiers

All primary identifiers are `sha256:` digests. The store models the following independent entity records:

- **TournamentRecord** (`tournamentId` as primary)
  - Fields: `tournamentId`, `policy`, `state`, `createdAt`
  - Notes: State changes require a different mechanism outside the append-only table or imply that we do not change the initial state directly in this record collection.

- **EntrantRecord** (`entrantId` as primary)
  - Fields: `entrantId`, `tournamentId`, `walletAddress`, `agentId`, `agentsDigest`, `state`, `createdAt`

- **MatchRecord** (`matchId` as primary)
  - Fields: `matchId`, `tournamentId`, `stage`, `roundNumber`, `slotA`, `slotB`, `state`, `createdAt`

- **AttemptRecord** (`attemptId` as primary)
  - Fields: `attemptId`, `matchId`, `attemptNumber`, `topicDigest`, `outputADigest`, `outputBDigest`, `state`, `createdAt`

- **OutboxEvent** (`eventId` as primary, but scoped by `operationKey` for duplicate checks)
  - Fields: `eventId`, `kind`, `aggregateId`, `operationKey`, `payload`, `createdAt`

## Uniqueness Keys

The persistence layer asserts the following logical uniqueness boundaries:

- **Tournament:** `tournamentId`
- **Entrant:** `entrantId` AND `(tournamentId, walletAddress, agentId)`
- **Match:** `matchId`
- **Attempt:** `attemptId` AND `(matchId, attemptNumber)`
- **Outbox:** `operationKey`

At runtime the adapter validates every primary and digest-bearing field against
the exact `sha256:` plus 64 hexadecimal format. TypeScript's `Digest` annotation
is not treated as runtime validation. Snapshot restore applies the same digest,
primary-key, and composite-key checks atomically before committing.

## Append-Only, Idempotency, and Conflict Rules

1. **No Mutation:** Existing records cannot be updated. Any operation must be an insertion.
2. **Idempotent by Payload:** A duplicate primary ID is allowed and is a no-op (idempotent) if and only if the complete inserted record is byte-for-byte equivalent (deep equal) to the existing record.
3. **Conflict Rejection:** Any insertion with a duplicate primary ID or composite key that differs in payload from the existing record will immediately throw an error and abort the current transaction.

## Transaction Rollback Rule

Transactions (`transact(fn)`) execute a callback against a staged clone of all domain maps.
If the callback executes successfully, the staged clone is committed atomically, securing both records and outbox events.
If the callback throws an error for any reason (e.g. payload conflict, composite key violation), all changes made within the scope of the callback are discarded, and the store remains exactly as it was prior to the call.

## Snapshot Determinism

For offline recovery and verifiability, the store can emit and ingest snapshots:
- Snapshot output is JSON-safe and deterministic.
- Every collection within the snapshot is consistently sorted in ascending order by its primary ID;
  outbox records use `eventId`, while `operationKey` remains only the idempotency key.
- Restoring from a snapshot and snapshotting again yields byte-for-byte identical output.
- The snapshot mechanism enforces deep cloning so that mutable internals are never leaked.
