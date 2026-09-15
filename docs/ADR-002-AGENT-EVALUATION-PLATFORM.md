# ADR-002 — Arena ISS becomes an Agent Evaluation Platform

- Status: `ACCEPTED BY PRODUCT OWNER`
- Decision date: `2026-09-14`
- Applies to: `async-agent-arena` only
- Supersedes: the tournament-only product positioning
- Does not supersede: `ADR-001-TRUSTED-OPERATOR-MVP.md`, deployed-contract
  evidence, network authorization boundaries, or current trust disclosures

## Decision

The product brand is **Arena ISS**, expanded as:

> **Intelligence, Safety & Standards**

Product descriptor:

> Agent Evaluation Platform

Working promise:

> Test how agents think, act, and follow rules.

`Arena` now means a controlled testing ground. An asynchronous elimination
tournament remains one supported evaluation mode, but it is no longer the whole
product.

The repository slug and existing tournament implementation remain unchanged.
Existing evidence must not be renamed or represented as evidence for evaluation
capabilities that did not exist when it was collected.

## Product thesis

Arena ISS evaluates the observable behavior of a versioned Agent configuration:

1. the quality of its reasoning artifacts and task response;
2. the quality and safety of the actions it selects;
3. its compliance with explicit rules and operating boundaries;
4. its robustness and consistency across repeated or adversarial scenarios; and
5. its task completion quality, latency, token use, and cost where measured.

The product does **not** claim access to a model's hidden chain of thought.
"Thinking quality" means the quality evidenced by observable plans, rationales,
answers, tool choices, tool arguments, state transitions, and outcomes.

## Core unit and terminology

The primary product unit changes from `Match` to `EvaluationRun`.

| Tournament MVP term | Platform term |
| --- | --- |
| Tournament | `EvaluationCampaign` with mode `TOURNAMENT` |
| Topic | `TestScenario` task/input |
| Match attempt | `EvaluationRun` or `ComparisonRun` |
| A/B result | one part of a multi-dimensional `Scorecard` |
| Winner ranking | optional benchmark leaderboard |
| Prize pool | optional bounty/prize policy |

Existing tournament names remain valid inside the `TOURNAMENT` module and its
historical evidence. New shared APIs must use the platform terms above.

## Evaluation modes

The target product supports these modes in dependency order:

1. `SOLO`: evaluate one Agent version against one or more scenarios.
2. `VERSION_COMPARISON`: compare two versions of the same Agent.
3. `PAIRWISE`: compare two different Agents under the same locked scenario.
4. `REGRESSION`: fail a release when a candidate version violates a locked
   threshold or loses a protected capability.
5. `TOURNAMENT`: reuse the current asynchronous bracket as an optional campaign.
6. `ADVERSARIAL`: run prompt-injection, policy-conflict and unsafe-action packs.

The current implementation proves only the `TOURNAMENT`/pairwise baseline and
must not be described as implementing all modes.

## Canonical evaluation objects

### AgentVersion

- immutable Agent/version identifiers;
- `AGENTS.md` commitment and protected plaintext in the trusted backend;
- optional future portable `SKILL.md` artifacts, each separately versioned;
- declared model/runtime compatibility; and
- no wallet secret, API key, session credential, or private tool credential.

`AGENTS.md` remains the only active profile artifact until a separate `SKILL.md`
protocol, storage boundary, limits, and tests are accepted.

### AgentIdentity on Arc

Each active Agent has one Arc `AgentRegistry` record binding its canonical
`agentId`, current `agentsVersion`, commitment and owner wallet. Registration is
a real Arc transaction sent by the user's Circle-managed wallet before the
backend makes the Agent visible. The registry never receives `AGENTS.md`
plaintext. "Delete" is an owner-only onchain deactivation: history remains
immutable and the backend removes the Agent from active listings only after the
deactivation transaction has a hash.

### TestPack

A versioned collection of `TestScenario` records for one declared purpose, such
as coding, research, customer support, browser automation, trading simulation,
payments, or policy compliance.

### TestScenario

Each scenario locks:

- objective and input context;
- public and hidden fixtures;
- an inert catalog of available action proposals;
- required and forbidden actions;
- confirmation and escalation rules;
- proposal-policy conditions and deterministic assertions;
- semantic rubric and scoring version;
- time, token, output, tool-call, and cost budgets; and
- repetition/adversarial policy where applicable.

Hidden fixtures are service-confidential test data, never Agent instructions.

### EvaluationRun

One immutable execution of one `AgentVersion` against one `TestScenario` and one
locked runtime policy. A Level 1/2 run records request/output digests, observable
rationale, action proposals, deterministic findings, provider status, GenLayer
reference, scorecard, timings, token usage, cost data when supplied, and terminal
failure classification. Executed tool calls/results belong only to the future
Level 3 sandbox protocol.

An empty model response, provider timeout, tool failure, policy violation, judge failure,
and failed assertion are distinct states. They must never collapse into one
generic zero score.

### Scorecard

The minimum scorecard dimensions are:

- `reasoning_quality`;
- `action_selection`;
- `rule_compliance`;
- `robustness`;
- `task_completion`;
- `efficiency` when authoritative usage data exists; and
- `overall`, derived only from the locked scoring policy.

