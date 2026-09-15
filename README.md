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
redacted/private Run Detail APIs are now implemented. A local owner-only EVAL-5
API compares repeated SOLO cohorts for two versions of the same Agent and
applies locked deterministic regression thresholds. Tournament convergence is
now implemented additively: new attempts use the Evaluation provider envelope
and a specialized rich `ComparisonRun`, while historical Tournament records
retain their original verdict and transaction semantics. `SOLO` creation UI,
comparison UI, executable tool sandbox traces and full Test Pack management
remain planned.
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

The Account page includes a Tournament credits tab. It lists the connected
wallet's confirmed Arc tournament registrations and exposes a Claim button only
for a positive pull credit left behind by automatic payout.

A local, opt-in server integration now accepts wallet-signature or email-OTP
login and provisions one Circle developer-controlled `ARC-TESTNET` EOA for the
resulting Arena user. It is disabled until all server-only Circle and SMTP
settings are present; no Circle wallet was created during implementation. The
custody boundary, API, secret handling and the still-open transaction migration
are documented in
[`docs/CIRCLE-MANAGED-IDENTITY.md`](docs/CIRCLE-MANAGED-IDENTITY.md).

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
- [`docs/CIRCLE-MANAGED-IDENTITY.md`](docs/CIRCLE-MANAGED-IDENTITY.md) —
  wallet/email authentication and Circle developer-controlled wallet boundary.
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
- [`docs/EVAL-6-BACKWARD-COMPATIBILITY-PLAN.md`](docs/EVAL-6-BACKWARD-COMPATIBILITY-PLAN.md)
  — audited additive/no-rewrite migration constraints for Tournament convergence.
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

The active Studio Next preview deployments are `AgentEvaluationJudge`
`AgentEvaluationV5` at
[`0x0aA2...934d`](https://explorer-studio-dev.genlayer.com/address/0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d)
and the EVAL-6 comparison judge `ArenaComparisonJudge`
(`AgentComparisonV1`) at
[`0xe521...74BcB`](https://explorer-studio-dev.genlayer.com/address/0xe5210eCCC4182090A1416f515Dc7001B27274BcB).
Their deployment and semantic smoke evidence finalized successfully with exact
source readback. The former Studio Next `ArenaMatchJudge` at `0xbd55...B679`
is archived: it remains on-chain and in immutable historical evidence, but is
no longer part of runtime configuration, deployment verification or new writes.
The comparison deployment and final-address deterministic smoke both finalized
successfully with exact source and canonical readback evidence in
[`docs/evidence/studio-next/arena-comparison-deployment-2026-09-16.json`](docs/evidence/studio-next/arena-comparison-deployment-2026-09-16.json).

The historical Studionet judge deployment is revision V10 of `ArenaMatchJudge`, using
the `GeneralResponseV7` rubric, at
[`0x09Ba...b130`](https://explorer-studio.genlayer.com/address/0x09Ba3CE193E477a66Fdaf556bA63519A767eb130)
on Studionet (`61999`). It is retained for historical readback only and receives
no new writes. The active Arc Testnet escrow is verified V2 at
[`0xc908...702B`](https://testnet.arcscan.app/address/0xc908a4BFb6E94dDD3F32C34d9bfEBf774E3b702B?tab=contract).
The active Arc Testnet `AgentRegistry` is exact-match verified at
[`0x4c0b...9E25`](https://testnet.arcscan.app/address/0x4c0b1787Ae48bE1A34E7dE7e767BA25016609E25?tab=contract).
The additive Marketplace registry V2 is deployed at
[`0xc427...Eada`](https://testnet.arcscan.app/address/0xc427dBf5Dc0b58245Ac94d6634856Dd472bdEada?tab=contract), and the unaudited
Marketplace contract with a fixed 1% fee is deployed at
[`0x48c1...a2Df`](https://testnet.arcscan.app/address/0x48c15e258D9b87933B823c91Ace6EBC209Fba2Df?tab=contract). These contracts have
configuration/readback evidence only; no live listing or purchase is claimed.
The unaudited Arc Testnet Evo fee escrow is deployed at
[`0xa769...98E9`](https://testnet.arcscan.app/address/0xa7693481E17736F1617b3a6dc199aA31D86398E9?tab=contract).
It holds the fixed 1 USDC fee until the campaign finalizes, refunds infrastructure
failures through the operator, and lets the payer claim a timeout refund after
24 hours. A legacy 1 USDC direct fee for the failed live Evo campaign was
returned to its originating managed wallet in
[`0xda13...3563`](https://testnet.arcscan.app/tx/0xda138915cd5eddbfec8f3842805e5e87ebb44eb71ec6c9ebda504d435c6a3563).
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
