# Product concept

## Identity

- Idea ID: `IDEA-028`
- Product: `Arena ISS — Agent Evaluation Platform`
- ISS expansion: `Intelligence, Safety & Standards`
- Category target: `Projects`
- MVP trust model: `TRUSTED_OPERATOR`
- Arc target: Arc Testnet USDC escrow
- GenLayer target: Studionet; Studio Dev is an optional RC compatibility lane
- Status: design and project-only implementation exception approved; one
  bounded GenLayer judge deployment was separately authorized and completed;
  future external/network/value actions still require separate authorization

## Accepted product direction — 2026-09-14

The long-term product is no longer limited to Agent-versus-Agent tournaments.
Arena ISS is a controlled evaluation platform for the observable quality of an
Agent's reasoning artifacts, action decisions, rule compliance, robustness and
task completion. The full decision is locked in
[`ADR-002-AGENT-EVALUATION-PLATFORM.md`](ADR-002-AGENT-EVALUATION-PLATFORM.md).

The current tournament remains the first implemented `TOURNAMENT` evaluation
mode and a reusable pairwise judge baseline. The following are target product
capabilities and must not be presented as implemented yet:

- versioned Test Packs and scenarios with public/hidden fixtures;
- solo, version-comparison, regression and adversarial evaluations;
- sandboxed tool traces and deterministic rule assertions;
- evidence-linked, multi-dimensional scorecards; and
- Test-Pack-scoped reports and benchmark leaderboards.

The product evaluates observable responses, rationales, tool choices, arguments,
state transitions and outcomes. It does not request, store, expose or claim to
measure a provider's hidden chain of thought.

## Current Tournament MVP promise

A player creates one `AGENTS.md`-defined agent, deposits the tournament stake once,
and leaves. The platform runs every later match. GenLayer judges each submitted
output pair, and Arc escrows and credits USDC prizes.

The player does not call a model, run a local agent, return at `00:00 UTC`, or
manually advance a match.

## Target Evaluation Platform promise

An Agent builder can bind an immutable Agent version to a versioned Test Pack,
run controlled scenarios, and receive a reproducible report showing:

- deterministic pass/fail findings for objective rules and sandbox outcomes;
- GenLayer semantic scores and bounded reasons for qualitative dimensions;
- provider, timeout, empty-output, tool and infrastructure states separately;
- evidence references for each finding; and
- differences or regressions from an earlier Agent version.

Tournament prizes remain optional. Arc is required only when an evaluation
campaign has an onchain stake, bounty, reward, refund or platform fee.

## Explicit MVP trust statement

The configured platform operator is trusted to:

- preserve the registered contestant `AGENTS.md` plaintext and its version;
- form the advertised bracket and choose topics under tournament policy;
- call the advertised provider/model and generation parameters;
- submit the unmodified output pair to GenLayer;
- follow the finalized GenLayer verdict when advancing each match; and
- submit the resulting final ranking to Arc.

GenLayer provides validator-controlled semantic adjudication over the artifacts
actually submitted. Arc provides deterministic USDC custody and accounting.
Neither chain proves the complete offchain causal history in the MVP.

## Tournament creation

Before registration opens, lock:

- registration open/close and tournament start timestamps;
- minimum and maximum entrant counts;
- entry stake in six-decimal ERC-20 USDC units;
- immutable platform fee of `1,000` BPS;
- top-five payout BPS totaling `10,000` over the net pool;
- operator address allowed to submit the final ranking;
- provider, model-policy, generation-policy, wrapper, topic-deck, and rubric
  versions;
- output-size limit, timeout, retry cap, tie policy, and tournament expiry; and
- cancellation/refund policy.

Configuration becomes immutable when the first stake is accepted.

## Registration

Arc accepts registration only while:

```text
registration_open_at <= now < registration_close_at
```

Each entry binds:

```text
tournament_id
entrant_wallet
agent_id
agents_version
agents_commitment
stake_amount
entry_nonce
```

The backend stores `AGENTS.md` plaintext and verifies that it hashes to the registered
commitment before generation. In the MVP this is an operational consistency
check, not proof against a malicious operator.

## Tournament start and bracket

The backend scheduler wakes the tournament at or after the configured start.
Contracts never wake themselves. The backend:

1. reads the canonical registered entrant set from Arc;
2. closes its local roster snapshot;
3. derives the bracket from the locked algorithm and stored tournament seed;
4. creates preliminary matches and deterministic byes when needed; and
5. creates append-only match and attempt records.

Bracket state is authoritative in the backend for the MVP. The frontend exposes
its status as platform-operated state and links every decided match to its
GenLayer transaction.

## Match generation

For each pair, the backend creates two requests using exactly the same configured
model and generation policy. The canonical `arena-generation-input-v2`
envelope is:

```text
system: platform protocol that delegates answer strategy to AGENTS.md
user:   JSON { schema, agents_md, topic }
API:    fixed model + temperature + max output tokens
```

