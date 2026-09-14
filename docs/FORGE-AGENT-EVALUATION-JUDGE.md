# Forge record — Agent Evaluation Judge

## Decision reality

The product decision is not “which answer sounds nicer?” It is whether one
versioned Agent profile produces observable behavior that follows its own rules,
solves a controlled task, chooses an appropriate action boundary, and avoids
unsafe or unauthorized behavior. Tournament comparison and independent quality
evaluation are different mechanisms, so they remain separate contracts.

## Trust counterfactual

Without GenLayer, the platform operator could invent a score and reason. With
`AgentEvaluationJudge`, validators semantically inspect the exact submitted
`AGENTS.md`, scenario and provider response. They independently audit each grade
against explicit anchors, permit only one adjacent-tier difference, require
exact critical `FAIL`/`NOT_APPLICABLE` boundaries, and reject unsupported
reasons. The operator still controls artifact selection in this trusted-operator
MVP; the contract does not authenticate provider origin and makes no
trustless-generation claim.

## Mechanism choice

Rejected alternatives:

1. Reuse `ArenaMatchJudge` for every solo run: pairwise winners do not provide a
   stable per-dimension scorecard and would entangle Tournament compatibility.
2. One contract per topic: topic-specific deployments fragment rubric versions
   and make cross-topic reports hard to compare. A versioned scenario plus one
   bounded general rubric is sufficient.
3. Let an LLM execute tools: this confuses decision evaluation with side effects
   and makes fixture replay impossible.

Chosen mechanism: one reusable solo-evaluation contract, one locked rubric
version, deterministic action-policy facts, semantic dimension grading, and
public result reads. Topics vary through versioned scenarios; a new contract is
needed only for a breaking rubric/storage/security change, not for each topic.

## Consequence and value

The only consequence is a stored evaluation result (`STRONG`, `PASS`, `WEAK`,
or `FAIL`) with scorecard and reasons. It cannot move Arc USDC, advance a
Tournament bracket, or execute an action. Future consumers must independently
decide whether a result is eligible for a report or campaign consequence.

## Adversarial surface

The local gate covers forged digests, mode/rubric mismatch, injected extra
fields, missing/duplicate score dimensions, invalid grade/reference, forged
aggregate, deterministic action-policy violations, safety override, conflicting
idempotency and validator disagreement/unsupported reasons. The locked corpus
adds hierarchy collision, ambiguity, unavailable evidence, context injection,
exact formatting, safe refusal, destructive confirmation, least privilege,
secret handling, missing payment input, invented action and unnecessary action.

## Exit rule

The bounded `EVAL-1` feasibility gate passed on revision V5: local lint/direct
tests are green and four Studionet cases across both levels finalized with valid
stored scorecards and useful reasons. This is not broad statistical validation;
larger repeat/adversarial calibration remains required before certification or
benchmark claims. Tool execution stays outside the claim until the later sandbox
phase.
