# Execution ownership and coding-agent handoff plan

## Current product authority

Product direction is locked by `ADR-002-AGENT-EVALUATION-PLATFORM.md`: Arena ISS
means Intelligence, Safety & Standards and the existing Tournament MVP is one
evaluation mode. For `EVAL-*` work, the primary agent must freeze terminology,
authority, scorecard invariants, fixtures and test expectations before any
Coding Agent packet. The Coding Agent must never infer a universal Agent score,
hidden-chain-of-thought requirement, sandbox authority or GenLayer/Arc
consequence from the high-level direction.

## Delivery model

Work uses a strict prepare → implement → audit loop:

```text
Owner decision when required
        |
        v
Primary agent: research + design + exact implementation/test packet
        |
        v
Coding Agent: mechanically execute one bounded TDD packet
        |
        v
new ignored result file in .handoffs/results/
        |
        v
Primary agent: inspect diff + independently rerun + adversarial audit
        |
        +---- REWORK ----> corrected task packet
        |
        +---- ACCEPTED --> next dependency-ordered batch
```

The Coding Agent in this document is an external coding agent selected by the
owner. It is not a subagent spawned by the primary agent. Task prompts are kept
under ignored `.handoffs/` and are never public repository artifacts.

## Role ownership

### Primary agent must do

- read and enforce parent/child instructions and applicable skills;
- research blockers from current official documentation and pinned official
  source before choosing a design;
- own product decisions, trust boundaries, Evidence Authority Matrix,
  value-destination matrix, temporal rules, write-safety cards, schemas, ports,
  and acceptance criteria;
- make a recommendation and ask the owner only for material choices or new
  authority;
- prepare one self-contained Coding Agent prompt per batch;
- design every test case, fixture mutation, public/private symbol, error code,
  algorithm step, allowed file, and exact command before handoff;
- inspect the complete returned diff and reject scope creep or hidden authority;
- independently run focused tests, regression cone, lint/build/type checks,
  secret/hygiene scans, and network/state reads needed for the acceptance claim;
- perform or supervise secret-bearing, signing, paid provider, deployment,
  funding, transfer, withdrawal, publishing, and submission actions only after
  explicit action-time authorization;
- update canonical status/evidence only after verification;
- when the owner says a run is complete, discover and read the newest result
  file under `.handoffs/results/` directly instead of asking the owner to paste
  its contents; and
- decide `ACCEPTED`, `REWORK`, or `REDESIGN` for each batch.

The primary agent does not ask the Coding Agent to resolve ambiguous product
policy. It resolves or escalates that ambiguity first.

### Coding Agent may do

- implement only the exact files, symbols, behavior, tests, and commands named in
  the active handoff prompt;
- execute the supplied RED → GREEN → REFACTOR sequence and report the observed
  output without interpreting product meaning;
- add/update only the tests whose names, mutations, expected errors, and
  assertions are already specified by the primary agent;
- use released dependencies only when the batch explicitly authorizes a pinned
  manifest change;
- update implementation-facing documentation named in the prompt;
- run all non-secret local commands in the required regression cone; and
- write changed-file list, RED evidence, GREEN evidence, remaining risks, and
  any instruction/file mismatch into the exact new result file assigned by the
  task packet, without proposing an architectural deviation;
- create one different result file per run and never overwrite/reuse an earlier
  result; and
- after the result file is written, reply only with `DONE: <result-path>` or
  `BLOCKED: <result-path>`.

### Coding Agent must not do

- change gate policy, architecture authority, payout math, schemas, public ABI,
  network, trust claims, or phase order unless the task packet explicitly freezes
  that change;
- mark a gate/evidence item passed from mocked or local results;
- read/print/copy `.env`, private keys, wallets, tokens, credentials, or full
  sensitive receipts;
- deploy, sign, fund, transfer, accept terms, publish, push, host, or submit;
- edit `.tools/`, parent knowledge files, `AGENTS.md`, or ignored handoff files,
  except creating the one exact result file assigned by the active packet;
- hide failures with skipped tests, weak assertions, retries, or unrequested
  refactors; or
- proceed across an unmet prerequisite.

The Coding Agent is not asked to research alternatives, plan work, infer missing
requirements, choose libraries, invent interfaces, improve architecture, or
decide whether a test is sufficient. If an exact instruction cannot be
executed, it reports the command/file/error and stops that batch.

Every task packet assigns a unique path of the form
`.handoffs/results/<sequence>-<batch>-RESULT.md`. The Coding Agent may create
that file only; it may not inspect, edit, delete, or overwrite another task or
result file. Result files are local audit transport and must remain Git-ignored.

## Batch plan

