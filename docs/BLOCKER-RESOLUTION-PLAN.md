# Blocker and decision-resolution plan

## Purpose

The MVP no longer waits for TEE provenance or a cryptographic GenLayer-to-Arc
bridge. This file now tracks only blockers that prevent the simplified plan from
being executed honestly and in dependency order.

## B1 — Parent policy versus trusted MVP (`RESOLVED FOR LOCAL BUILD`)

### Conflict

The owner approved an operator-trusted generation/progression/settlement flow.
The parent workspace currently prohibits actor-controlled evidence from producing
monetary consequence without independent authentication.

### Applied resolution

The owner approved and the parent authority records `TRUSTED_OPERATOR_DEMO` for
`async-agent-arena` only. It permits local implementation/testing, preserves all
general value, temporal, testing, secret and network rules, and prohibits
trustless/authenticity/gate-pass claims.

### Stop boundary

Local contracts/services/frontend may proceed in plan order. External, paid,
wallet, deployment, network, publish and submission actions remain unauthorized.

## B2 — Exact MVP interfaces

### Missing information

Architecture roles are locked, but exact schemas, encodings, state enums, public
contract ABI and write-safety/value rows must be frozen before Coding Agent work.

### Resolution

Primary agent performs Phase 1 of `IMPLEMENTATION-SPEC.md`, including golden
vectors and test IDs. Coding Agent receives no design discretion.

### Acceptance

Every field has one owner and every public write has caller/state/time/
idempotency/accounting tests with no downstream dependency.

## B3 — GenLayer RC/stable tooling selection

### Current evidence

Global CLI `0.39.2` targets stable networks and does not list Studio Dev. CLI
`0.40.0-rc.3` lists `studio-dev`; `genlayer-js` has a `2.0.0-rc.1` line. Studio
Dev is resettable and uses chain ID `61997`.

### Resolution

At scaffold time, select one coherent stable family for the main MVP. Add an
isolated RC compatibility lane only if it does not alter the stable deployment
manifest. Never mix chain IDs, consensus addresses or SDK families.

### Acceptance

Pinned lockfile/runner/API family passes lint/direct/integration locally before
any authorized hosted-network smoke.

## B4 — Live external actions

### Actions requiring separate authority

- paid provider inference;
- account/wallet use;
- Arc or GenLayer deployment/write;
- USDC approval/deposit/withdrawal;
- hosting, publishing, push and submission.

### Resolution

Primary agent exhausts fixtures/local tests first, then presents exact network,
account role, amount/cost cap, commands and recovery path for action-time approval.

## Post-MVP work, not blockers

- TM-1 ACI/TEE pair runner;
- TM-2 GenLayer-authenticated Arc snapshot/randomness;
- TM-3 finality committee and permissionless delivery;
- TM-4 reciprocal deployment binding;
- TM-5 native proof/light client.

Research and passing spikes for these mechanisms are preserved, but no Coding
Agent batch may reintroduce them into the MVP unless the owner changes scope.

## Ordered next steps

1. Freeze B2 schemas/matrices.
2. Select B3 tooling during scaffold.
3. Execute local TDD Waves 1–10.
4. Request B4 action-time authorization for Wave 11 only after local green.