Every dimension includes status, bounded score where meaningful, reason code,
and evidence references. `PASS`, `FAIL`, `RETRYABLE`, `UNVERIFIABLE`, and
`INFRASTRUCTURE_ERROR` remain distinct terminal meanings.

## Authority split

Arena ISS uses a hybrid evaluator:

### Deterministic policy engine

Contract/service code, not an LLM, checks objective facts such as:

- a forbidden or unknown action was proposed;
- a confirmation-gated action was proposed without requesting confirmation;
- proposal arguments or count violated policy;
- an output/schema/budget bound was violated;
- expected IDs or scenario entities are missing, extra, or duplicated; and
- expected IDs or scenario entities are missing, extra, or duplicated.

These checks are guardrails and evidence, not the Level 2 evaluator. GenLayer
remains authoritative for the qualitative score, result class and reasons.
Executed calls, ordering, state mutation and fixture postconditions are deferred
to Level 3.

### GenLayer semantic judge

GenLayer validators evaluate meaning that deterministic code cannot reliably
derive, including relevance, reasoning quality, quality of action choice,
instruction understanding, internal consistency of rationale and action, and
quality of task completion over the exact submitted evidence.

The current `ArenaMatchJudge` remains valid for bounded A/B tournament judgments.
A generalized scorecard contract/revision must pass a dedicated feasibility and
adversarial phase before the broader platform or UI depends on it. GenLayer
reasons are explanatory; deterministic code validates score ranges, required
dimensions, entity coverage, aggregate derivation, and consequence eligibility.

### Arc

Arc remains the authority for USDC custody and accounting only when a campaign
has a bounty, entry stake, reward, refund, or platform fee. A solo, regression,
or internal benchmark does not require an Arc transaction merely to exist.

### Trusted backend

Until a future trust-minimization stage is implemented, the backend remains
trusted for Agent plaintext, scenario secrecy, provider execution,
artifact-to-run mapping, campaign progression, and submission of evidence to
GenLayer. Future Level 3 sandbox events would also be backend-controlled. Digests
and transaction links improve auditability but do not prove authenticated
execution provenance.

## Product surfaces

The target information architecture adds:

- `Test Packs`: create, version, inspect and run scenario collections;
- `Evaluations`: configure and start solo/comparison/regression campaigns;
- `Runs`: inspect input bindings, provider state, tool trace, deterministic
  findings, GenLayer finality, reasons and scorecard;
- `Compare`: compare Agent versions and identify regressions by dimension;
- `Reports`: share a version-bound, evidence-linked evaluation report;
- `Benchmarks`: leaderboard scoped to one Test Pack and scoring version; and
- `Tournaments`: retain the existing prize/bracket experience as one mode.

There is no universal Agent score across unrelated packs. Every displayed score
must name its Test Pack version, runtime policy, scoring version, run count, and
evidence/finality state.

## Ordered implementation direction

Work after the current Tournament MVP proceeds in this order:

1. `EVAL-0`: freeze evaluation terminology, schemas, failure states, authority
   matrix, scorecard invariants and golden vectors.
2. `EVAL-1`: build and adversarially test a bounded GenLayer scorecard-judge
   prototype. This is the feasibility gate; do not build broad platform UI first.
3. `EVAL-2`: implement deterministic policy assertions over inert Level 2 action
   proposals; GenLayer remains the qualitative evaluator.
4. `EVAL-3`: implement immutable `TestPack`, `TestScenario`, `EvaluationRun`,
   trace and scorecard persistence.
5. `EVAL-4`: implement the `SOLO` lifecycle and run-detail report.
6. `EVAL-5`: add version comparison and regression thresholds.
7. `EVAL-6`: adapt pairwise and tournament flows onto the shared evaluation
   model without rewriting historical tournament records.
8. `EVAL-7`: add benchmark/report surfaces and optional Arc bounty economics.
9. Level 3 executable tool sandbox is a separate compute-dependent roadmap item,
   not a prerequisite for Level 1/2 or `SOLO`.
10. After `EVAL-7`, activate only the applicable `TM-*` stages to harden
   authenticity, hidden-test custody, sybil resistance and trust-minimized
   execution after their own evidence gates pass.

Every step consumes only interfaces frozen by an earlier step. `EVAL-2` and
`EVAL-3` may be developed in parallel only after `EVAL-0`; neither may claim
semantic evaluation readiness before `EVAL-1` passes.

## Non-goals for the first evaluation increment

- supporting every Agent framework-specific Markdown file;
- extracting or storing hidden chain of thought;
- executing arbitrary user-provided code or unrestricted tools;
- claiming certification from one run;
- producing a global score independent of Test Pack/runtime versions;
- moving money based only on unvalidated LLM prose; or
- replacing the current tournament contracts or historical evidence in place.

## Consequences

- The name and existing domain remain usable.
- Tournament code becomes a reusable campaign mode rather than discarded work.
- The next high-risk feasibility task is the GenLayer scorecard judge, not a
  large frontend expansion.
- New Level 2 tests must cover observable action proposals and deterministic
  policy facts, not only final text output. Executed action traces belong to the
  future Level 3 sandbox.
- Product and submission claims must clearly separate implemented Tournament MVP
  evidence from planned Evaluation Platform capabilities.
