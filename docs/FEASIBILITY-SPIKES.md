# Feasibility and characterization spikes

## Evaluation Platform direction notice — 2026-09-14

This document preserves the original Tournament MVP spike questions and may
contain historical "current result" statements from before later deployments.
Use `docs/EXECUTION-STATUS.md` for current verified evidence.

Under `ADR-002-AGENT-EVALUATION-PLATFORM.md`, the next product-critical spike is
`EVAL-1`: prove that a bounded GenLayer scorecard judge can evaluate observable
reasoning quality, action selection, rule compliance, robustness and task
completion with normalized dimensions, bounded reasons, deterministic aggregate
derivation and adversarial stability. It must pass before broad Test Pack/Run UI
implementation. Existing F1 remains reusable A/B baseline evidence; it does not
prove the generalized scorecard.

## Status after MVP simplification

The trusted-operator MVP does not require independent proof of model generation
or GenLayer-to-Arc finality. Previous spikes are retained as tested design assets
for later trust-minimization. Only semantic stability, bracket/ranking and Arc
accounting remain directly relevant to the MVP implementation plan.

## MVP-critical characterization

### F1 — Semantic verdict and reasons

Question: can a GenLayer judge return stable structured criterion winners plus
bounded explanations without allowing prose to control progression or payout?

Required before GenLayer contract completion:

- clear A/B/tie/retry corpus;
- complete criterion coverage;
- deterministic aggregate derivation;
- bounded criterion reasons and summary;
- contradiction, injection and payout-instruction handling;
- direct plus real-consensus tests.

Current local result: the existing semantic corpus/normalizer is a useful base,
but it does not include a deployed GenLayer contract or live validator evidence.

### F2 — Bracket and Top 5

Question: can the backend deterministically form and complete every supported
bracket, including third and fifth place, without duplicate/missing entrants?

Required:

- entrant counts 8–32;
- preliminary matches/byes;
- append-only attempts;
- tie/retry/fallback;
- ancestry-complete Top 5;
- duplicate progression and worker races.

Current local result: offline bracket vectors pass and remain directly reusable.

### F3 — Arc accounting

Question: can Arc preserve every USDC destination while trusting only the
configured operator for ranking, never for payout amounts?

Required:

- fee exactly 1000 BPS;
- payout BPS exactly 10000 over the 90% net pool;
- deterministic remainder;
- unique registered ranked entrants;
- full refunds and zero fee on refundable cancellation;
- duplicate settlement/withdrawal protection;
- Solidity fuzz/invariant and live USDC lifecycle.

Current local result: integer accounting fixtures pass; Solidity/live evidence is
not present.

### F4 — GenLayer transaction lifecycle

Question: can the backend wait for finality, verify execution success and read
the exact canonical match result without duplicate submission/progression?

Required:

- raw and normalized receipt fixtures;
- submitted/pending/accepted/finalized/failure;
- transaction recovery after restart;
- wrong match/attempt/schema rejection;
- canonical reason/result readback;
- bounded hosted-network smoke.

Current result: not implemented.

## Post-MVP trust-minimization spikes

### TM-1 — ACI/TEE generation provenance

Existing synthetic ACI verification and generic live ACI observation are retained.
A live Arena pair runner is not required for the MVP and must not be claimed.

### TM-2 — Authenticated Arc snapshot/randomness

Existing exact-block 3-of-4 Arc RPC normalizer and bracket vectors are retained.
The latest local suite passes; no GenLayer runtime probe or deployed manager is
claimed.

### TM-3 — Threshold GenLayer finality

Existing offline `FinalizedRankingV1` 3-of-5 EIP-712 vectors are retained. No
independent operator committee or live signatures exist.

### TM-4 — Reciprocal deployment binding

Predicted Arc manager nonce and two-way source/destination binding remain a future
deployment topology, not an MVP prerequisite.

### TM-5 — Native proof path

Research remains open for a GenLayer-to-Arc bridge/light client/succinct proof.

## Exit criteria for MVP feasibility

MVP design is technically ready for production implementation only when:

1. F1–F4 have frozen interfaces and executable acceptance cases;
2. the parent workspace's project-only trusted-operator exception remains in
   force for this exact child;
3. Arc write-safety/value/temporal matrices are complete;
4. no public claim depends on TM-1…TM-5; and
5. exact toolchain versions are selected and locally reproducible.