| Batch | Prerequisite | Primary agent owns | Coding Agent deliverable | Primary audit gate |
| --- | --- | --- | --- | --- |
| `H0 Historical spikes` | Owner-approved Wave 0R | Freeze and audit bounded future-hardening prototypes | R1 ACI and R2 Arc-source local harnesses | R1 accepted; R2 packet behavior accepted with one residual helper hardening note; no live claim |
| `D1 MVP policy` | Simplified architecture approved | Apply exact project-scoped trusted-demo policy and claim boundary | None | `ACCEPTED` for local implementation in this child only; gates/external actions unchanged |
| `P1 Spec freeze` | D1 permits build | Freeze entities, ports, ABIs, states, encodings, safety/value/time matrices and exact tests | Optional mechanical consistency edits only | No TODO or downstream dependency affects implementation behavior |
| `P2 Scaffold` | P1 accepted | Select/pin tool families and public allowlist | Reproducible minimal workspace, CI/check scripts and empty shells | Clean install/check; no sample product or secrets |
| `P3 Domain` | P2 accepted | Freeze bracket/ranking algorithms and persistence invariants | Domain schemas, DB/outbox/lease and deterministic bracket engine, test first | 8–32 entrants, Top 5 ancestry, restart/race/idempotency pass |
| `P4 Arc` | P3 protocol accepted | Own operator authorization, USDC safety/value/time requirements | `TournamentEscrow` and Solidity tests | Arc derives amounts; wrong ranking/caller/state/time/duplicate preserves accounting |
| `P5 GenLayer` | P3 protocol accepted | Own rubric, normalized verdict, reasons and equivalence | Per-match `ArenaMatchJudge`, lint/direct/integration tests | Genuine semantic judgment; complete criteria; result derived; no Arc/bracket/TEE logic |
| `P6 Inference` | P3 accepted | Own provider request schema, privacy, retries and budget | Model adapter/pair state machine with fixtures | Same policy A/B; partial pair never judged; no duplicate paid call |
| `P7 GL tracker` | P5–P6 accepted | Own lifecycle/result acceptance rules | Submit/poll/read adapter and restart tests | Finality + execution + canonical IDs required; one progression effect |
| `P8 Orchestrator` | P3/P6/P7 accepted | Own job graph and failure policy | Scheduler/workers for full bracket | Players offline; races/restarts/ties/retries/expiry remain deterministic |
| `P9 Settlement` | P4/P8 accepted | Own ranking validation and Arc reconciliation | Configured-operator settlement worker | One valid ranking -> one exact Arc credit set; trust boundary labeled honestly |
| `P10 Frontend` | P4–P9 interfaces accepted | Own UX, wallet/finality/reason display and design review | Real adapters/UI/tests/build | Wallet preflight, canonical Arc reload, GenLayer links/reasons, browser CORS |
| `P11 Local E2E` | P4–P10 accepted | Freeze full scenarios and accounting oracle | System harness and fault campaigns | Happy/retry/refund/adversarial paths; zero liability |
| `P12 Network` | Local E2E accepted; action authorization | Execute/supervise deployments/writes, protect secrets and evidence | Only pre-authorized local fixes in separate packets | Exact revisions, real provider pair, GenLayer verdicts, Arc credit/withdrawal |
| `P13 Release` | Network evidence accepted | Own claim/hygiene/submission audit | Specific audited corrections only | Public history/allowlist/CI/evidence match disclosed trusted MVP |

`P4` and `P5` may be assigned independently after `P3` is accepted. The default
remains one active Coding Agent batch at a time; no downstream packet is issued
until the prior batch has an independent audit verdict.

## Handoff contract for every Coding Agent prompt

Every prompt must contain:

1. batch ID and single outcome;
2. mandatory files/instructions to read;
3. exact prerequisite and explicit stop condition;
4. allowed files and forbidden surfaces;
5. frozen interfaces/invariants that cannot be reinterpreted;
6. exact file paths, symbols/signatures, fixture edits, test names, mutations,
   assertions, expected error text, and RED command;
7. ordered implementation algorithm, permitted helper structure, minimal GREEN
   behavior, and refactor boundary;
8. required focused and regression commands;
9. exact unique result-file path and handoff format with no design narrative
   required; and
10. prohibition on secrets, network writes, publishing, and phase/gate claims.

## Primary-agent audit checklist

For each returned batch, the primary agent independently performs:

1. **Scope audit:** inspect `git status`, full diff, created paths, dependencies,
   ignored/public boundaries, and unrelated user changes.
2. **Instruction audit:** confirm the Coding Agent read and obeyed applicable
   `AGENTS.md`, skill, spec, safety, and TDD rules.
3. **TDD audit:** confirm the reported RED reached the intended assertion and
   failed for missing behavior; rerun focused GREEN tests.
4. **Adversarial audit:** add or run at least one independent tripwire the task
   prompt did not reveal verbatim where feasible.
5. **Regression audit:** run the required cone through root `npm run check`, or
   document why the command is not yet applicable.
6. **Authority/accounting audit:** verify no component gains authority beyond
   the active trusted-MVP architecture, the configured operator boundary is
   disclosed, Arc derives amounts itself, and rejected paths do not change hard
   state/value.
7. **Security audit:** scan public/staged candidates for secrets, keys, `.env`,
   wallet material, sensitive receipts, internal prompts, or vendored tools.
8. **Claim audit:** accept only claims supported by fresh local/network evidence
   at the correct level.
9. **Verdict:** write one of:
   - `ACCEPTED` — all acceptance checks pass; next batch may start;
   - `REWORK` — give exact failing test/file/invariant and a corrective prompt;
   - `REDESIGN` — implementation exposed a wrong frozen assumption; reopen its
     owner phase before any downstream work.

## Current next handoff

R1 is accepted. R2 REWORK-1 produced its unique result file and passes its exact
focused/full/compile acceptance. Its remaining direct-helper malformed-type case
is future hardening because Arc-source verification is no longer an MVP path.

Do not issue R3 Notary. The project-only trusted-demo exception is accepted. The
next task belongs to the primary agent: freeze Phase 1 schemas, encodings, ports,
write-safety/value/time matrices and exact test IDs before issuing the first MVP
Coding Agent implementation packet.