The platform wrapper does not rescue a weak, incorrect, or off-topic strategy.
`AGENTS.md` controls reasoning approach, content strategy, tone, language, and
structure; only protocol/security/output-bound invariants override it. The only
contestant-controlled variable is the registered `AGENTS.md`. Each
inference run records:

```text
match_id
attempt_id
side A or B
agent_id
agents_version and commitment
topic_id and topic digest
model/generation policy versions
provider request ID when available
output bytes and digest
started/completed timestamps
```

If only one side succeeds, the attempt is incomplete and cannot be judged. A
retry creates a new attempt for the entire pair.

## GenLayer adjudication

The backend blinds wallet identities and submits the match-bound topic, output A,
output B, rubric version, and relevant digests to the GenLayer `ArenaMatchJudge`.
The judge must normalize a bounded result:

```json
{
  "match_id": "...",
  "attempt_id": "...",
  "criterion_results": [
    {"criterion_id": "...", "winner": "A|B|TIE", "reason": "..."}
  ],
  "result": "A_WIN|B_WIN|TIE|RETRYABLE",
  "summary": "..."
}
```

Contract code verifies exact match/attempt bindings, complete criterion coverage,
valid enums, no duplicates/extras, and bounded reason lengths. It derives
`result` from the validated criterion mapping. Reasons are explanatory only and
cannot contain or determine wallets, payouts, or settlement instructions.

The backend records the submitted transaction hash, waits for the intended final
status, verifies execution success, reads the canonical contract result, checks
the expected match and attempt IDs, then maps `A` or `B` back to the stored agent.

## Progression, ties, and ranking

- Only a finalized, successfully executed `A_WIN` or `B_WIN` advances a player.
- `RETRYABLE` does not advance either side.
- A first tie creates a new attempt with the next policy-selected topic.
- Later ties use the criterion priority/fallback frozen at tournament creation.
- A later round is created only when all required prior matches are terminal.
- All attempts and GenLayer transaction IDs are append-only.

Top five requires a final, a third-place match, and a fifth-place playoff. The
backend validates the full bracket before producing the final ranking.

## Arc settlement and economics

The operator submits only ordered registered entrant IDs/wallets and a settlement
reference. Arc independently verifies uniqueness, registration membership,
tournament state, expected rank count, and one-time settlement, then calculates:

```text
gross_pool        = sum(accepted stakes)
platform_fee      = floor(gross_pool * 1,000 / 10,000)
net_prize_pool    = gross_pool - platform_fee
winner_credit[i]  = floor(net_prize_pool * payout_bps[i] / 10,000)
```

Every rounding remainder goes to the predeclared destination, initially rank 1.
Settlement atomically opens platform and winner credits. The operations relayer
then pays each credit independently to its existing beneficiary; it cannot name
an alternate transfer recipient. Users retain the pull-credit method as a
fallback if relayed delivery fails or exhausts retry. The operator never supplies
payout amounts.

The platform pays model API, scheduler, relay, Arc keeper gas, and GenLayer GEN
costs from a separate operations treasury. x402 may be an internal provider
billing method; it is not a player action or verdict proof.

## Failure and recovery

- Insufficient entrants: cancel, return every accepted stake, create no fee.
- Provider unavailable/partial response: retry the whole match attempt.
- GenLayer submission or execution failure: record failure; no advancement.
- `RETRYABLE` or tie: follow the locked attempt policy.
- Retry cap or tournament expiry: use the frozen deterministic fallback or enter
  refundable cancellation; an operator cannot invent a winner ad hoc.
- Operator unavailable after GenLayer finality: tournament remains pending until
  operator recovery; MVP does not promise permissionless settlement.
- Duplicate generation, transaction polling, progression, settlement, or
  withdrawal cannot create a second terminal effect.

## Lộ trình phát triển trust-minimized (post-MVP)

Future versions may progressively remove operator trust without changing the
player-facing tournament model:

1. add an ACI/TEE pair runner binding both prompts and outputs atomically;
2. authenticate Arc roster/randomness snapshots inside GenLayer;
3. replace operator ranking submission with a threshold finality proof;
4. bind Arc manager, GenLayer judge, and verifier deployments reciprocally; and
5. later replace the committee with a native bridge/light-client or succinct
   finality proof when available.

These are roadmap hardening stages, not MVP blockers or current claims.

## Honest limitations

- The operator can manipulate generation, bracket progression, or settlement.
- Hashes and transaction links make behavior auditable but do not prevent fraud.
- The Arc contract does not verify GenLayer finality in the MVP.
- Testnet/Studio deployments are not production or mainnet evidence.
- The parent workspace permits this child alone to build/test the trusted demo,
  but Evidence Authenticity remains `FAIL`/`OPEN`; it cannot be presented as an
  admitted trustless GenLayer contribution.
