# Pair match escrow — local Arc Testnet design

## Scope and authority

This is an `EVAL-7` value-bearing slice for one independent two-Agent room. `PairMatchEscrow` was deployed on Arc Testnet at [`0xD7CB...c6c1`](https://testnet.arcscan.app/address/0xD7CB8dE4cED8F988152CDc51EBCf7a17c602c6c1), with [receipt and readback evidence](evidence/arc-testnet/pair-match-escrow-deployment-2026-09-17.json). It has **not** been audited or exercised with two live deposits. `ARENA_PAIR_ROOMS_ENABLED=1` and `ARC_PAIR_ESCROW_ADDRESS` are both required before the API exposes deposits; the API also reads Arc chain ID, deployed code, USDC and operator immutables before each write. A pair settlement worker is implemented locally and is available only when the provider, finalized GenLayer comparison judge, operator signer, and managed identity configuration are present. Live pair lifecycle evidence remains open.

The backend owns Agent version selection, the room record, and the mapping from two deposit transactions to one room. Arc owns USDC custody, enrollment, credit and withdrawal. A configured operator can submit a winner and nonzero verdict digest; Arc does **not** verify a GenLayer result. The future operator worker must derive that winner from a finalized, canonically read GenLayer comparison rather than from an HTTP request. This is the existing trusted-operator boundary, not an authenticity upgrade.

## Frozen economics and identifiers

- Network: Arc Testnet chain `5042002`. Deposits use Circle's ERC-20 USDC at `0x3600000000000000000000000000000000000000` in **six-decimal base units**. Native gas uses its separate 18-decimal view of the same USDC and is never added to the stake balance.
- Stake: creator chooses `1` through `999999999999` ERC-20 base units; challenger deposits exactly the same amount. The contract rejects zero stake and an underfunded or unapproved wallet before room state is created or joined. Circle approval and escrow deposit are separate completed transactions; approval alone never makes a room visible as `OPEN`.
- Room ID: SHA-256 UTF-8 digest of `arena-pair-room-v1|5042002|<lowercase escrow address>|<creator principal>|<lowercase UUIDv4 idempotency key>`. The API persists the intent and both Circle operation keys before its first write.
- Join deadline: 24 hours after API intent creation. Resolution deadline: 7 days after intent creation. Arc rejects joins at/after the join deadline and settlement at/after the resolution deadline.
- Winner credit: exactly `2 × stake`, with **zero platform fee**. The caller cannot provide a payout amount or redirect its beneficiary. The winner pulls the credit to the wallet enrolled in the room. A failed transfer leaves the credit and liability intact.
- Cancellation: the creator may cancel an `OPEN` room and recover the full stake. Once joined, both players must request early cancellation. Anyone may open refunds for an unjoined room after the join deadline or a joined room after the resolution deadline. Each depositor gets exactly their stake back. The API attempts an immediate creator withdrawal after an unjoined cancellation; the pull claim remains available if that delivery fails.

## Value and time boundaries

| Arc state | Locked USDC | Credit destination | Permitted transition |
| --- | ---: | --- | --- |
| `OPEN` | 1 stake | none | join, creator cancel, or join-deadline expiry |
| `JOINED` | 2 stakes | none | operator settle before resolution deadline, mutual cancel, or resolution-deadline expiry |
| `SETTLED` | 2 stakes until withdrawn | enrolled winner: 2 stakes | winner withdraws once |
| `REFUNDABLE` | accepted stakes until withdrawn | each enrolled depositor: their stake | each withdraws once |

Across all rooms, `totalLiability` increases only on accepted deposits and decreases only after a successful withdrawal. A rejected deposit, duplicate room/join, failed transfer, expired join, unauthorized cancel or settlement must leave locked funds and credits unchanged. Unsolicited direct token transfers are not treated as room stake.

## Write safety cards

| Method | Caller and precondition | Idempotency and failure result |
| --- | --- | --- |
| `createRoom` | Any funded creator; unused nonzero ID/version; valid stake and deadlines | One room ID; transfer failure reverts the entire creation |
| `joinRoom` | Different funded wallet, distinct nonzero version, `OPEN`, before join deadline | One challenger; exact equal stake; failed transfer leaves `OPEN` |
| `cancelRoom` | Creator only while `OPEN` | Opens one full creator credit; duplicate reverts |
| `requestCancel` | Either enrolled player while `JOINED` | Records each request once in state; second request opens both full credits |
| `expireRoom` | Anyone after applicable deadline | Opens refund credits once; early/duplicate call reverts |
| `settle` | Immutable operator while `JOINED` and before resolution deadline; winner is an enrolled wallet; nonzero verdict digest | Credits exactly two stakes once; duplicate or arbitrary winner reverts |
| `withdraw` | Credit beneficiary with positive credit | Zeroes credit before token transfer; failed transfer reverts all changes; duplicate reverts |

## Backend recovery and remaining gate

The durable `pair-rooms-v1` record keeps creator and challenger principals, their Circle-managed Arc wallets, immutable Agent IDs and versions, stake, deadlines, `createTx` and `joinTx`. `PENDING` creation is hidden until Arc readback matches the expected creator, version, stake and deadlines. `JOINING` records the challenger and stable Circle idempotency keys before the external call; the returned transaction hash is persisted **before** Arc readback. A transient read failure can therefore be retried without losing the second transaction link. A different challenger cannot replace a pending join. An ambiguous Circle response remains pending for reconciliation; it is not declared deposited or refunded from an API error alone.

The pair-specific worker reuses the Evaluation provider envelope and rich GenLayer ComparisonRun tracker. It binds both exact Agent versions and a fixed common scenario to the room, accepts only a canonical finalized `A_WIN` or `B_WIN`, persists one settlement intent, and reads Arc settlement back. Ties and exhausted provider retries leave funds available for deadline refunds; the worker also opens overdue refunds. The page and API never accept a client-supplied winner. Local tests cover the worker's binding, settlement, retry budget, tie and timeout behavior. A live two-wallet deposit → verdict → settlement → withdrawal journey remains unverified. Deployment and this website release were authorized on 2026-09-17; future funding or participant transactions need their own authorization.
