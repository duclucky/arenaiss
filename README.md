# Arena ISS — Agent Evaluation Platform

**ISS means Intelligence, Safety & Standards.** Arena ISS is becoming a
controlled platform for testing how versioned Agents reason through tasks,
choose actions, and follow rules. The existing asynchronous elimination
tournament remains the first implemented evaluation mode: GenLayer judges the
submitted output pairs and Arc holds the optional USDC prize pool.

The direction lock and the boundary between implemented behavior and planned
evaluation capabilities are defined in
[`docs/ADR-002-AGENT-EVALUATION-PLATFORM.md`](docs/ADR-002-AGENT-EVALUATION-PLATFORM.md).

## Status

**TRUSTED-OPERATOR MVP — LOCAL IMPLEMENTATION AUTHORIZED FOR THIS PROJECT ONLY.**

The complete application lifecycle is still the Tournament MVP. A bounded
Evaluation feasibility slice is now implemented separately: the provider
envelope makes one immutable `AGENTS.md` materially control Level 1 responses
and Level 2 inert action proposals, deterministic code derives objective action
policy findings, and `AgentEvaluationJudge` stores a six-dimension GenLayer
scorecard with reasons. The first local multi-scenario `SOLO` runner and
redacted/private Run Detail APIs are now implemented. `SOLO` creation UI,
version comparison, regression testing, executable tool sandbox traces and
full Test Pack management remain planned.
The local `EvaluationRun` core now durably records exact Agent/scenario/provider
bindings, separates provider failure classes, submits the V5 evaluation ABI,
tracks GenLayer finality, and accepts a scorecard only after canonical readback
validation. The `SOLO` runner now binds a new run ID per scenario/attempt,
resumes provider and GenLayer state after restart, and never executes proposed
actions. This path has not been used for a new paid call or network transaction.

The product owner approved the simplified MVP architecture on `2026-09-11`:

- the platform backend stores contestant `AGENTS.md` plaintext, forms the bracket, selects
  topics from the locked tournament policy, calls one configured model for both
  sides, maps outputs back to agents, and advances the tournament;
- a GenLayer Intelligent Contract judges each submitted output pair and stores a
  canonical per-match verdict plus bounded reasons;
- an Arc Solidity escrow holds entrant USDC and trusts one configured tournament
  operator to submit the final ranking;
- Arc derives the fixed 10% platform fee and winner credits itself; the operator
  cannot supply arbitrary payout amounts; and
- TEE/ACI provenance, GenLayer-to-Arc threshold proofs, reciprocal deployment
  binding, and permissionless settlement are post-MVP trust-minimization work.

This is an intentionally disclosed trust model. The backend can still substitute
`AGENTS.md` content, outputs, model settings, bracket data, or the final ranking. GenLayer
proves only the semantic verdict over the exact A/B artifacts submitted to it;
Arc does not cryptographically prove that the operator-submitted ranking came
from GenLayer in the MVP.

Existing offline provenance, Arc-source, finality, semantic, randomness, and
accounting spikes remain useful future-hardening evidence. They are not MVP
admission prerequisites.

The project-specific exception permits local contracts, services, frontend,
tests, and reviewed dependencies. It does not mark mandatory gates passed or
authorize future wallets, paid calls, deployments, network writes, publishing
or submission without a separate action-time instruction. The owner explicitly
authorized the bounded GenLayer deployment and tests recorded below.

## MVP flow

```text
player registers agent + deposits USDC on Arc
                    |
                    v
backend locks roster, creates bracket and match topics
                    |
                    v
backend calls the same configured model for A and B
                    |
                    v
GenLayer MatchJudge adjudicates submitted outputs
                    |
                    v
backend waits for finalization, reads verdict, advances winner
                    |
                    v
backend submits final top-five ranking to Arc
                    |
                    v
Arc calculates 10% fee + 90% winner credits
                    |
                    v
relayer pays each winner + owner fee; pull withdrawal remains fallback
```

Players do not need to return at tournament start, approve each match, operate
tools, or keep a local agent process online. The platform pays model API and
GenLayer transaction costs from its operations treasury.

## Product direction

The platform-level core unit is an `EvaluationRun`, which binds one immutable
Agent version, one versioned Test Scenario, one runtime policy, observable output
and action evidence, deterministic rule findings, and a GenLayer semantic
scorecard. Tournament matches will later be adapted onto that shared model.

Deterministic code owns objective checks such as forbidden tool calls, required
confirmation, budgets and fixture postconditions. GenLayer owns qualitative
judgment over the exact submitted evidence. Arc participates only in campaigns
with USDC stake, bounty, fee, refund or reward accounting.

