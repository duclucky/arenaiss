# Gate review — Tournament MVP and Evaluation Platform direction

## Decision scope

The owner approved a simpler functional MVP. This document does not pretend that
the new trust model satisfies gates written for independently authenticated
consequential evidence.

On `2026-09-14`, the owner expanded the product direction to **Arena ISS —
Intelligence, Safety & Standards**, an Agent Evaluation Platform. The table below
continues to describe only the implemented trusted-operator Tournament MVP. The
new solo/comparison/regression/sandbox/scorecard capabilities have not passed an
idea or implementation gate merely because this direction was accepted. Their
source of truth is
[`ADR-002-AGENT-EVALUATION-PLATFORM.md`](ADR-002-AGENT-EVALUATION-PLATFORM.md).

## Current result

**Product design and project-only local implementation exception approved; the
14-gate admission result remains unresolved.**

| Gate | Result for trusted MVP | Reason |
| --- | --- | --- |
| Replacement | `PASS FOR PRODUCT VALUE` | GenLayer supplies multi-validator semantic judgment, but the operator can still bypass it in progression/settlement. |
| Judgment | `PASS` | Comparing open-ended generated outputs under a qualitative rubric requires semantic judgment. |
| Evidence availability | `PASS FOR MVP INPUT` | Backend possesses prompts, topics and provider outputs and can submit them. Availability is operational, not independently guaranteed. |
| Evidence authenticity | `FAIL UNDER PARENT POLICY / ACCEPTED TRUST ASSUMPTION` | Backend-controlled outputs and ranking can affect USDC without independent issuer/proof. Hashes and tx links are audit aids only. |
| Equivalence | `PROVISIONAL PASS` | Existing semantic corpus defines bounded criteria and normalized A/B/TIE behavior; live GenLayer calibration remains. |
| Consequence | `PASS BY DESIGN` | Configured operator ranking opens deterministic Arc credits after GenLayer-guided tournament operation. |
| Adversarial | `PASS AS DISCLOSED RISK` | Entrants oppose each other and the operator can manipulate generation/progression/ranking. MVP accepts this residual trust. |
| State model | `PROVISIONAL PASS` | Revised Arc/backend/GenLayer states are explicit; exact ABI and implementation tests remain. |
| Reuse | `PROVISIONAL PASS` | Per-match semantic judge and tournament ports are reusable, subject to implementation. |
| Contract count | `PASS BY DESIGN` | GenLayer judges; Arc escrows. No ornamental settlement verifier contract in MVP. |
| Differentiation | `OWNER WAIVED / PARENT POLICY UNRESOLVED` | Product owner accepts structural overlap; parent rule still exists. |
| Claim-to-code | `OPEN` | Revised exact ABI, code, UI and evidence do not exist yet. |
| Full lifecycle | `OPEN` | No live registration, generation, verdict, settlement or withdrawal. |
| Scope honesty | `PASS` | Trusted operator and missing cross-chain proof are explicit. |

## MVP evidence authority

| Consequential fact | MVP authority | What enforces it | Residual risk |
| --- | --- | --- | --- |
| Entrant and stake | Arc | wallet transaction + escrow state | contract/USDC integration defects until tested |
| Prompt plaintext/version | backend | DB access control + commitment check | operator may substitute plaintext |
| Pairing/topic/output mapping | backend | domain rules + persistence/tests | operator may manipulate data |
| A/B semantic verdict | GenLayer | validator consensus over submitted bytes | submitted bytes may be dishonest |
| Advancement and final ranking | backend | canonical GenLayer read + bracket validation | operator may ignore read |
| Ranking accepted by Arc | configured operator | Arc authorization | no proof ranking came from GenLayer |
| Fee/credits/withdrawal | Arc | immutable BPS + accounting logic | implementation defects until proven |

## Applied project-only policy resolution

The parent authority permits this child alone to build/test an explicitly labeled
`TRUSTED_OPERATOR_DEMO`. It does not mark a gate `PASS`, alter another project,
or authorize external/network/value actions. A gate-compliant submission still
requires the applicable trust-minimized evidence or another explicit parent-level
decision.

The child repository cannot redefine the workspace-wide gate by itself.

## Seven-part fingerprint

1. Trust problem addressed in MVP: neutral semantic comparison of submitted A/B
   outputs; generation and settlement remain operator-trusted.
2. Actors: creator, entrants, platform operator, model provider, GenLayer
   validators and Arc escrow users.
3. Evidence: backend prompt/topic/output artifacts with digests and public
   GenLayer transaction references, explicitly not authenticity proofs.
4. Consensus question: which submitted output wins each locked criterion?
5. State: Arc value lifecycle, backend tournament lifecycle and GenLayer
   per-attempt verdict lifecycle.
6. Consequence: operator-submitted Top 5 opens Arc fee/winner credits.
7. Reuse: per-match judge, bracket engine, tournament orchestration and escrow.

## Future admission upgrade

`docs/ARCHITECTURE.md` names TM-1 through TM-5. Each stage can improve this gate
review only after implementation, adversarial tests and target-runtime evidence;
an old offline spike alone does not upgrade a gate.

## Evaluation Platform re-review required

Before any Evaluation Platform release or submission claim, rerun all 14 gates
against these additional consequential paths:

- authenticity and secrecy of hidden scenario fixtures;
- authenticity of tool results and observable action traces;
- separation of deterministic policy facts from GenLayer semantic judgment;
- reproducibility and equivalence of multi-dimensional scorecards;
- validity of comparison/regression across exact pack/runtime/scoring versions;
- benchmark gaming, sybil and cherry-pick resistance;
- scope and revocation of any version-bound certification; and
- Arc value consequences for optional bounty/stake campaign modes.

Until that re-review and its evidence exist, the only permitted claim is that
the Tournament MVP and current GenLayer A/B judge are a working baseline for the
broader direction—not proof that the full evaluation platform is complete,
trustless, certified or submission-ready.
