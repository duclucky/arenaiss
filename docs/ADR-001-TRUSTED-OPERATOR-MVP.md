# ADR-001 — Trusted-operator MVP

## Status

- Product architecture: `ACCEPTED` by owner on `2026-09-11`
- Local implementation exception: `ACCEPTED` at parent workspace authority
- Scope: `async-agent-arena` only

## Context

The earlier design required an attested A/B runner, authenticated Arc snapshots,
an independent GenLayer finality committee and reciprocal cross-chain deployment
binding before implementing the product. Those mechanisms reduce operator trust
but make the first usable Arena substantially more complex.

The product requirement is simpler: users stake once and leave; the platform
runs prompts, submits output pairs to GenLayer, follows finalized verdicts through
the bracket, and submits Top 5 to an Arc escrow that calculates payouts.

## Decision

Build the first functional version as `TRUSTED_OPERATOR`:

- backend is trusted for prompt/model execution, bracket and final ranking;
- GenLayer is authoritative only for semantic verdicts over submitted A/B bytes;
- Arc is authoritative for USDC custody, immutable 10%/90% accounting, refunds,
  credits and withdrawals;
- configured Arc operator authorizes final ranking; and
- public UI/docs expose GenLayer transaction references for audit without calling
  them Arc-verifiable proofs.

## Accepted consequences

The operator can manipulate generation, progression or ranking. Users can detect
some divergence from public records but Arc cannot prevent it. Operator downtime
can pause the tournament or settlement.

The MVP must not claim trustless generation, permissionless progression,
cross-chain proof, or independently authenticated consequential evidence.

## Rejected MVP alternative

Do not require TM-1…TM-5 before the first functional release. Their interfaces
remain in the post-MVP roadmap so they can replace trusted authority later.

## Applied parent-policy resolution

The parent authority now records this project-scoped execution mode without
weakening the general gate:

```text
TRUSTED_OPERATOR_DEMO exception

For async-agent-arena only, after explicit owner approval, production code may be
built and tested as an honestly labeled trusted-operator demonstration even while
Evidence Authenticity remains FAIL/OPEN. This exception does not change any of
the 14 gate definitions, does not permit a SELECTED/trustless/submission claim,
and does not authorize wallets, paid calls, deployments, network writes,
publishing or financial transactions. Those actions retain separate action-time
authorization. Arc must derive payout amounts, enforce registered unique ranked
entrants, preserve refunds/credits/accounting, and reject duplicate settlement.
Every UI/README/submission-facing surface must state that the operator controls
generation, bracket progression and ranking relay. A gate-compliant submission
still requires the applicable trust-minimized evidence or a later parent-policy
decision.
```

This is the applied resolution because it allows a functional prototype
without representing it as a gate-passing decentralized protocol.

## Verification consequence

Tests must demonstrate both intended behavior and the residual trust limitation:
a configured operator can submit a valid-shape dishonest ranking and Arc cannot
compare it with GenLayer. That scenario is classified `EXPECTED_TRUST_LIMIT`,
not hidden, weakened or falsely called secure.