## Canonical documents

- [`docs/ADR-002-AGENT-EVALUATION-PLATFORM.md`](docs/ADR-002-AGENT-EVALUATION-PLATFORM.md)
  — accepted product direction, terminology, evaluation model and ordered expansion.
- [`docs/CONCEPT.md`](docs/CONCEPT.md) — locked MVP product behavior.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — trusted-operator boundaries
  and the post-MVP trust-minimized roadmap.
- [`docs/IMPLEMENTATION-SPEC.md`](docs/IMPLEMENTATION-SPEC.md) — dependency-
  ordered implementation phases.
- [`docs/TDD-PLAN.md`](docs/TDD-PLAN.md) — test-first waves and regression rules.
- [`docs/EXECUTION-STATUS.md`](docs/EXECUTION-STATUS.md) — current verified
  implementation status and next action.
- [`docs/EXECUTION-OWNERSHIP-PLAN.md`](docs/EXECUTION-OWNERSHIP-PLAN.md) — work
  split between the primary agent and the owner-operated Coding Agent.
- [`docs/GATE-REVIEW.md`](docs/GATE-REVIEW.md) — honest parent-policy and
  submission implications of the trusted MVP.
- [`docs/ADR-001-TRUSTED-OPERATOR-MVP.md`](docs/ADR-001-TRUSTED-OPERATOR-MVP.md)
  — approved product decision and exact proposed project-scoped policy exception.
- [`docs/TRUST-BLOCKER-RESOLUTION.md`](docs/TRUST-BLOCKER-RESOLUTION.md) —
  retained post-MVP trust-minimization research, not the MVP critical path.

## Network direction

The intended MVP uses Arc Testnet for escrow and a GenLayer hosted development
network for the judge. Stable historical lifecycle evidence remains on
Studionet. Studio Next `v0.123.0-rc.6` (`61997`) is now the release-candidate
target for continued compatibility work, but it may reset and is not durable
deployment evidence. Every network write still requires explicit action-time
authorization.

The active Studio Next preview deployments are `ArenaMatchJudge`
`GeneralResponseV7` at
[`0xbd55...B679`](https://explorer-studio-dev.genlayer.com/address/0xbd5592dc0A45B78614cd5d1c2f29F6F35dabB679)
and `AgentEvaluationJudge` `AgentEvaluationV5` at
[`0x0aA2...934d`](https://explorer-studio-dev.genlayer.com/address/0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d).
Both deployments finalized with exact source readback and successful semantic
smoke transactions after migrating the custom validator call to GenVM v0.3's
`gl.vm.run_nondet` API. Sanitized evidence is in
[`docs/evidence/studio-dev/redeployment-2026-09-14.json`](docs/evidence/studio-dev/redeployment-2026-09-14.json).
Canonical Studio Next endpoint and source/schema alias verification is in
[`docs/evidence/studio-next/verification-2026-09-14.json`](docs/evidence/studio-next/verification-2026-09-14.json).

The active judge deployment is revision V10 of `ArenaMatchJudge`, using
the `GeneralResponseV7` rubric, at
[`0x09Ba...b130`](https://explorer-studio.genlayer.com/address/0x09Ba3CE193E477a66Fdaf556bA63519A767eb130)
on Studionet (`61999`). The active Arc Testnet escrow is verified V2 at
[`0xc908...702B`](https://testnet.arcscan.app/address/0xc908a4BFb6E94dDD3F32C34d9bfEBf774E3b702B?tab=contract).
See
[`docs/GENLAYER-JUDGE-FEASIBILITY.md`](docs/GENLAYER-JUDGE-FEASIBILITY.md) and
the [`32-case adversarial report`](docs/GENLAYER-ADVERSARIAL-EVAL-REPORT.md).

The independent evaluation feasibility contract is `AgentEvaluationJudge`
revision V5 at
[`0x7f9f...64BD`](https://explorer-studio.genlayer.com/address/0x7f9f5D4798e2A69576B5E1a5113849E2c4bF64BD).
Four bounded Studionet cases across `RESPONSE` and `ACTION_DECISION` finalized
with canonical scorecards and reasons. It evaluates action proposals only and
cannot execute tools, advance a bracket, or move USDC.

## Scope boundary

A bounded trusted-operator testnet lifecycle, paid model calls, GenLayer
verdicts, Arc USDC settlement/refund, and the prompt-envelope evaluation are
recorded under `docs/evidence/`. They are testnet feasibility evidence, not a
hosted production Arena, permissionless operation, or trustless cross-chain
proof. No public release or mainnet lifecycle is claimed.
