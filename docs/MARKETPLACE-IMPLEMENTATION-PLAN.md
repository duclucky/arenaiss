# Marketplace implementation plan

## Locked product rules

- A listing transfers ownership of one exact immutable Agent version, not a mutable profile or a universal score.
- The platform fee is fixed at `100` basis points (`1%`) in the Arc contract and cannot be changed per listing.
- Eligibility is fail-closed and bound to the Agent ID, version, AGENTS.md commitment, Test Pack/version, rubric, Studio Next judge and finalized run evidence.
- The private `AGENTS.md` plaintext stays offchain and is released to the buyer only after canonical Arc ownership readback.
- MVP trust boundary: Arena's configured operator verifies GenLayer evidence and authorizes an eligibility digest on Arc. Arc does not independently verify GenLayer finality.

## Evo eligibility policy v1

A version is eligible only when all conditions hold:

1. at least 6 distinct scenarios and at least 2 finalized runs per scenario;
2. 100% required-run coverage;
3. mean overall score at least 80;
4. mean instruction adherence, rule compliance, task completion and safety each at least 80;
5. every other applicable dimension at least 60;
6. overall-score spread is at most 20;
7. no critical deterministic policy finding; and
8. every run has the exact Agent/version/commitment, Test Pack/version, rubric and judge bindings.

## Ordered phases

- `MKT-0` (this change): freeze policy, authority, state machine and 1% accounting.
- `MKT-1` (this change): deterministic eligibility aggregation and boundary tests.
- `MKT-2` (this change): Arc AgentRegistryV2 and Marketplace contracts with unit tests.
- `MKT-3` (this change): persistent API projection, strict Arc reconciliation, operator authorization and buyer-isolated delivery.
- `MKT-4` (this change): Marketplace browser experience and Circle SCA buy/list flows.
- `MKT-5`: authorized Studio Next/Arc Testnet deployment and bounded lifecycle evidence.

`MKT-3` cannot treat a backend row as an onchain listing. `MKT-4` cannot release private content before the Arc owner changes. `MKT-5` requires fresh action-time authorization for signing and deployment.

## Contract state and value rules

- Eligibility: `UNKNOWN -> APPROVED -> CONSUMED/EXPIRED`; one approval may back one active listing and cannot be replayed after sale.
- Listing: `ACTIVE -> SOLD | CANCELLED`; expiry makes an active listing unbuyable and cancellable.
- Purchase: buyer pays exact price in ERC-20 USDC units; seller credit is `price - floor(price * 100 / 10_000)`; platform credit is the remainder.
- External token transfer and registry ownership transfer must succeed atomically or no credit/state change survives.
- Seller and platform withdraw only their own ledger credit; accounting is debited before the token call.

## Acceptance

- Threshold boundary and binding tests fail closed.
- Contract tests prove exact 1%, ownership transfer, stale version rejection, authorization, cancellation, expiry, duplicate purchase and withdrawal isolation.
- Full local check remains green before any network action.
