# Arena ISS architecture

## Product scope

Arena ISS is an Agent Evaluation Platform under
[`ADR-002-AGENT-EVALUATION-PLATFORM.md`](ADR-002-AGENT-EVALUATION-PLATFORM.md).
The trusted-operator tournament described below is the current implemented
baseline and remains one `TOURNAMENT` evaluation mode. It is not the complete
target platform.

The target shared evaluation pipeline is:

```text
AgentVersion + TestPack/TestScenario + RuntimePolicy
                         |
                         v
                 Evaluation Harness
                         |
              +----------+-----------+
              |                      |
              v                      v
   deterministic policy       observable run evidence
   and sandbox assertions      output + tool + actions
              |                      |
              +----------+-----------+
                         v
              GenLayer semantic judge
                         |
                         v
          validated Scorecard + evidence-linked report
                         |
             optional campaign consequence
                 /                         \
                v                           v
     benchmark/comparison             Arc USDC bounty or prize
```

The deterministic engine owns objective facts such as forbidden tool calls,
missing confirmation, invalid call order, budget violations and exact fixture
postconditions. GenLayer owns qualitative judgment over the exact submitted
evidence. Arc owns value only for evaluation campaigns that configure a stake,
bounty, reward, refund or fee.

The current `ArenaMatchJudge` is not silently widened into a universal evaluator.
A generalized scorecard contract/revision must first prove multi-dimensional
schema normalization, bounded reasons, deterministic aggregate derivation,
malicious-output resistance and validator stability in a dedicated feasibility
phase.

## Current Tournament MVP decision

The approved MVP optimizes for a working asynchronous tournament rather than
eliminating every operator trust assumption. Backend coordination is trusted and
GenLayer-to-Arc delivery is not cryptographically verified in the first release.

The old TEE + Arc-source quorum + 3-of-5 finality committee design is retained as
the post-MVP **trust-minimized development roadmap**.

## Component ownership

| Component | MVP responsibility | Authoritative for | Explicitly not proven |
| --- | --- | --- | --- |
| Arc `TournamentEscrow` | Registration, stake custody, cancellation/refunds, one-time operator settlement, credits, withdrawals | USDC accounting and configured operator authorization | That ranking originated from GenLayer |
| Backend API/database | Contestant `AGENTS.md` plaintext, policies, roster snapshot, bracket, topics, inference artifacts, retries, A/B mapping, final ranking | Operational tournament state | Honest generation/progression against a malicious operator |
| Scheduler/workers | Wake eligible jobs, call provider/GenLayer/Arc, resume interrupted work | Liveness only inside backend | Permissionless liveness |
| Model provider adapter | Generate bounded output for each side | Returned provider response bytes | Same-model provenance without provider proof/TEE |
| GenLayer `ArenaMatchJudge` | Judge one submitted A/B pair and store verdict/reasons | Semantic verdict over submitted bytes | Authenticity of those bytes or full bracket correctness |
| Frontend | Display Arc canonical value state, backend tournament state, and GenLayer transaction/verdict links | No independent authority | Cross-chain verification |
| Operations treasury | Pay API and GenLayer/keeper costs | Operational spending | Any right to debit player escrow |

## End-to-end data flow

```text
1. wallet -> Arc: register(agent_id, agents_commitment, stake)
2. backend <- Arc: read accepted entrants
3. backend: create bracket, match IDs, topics, attempts
4. backend -> model API: generate A and B under one policy
5. backend: persist output-to-agent mapping and digests
6. backend -> GenLayer: submit blinded match artifact
7. backend <- GenLayer: wait finality + execution success + read verdict
8. backend: map side to agent, advance bracket, repeat
9. backend -> Arc: operator submits validated final ranking
10. Arc: derive fee/credits; winners and platform withdraw
```

## Stable identifiers

Identifiers are generated before side effects and reused through retries:

```text
tournament_id = hash(arc_chain_id, escrow, creator, creator_nonce)
entrant_id    = hash(tournament_id, wallet, agent_id, entry_nonce)
round_id      = hash(tournament_id, round_number, bracket_revision)
match_id      = hash(round_id, match_index, entrant_a_id, entrant_b_id)
attempt_id    = hash(match_id, attempt_number)
inference_id  = hash(attempt_id, side, agents_commitment, topic_digest, policy)
judge_ref     = hash(genlayer_chain_id, judge_address, match_id, attempt_id)
settlement_id = hash(tournament_id, ranking_digest, settlement_nonce)
```

Exact byte encoding must be frozen in shared conformance vectors before contract
or service implementation.

## State ownership

### Arc escrow

```text
DRAFT
  -> REGISTRATION_OPEN
  -> REGISTRATION_CLOSED
  -> RUNNING
  -> SETTLED
  -> CLOSED

Failure:
REGISTRATION_OPEN/CLOSED/RUNNING -> CANCELLED_REFUNDABLE -> CLOSED
```

