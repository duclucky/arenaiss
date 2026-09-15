# EVAL-6 backward-compatibility plan

- Status: `IMPLEMENTED; EXIT REGRESSION VERIFIED`
- Scope: migration of the existing trusted-operator Tournament mode onto the
  shared evaluation read model
- Non-goal: changing historical evidence, deployed contract state, Arc
  accounting, or claiming that Tournament already uses the Evaluation provider
  protocol

## Compatibility baseline

The following interfaces are frozen compatibility surfaces for `EVAL-6`:

1. `ArenaMatchJudge.submit_match(match_id, attempt_id, topic, output_a,
   output_b, output_digest_a, output_digest_b, rubric_version)` and
   `get_match_result(match_id, attempt_id)` remain readable with their existing
   `A_WIN`, `B_WIN` and `TIE` semantics.
2. Historical `api-tournaments`, `api-matches`, `api-verdicts`,
   `judge-submissions` and `inference-runs` records remain immutable. Existing
   transaction hashes, network IDs, judge addresses, canonical match IDs and
   attempt IDs are never regenerated.
3. Existing anonymous Tournament HTTP representations remain accepted by the
   frontend. Shared evaluation fields are additive projections, never required
   fields on a historical record.
4. The Arc escrow ranking input, fixed 10% fee, payout derivation, refunds,
   withdrawal credits and zero-liability closure invariants do not consume
   scorecard fields and do not change in `EVAL-6`.

## Additive migration model

`EVAL-6` introduces a specialized `ComparisonRun` projection. A historical
match remains the source record; the projection references it and cannot mutate
it.

- Projection ID is deterministically domain-separated from the original
  `matchId` and `attemptId`.
- `sourceKind=LEGACY_TOURNAMENT` records retain the original rubric and verdict
  meaning. Missing new scorecard fields are reported as unavailable, not
  fabricated or backfilled by a new model call.
- New rich Tournament attempts use a separately versioned provider envelope and
  GenLayer contract revision. They may expose dimensional comparison evidence,
  but the terminal bracket value remains only `A_WIN`, `B_WIN` or `TIE`.
- Shared readers use an adapter/dual-read path: existing records are projected
  on read; new records are written to a new namespace. There is no in-place data
  migration.
- Idempotent projection replay must return byte-equivalent public fields. A
  conflicting source binding fails closed.

## Progression eligibility

Bracket progression may consume exactly one of:

1. an existing canonical finalized `ArenaMatchJudge` verdict under the current
   historical rules; or
2. a finalized rich `ComparisonRun` whose source match/attempt, two Agent
   versions, exact scenario, response digests, rubric and GenLayer transaction
   readback all match its immutable binding.

After the EVAL-6 cutover, option 1 is historical-read compatibility only.
`ArenaMatchJudge` is not configured for new submissions; every new Tournament
attempt uses option 2 through `ArenaComparisonJudge`.

`INCOMPLETE`, `INCOMPARABLE`, `INFRASTRUCTURE_ERROR`, `UNSTABLE`, pending,
failed or conflicting records are never eligible. A scorecard cannot directly
advance a bracket or alter an Arc ranking.

## Rollout and rollback

1. Add the read-only historical adapter and characterization tests.
2. Shadow-project current fixtures and compare every legacy public field.
3. Add rich provider/contract paths behind an explicit revision/configuration
   gate; do not reinterpret an in-flight attempt.
4. Enable new attempts only after direct, integration and full-system suites
   pass. Existing attempts finish on their original revision.
5. Rollback disables creation of rich attempts. Because legacy data was never
   rewritten and Arc is unchanged, existing Tournament reads and settlement
   continue on the compatibility path.

## Audit matrix and exit evidence required in EVAL-6

| Surface | Required invariant |
| --- | --- |
| Match ABI | Existing eight arguments and historical readback remain exact |
| Stored evidence | Original transaction/network/judge/match/attempt identities remain unchanged |
| Public API | Existing Tournament, Match and Verdict payloads remain readable without new fields |
| Mapping | One source attempt maps idempotently to one specialized `ComparisonRun` |
| Progression | Only an eligible terminal A/B result advances once |
| Retry/refund | Retry exhaustion and expiry retain the existing cancellation/refund path |
| Arc | Fee, payout, credit, refund and zero-liability arithmetic remain governed by the existing contract |
| Privacy | No `AGENTS.md`, raw provider output or hidden scenario content enters the public projection |

The mandatory regression cone is `GLJ`, `COR`, `SET`, Arc, API projection and
full-system lifecycle tests plus new mapping/eligibility tests from Wave E6 in
`docs/TDD-PLAN.md`. It passed after implementation. The new rich path is
additive: legacy records remain dual-read projections, while new attempts use
`ArenaComparisonJudge` and the Evaluation provider envelope.