Arc does not store every match. It stores entrants, stakes, immutable economics,
operator, settlement identity, credits, refunds, withdrawals, and liabilities.
Settlement creates the complete credit ledger before external transfers. A
restart-safe relayer triggers one payout per beneficiary and the owner fee; each
entrypoint transfers only to the credited/locked destination. One failed payout
therefore leaves a pull credit without blocking unrelated winners.

### Backend tournament

```text
SCHEDULED -> REGISTRATION_SYNCED -> RUNNING
          -> RANKING_READY -> SETTLEMENT_SUBMITTED -> COMPLETE

Failure:
WAITING_RETRY | RECOVERY_REQUIRED | REFUND_REQUESTED | CANCELLED
```

### Backend match attempt

```text
CREATED -> GENERATING -> OUTPUTS_READY -> JUDGE_SUBMITTED
        -> JUDGE_FINALIZED -> A_WIN | B_WIN | TIE | RETRYABLE

Failure:
GENERATION_FAILED | SUBMISSION_FAILED | EXECUTION_FAILED | RECOVERY_REQUIRED
```

Every transition is conditional and idempotent. Worker completion cannot skip a
state or overwrite a different transaction/reference.

### GenLayer judge

```text
UNKNOWN -> SUBMITTED -> A_WIN | B_WIN | TIE | RETRYABLE
```

The judge stores one canonical result per `(match_id, attempt_id)` and rejects a
conflicting duplicate.

## Trust boundaries

### Model generation

The backend checks contestant `AGENTS.md` commitments, applies the versioned
`delegated-user-json-v2` request builder, records request/response digests, and
disallows one-sided retries. The platform `system` message delegates answer
strategy to `AGENTS.md`; a JSON `user` envelope keeps `agents_md` and `topic`
distinct. The same model, temperature, wrapper, topic, and output ceiling apply
to both sides. These controls detect software defects and create audit material;
they do not constrain a malicious operator.

### GenLayer result tracking

A transaction hash is not a verdict. The poller must establish:

1. expected GenLayer network and judge address;
2. transaction reached the configured final status;
3. execution result succeeded;
4. canonical judge view contains the expected match and attempt;
5. normalized verdict is valid; and
6. the transaction has not already produced a progression effect.

### Arc settlement

MVP settlement trusts the configured operator signature/caller. Arc still
enforces:

- exact tournament and state;
- unique registered ranked entrants;
- expected rank count;
- immutable fee/payout BPS;
- deterministic rounding;
- one settlement ID once;
- credit-before-transfer accounting; and
- no double withdrawal.

Public GenLayer transaction references make divergence detectable offchain but do
not let Arc reject a dishonest ranking by itself.

## Liveness

The scheduler wakes all offchain work. Job ownership uses leases and deterministic
idempotency keys. On restart, workers recover from persisted state and existing
provider/transaction references before creating a new side effect.

Players need not be online. In the MVP, operator failure can pause progression or
settlement; permissionless recovery is a roadmap capability.

## Value invariants

At all times:

```text
total_usdc_received
= total_usdc_withdrawn
 + total_open_credits
 + total_locked_stakes
 + platform_fee_credit
 + explicitly classified remainder
```

Successful settlement:

```text
platform_fee   = floor(gross_pool * 1_000 / 10_000)
net_prize_pool = gross_pool - platform_fee
```

Refundable cancellation returns 100% of accepted stakes and creates no platform
fee. Model, scheduler, relay, Arc gas, and GenLayer GEN costs never debit escrow.

## Lộ trình phát triển trust-minimized

The MVP keeps stable ports so hardening can replace authority without rewriting
the tournament domain:

| Stage | Added mechanism | Trust removed | Preserved interface |
| --- | --- | --- | --- |
| TM-1 | Atomic ACI/TEE pair receipt | Prompt/model/output substitution and selective retry | `GenerationArtifact` |
| TM-2 | GenLayer-authenticated Arc snapshot/randomness | Backend-controlled roster/pairing/topic claims | `TournamentSnapshot` |
| TM-3 | Independent threshold finality notaries | Single operator ranking relay | `SettlementAuthorization` |
| TM-4 | Reciprocal immutable deployment binding | Cross-deployment replay/substitution | deployment manifest/domain IDs |
| TM-5 | Native bridge/light client/succinct proof | Committee trust | `IResultVerifier` |

Each stage requires its own threat model, fixtures, TDD, live evidence, migration,
and explicit activation. No roadmap item is represented as existing MVP security.

## Policy implication

This architecture is a valid functional MVP but intentionally does not satisfy a
policy that requires every actor-controlled consequential artifact to have an
independent authenticity proof. The parent workspace now records a project-only
exception permitting local implementation/testing of this trusted demo. It does
not mark any gate `PASS` or authorize wallets, paid calls, deployments, network
writes, publishing, or submission.
