# Đặc tả triển khai — Tournament MVP và Evaluation Platform

## 1. Trạng thái tài liệu

- Sản phẩm: `Arena ISS — Agent Evaluation Platform` (`IDEA-028`)
- Ý nghĩa ISS: `Intelligence, Safety & Standards`
- Kiến trúc MVP: `TRUSTED_OPERATOR`
- Arc: giữ stake USDC, refund, credit và withdrawal
- Backend: contestant `AGENTS.md`, bracket, model calls, mapping, progression và ranking
- GenLayer: phán quyết semantic cho từng cặp output đã được gửi
- Trạng thái: thiết kế và local implementation exception chỉ cho project này đã
  được chủ dự án duyệt ngày `2026-09-11`
- Giới hạn: project exception chỉ cho phép local production-shaped code theo
  phase order. Paid provider/GenLayer/Arc actions đã thực hiện chỉ dựa trên các
  action-time authorization riêng và không mở quyền mặc định cho lần sau;
  publication/submission vẫn chưa được phép

Tài liệu này thay thế thứ tự triển khai cũ dựa trên TEE, Arc-source quorum và
finality committee. Các cơ chế đó chuyển sang mục 19, lộ trình phát triển
trust-minimized sau MVP.

Quyết định sản phẩm ngày `2026-09-14` tại
[`ADR-002-AGENT-EVALUATION-PLATFORM.md`](ADR-002-AGENT-EVALUATION-PLATFORM.md)
mở rộng Arena ISS thành nền tảng đánh giá chất lượng tư duy quan sát được,
quyết định hành động và tuân thủ quy tắc của Agent. Phase 0–12 bên dưới vẫn là
baseline `TOURNAMENT` đã triển khai/chứng minh; chúng không tự động chứng minh
các khả năng Evaluation Platform mới. Phase 13 release của định vị cũ tạm dừng
cho đến khi hoàn thành ít nhất `EVAL-0` và feasibility gate `EVAL-1`.

## 2. Kết quả MVP cần đạt

Một người chơi có thể:

1. tạo Agent và một phiên bản `AGENTS.md`;
2. đăng ký giải và stake USDC một lần trên Arc;
3. rời ứng dụng;
4. xem backend tự chạy các vòng bằng cùng model policy;
5. xem transaction và lý do phán quyết GenLayer của từng trận;
6. xem Top 5 sau khi giải hoàn tất; và
7. nhận USDC tự động từ relayer sau settlement, hoặc tự withdraw credit trên Arc
   nếu automatic payout thất bại/hết retry.

Nền tảng thu đúng 10% gross pool khi settlement thành công. API và GenLayer gas
do operations treasury trả, không trừ trực tiếp khỏi escrow.

## 3. Ranh giới tin cậy MVP

### 3.1 Authority thật

| Dữ liệu/hành động | Authority MVP |
| --- | --- |
| Stake, entrant, refund, credit, withdrawal | Arc contract |
| `AGENTS.md` plaintext và version | Backend database |
| Bracket, topic, retry, A/B mapping, ranking | Backend coordinator |
| Verdict trên output A/B đã submit | GenLayer contract |
| Cho phép ranking cuối vào Arc | Configured Arc operator |
| Số tiền fee và winner credit | Arc tự tính từ locked BPS |

### 3.2 Claim được phép

`GenLayer-consensus semantic adjudication over platform-submitted outputs`.

### 3.3 Claim không được phép

- trustless generation;
- proof rằng output chắc chắn đến từ exact model/contestant `AGENTS.md`;
- permissionless tournament operation;
- trustless GenLayer-to-Arc settlement;
- Arc tự xác minh GenLayer finality; hoặc
- production/mainnet security.

## 4. Quy tắc sắp xếp công việc

1. Phase sau chỉ dùng interface đã khóa bởi phase trước.
2. Không viết adapter trước khi domain port và failure enum đã khóa.
3. Không viết frontend bằng mock shape khác production port.
4. Không deploy để khám phá bug cơ bản; local suite phải green trước.
5. Mỗi Coding Agent batch chỉ triển khai một vertical slice đã có test chi tiết.
6. Primary agent quyết định schema, trust, safety, test và audit; Coding Agent
   chỉ thực thi packet.
7. TEE/notary/bridge không được chen vào MVP critical path.
8. Mọi write liên quan tiền phải có safety card và value-destination row trước code.

## 5. Dependency graph

```text
Phase 0  architecture + policy reconciliation
   |
Phase 1  protocol/domain/interface freeze
   |
Phase 2  reproducible scaffold + CI
   |
Phase 3  backend domain + persistence + bracket engine
   |--------------------|
Phase 4  Arc escrow      Phase 5 GenLayer MatchJudge
   |--------------------|
Phase 6  model generation adapter
   |
Phase 7  GenLayer submit/finality adapter
   |
Phase 8  tournament orchestrator
   |
Phase 9  Arc settlement worker
   |
Phase 10 frontend + wallet adapters
   |
Phase 11 local full lifecycle
   |
Phase 12 authorized network lifecycle
   |
Phase 13 release/submission

Post-MVP: TM-1 -> TM-2 -> TM-3 -> TM-4 -> TM-5

Evaluation expansion:
EVAL-0 protocol/authority freeze
   |
EVAL-1 GenLayer scorecard feasibility
   |
EVAL-2 deterministic proposal policy
   |
EVAL-3 evaluation persistence
   |
EVAL-4 solo evaluation + run report
   |
EVAL-5 comparison + regression
   |
EVAL-6 tournament migration to shared model
   |
EVAL-7 benchmarks + optional Arc bounty

Marketplace expansion (after EVAL-6):
MKT-0 policy/authority freeze
   |
MKT-1 Evo eligibility aggregation
   |
MKT-2 Arc registry V2 + marketplace accounting
   |
MKT-3 persistence/operator authorization/delivery
   |
MKT-4 frontend + Circle SCA flows
   |
MKT-5 authorized network lifecycle
```

Phases 4 và 5 có thể triển khai độc lập sau Phase 3, nhưng mỗi batch vẫn được
audit riêng. Phase 6 không phụ thuộc contract internals; Phase 7 chỉ bắt đầu khi
public GenLayer interface đã được chấp nhận.

## 6. Phase 0 — Khóa quyết định và xử lý policy

**Status: `COMPLETE` — exception chỉ áp dụng cho `async-agent-arena`; không gate
nào được nâng cấp và không external action nào được mở.**

### Mục tiêu

Biến quyết định trusted-operator thành một baseline không mâu thuẫn trước khi
production code bắt đầu.

### Công việc primary agent

1. Đồng bộ `CONCEPT`, `ARCHITECTURE`, implementation spec, TDD plan, status và
   gate review.
2. Đánh dấu ACI/TEE, Arc-source quorum và finality committee là post-MVP.
3. Ghi rõ backend có thể tác động generation, bracket và ranking.
4. Ghi rõ GenLayer chỉ authoritative trên bytes đã submit.
5. Ghi project-only `TRUSTED_OPERATOR_DEMO` exception tại parent authority mà
   không thay đổi gate/result của project khác.
6. Giữ mọi external/network/value authorization tách biệt.

### Exit

- Không còn tài liệu nào gọi TEE/notary là MVP prerequisite.
- Không còn tài liệu nào nói coordinator không có bracket/ranking authority.
- Parent-policy exception áp dụng đúng duy nhất cho child repo này.
- Chưa có production source mới.

## 7. Phase 1 — Khóa domain, schema và safety

### Mục tiêu

Hoàn tất thiết kế đủ để Coding Agent không phải tự phát minh interface.

### 1.1 Domain entities

Khóa schema/version cho:

- `AgentProfile`, `AgentsVersion`;
- `TournamentPolicy`, `TournamentEntry`;
- `Bracket`, `Round`, `Match`, `MatchAttempt`;
- `InferenceRun`, `GenerationPair`;
- `JudgeSubmission`, `JudgeVerdict`;
- `FinalRanking`, `SettlementAuthorization`;
- `ArcCredit`, `WithdrawalRecord`; và
- `JobLease`, `ExternalOperation`.

Mỗi entity có stable ID, version, timestamps, state enum và uniqueness keys.

### 1.2 Stable ports

Khóa các interface logic, chưa gắn thư viện:

```text
ArcReadPort
ArcWritePort
AgentsFileStore
TournamentStore
BracketEngine
TopicSelector
ModelProviderPort
GenLayerJudgePort
ClockPort
JobQueuePort
SettlementPort
```

### 1.3 Failure taxonomy

Tối thiểu:

```text
INVALID_INPUT
WRONG_STATE
TOO_EARLY
TOO_LATE
DUPLICATE
PROVIDER_TRANSIENT
PROVIDER_PERMANENT
PARTIAL_PAIR
JUDGE_SUBMISSION_FAILED
JUDGE_EXECUTION_FAILED
JUDGE_RETRYABLE
JUDGE_TIE
SETTLEMENT_REJECTED
RECOVERY_REQUIRED
REFUNDABLE
```

### 1.4 Arc public interface proposal

Đóng băng hành vi trước tên ABI cuối:

```text
createTournament(policy)
register(tournamentId, entrantId, agentId, agentsVersion, agentsCommitment)
closeRegistration(tournamentId)
markRunning(tournamentId)
settleByOperator(tournamentId, rankedEntrants, rankingDigest, settlementNonce)
cancelAndOpenRefunds(tournamentId, reason)
withdrawCredit(tournamentId)
withdrawCreditFor(tournamentId, beneficiary)
withdrawPlatformFee(tournamentId)
withdrawPlatformFeeFor(tournamentId)
closeTournament(tournamentId)
```

Operator chỉ truyền ranking, digest và nonce; không truyền payout amount.

### 1.5 GenLayer public interface proposal

```text
submitMatch(matchId, attemptId, topic, outputA, outputB,
            outputDigestA, outputDigestB, rubricVersion)
getMatchResult(matchId, attemptId)
```

Kết quả gồm criterion winners, bounded reasons, summary và derived result.

### 1.6 Matrices

Hoàn tất trước code:

- write-method safety card cho mọi Arc/GenLayer write;
- value-destination matrix cho stake, refund, fee, credits và remainder;
- temporal boundary matrix;
- authority/claim matrix đúng trusted MVP;
- UI lifecycle traceability matrix.

### Exit

- Schema không còn TODO ảnh hưởng code.
- Mỗi public write có caller/state/time/idempotency/accounting/negative tests.
- Mỗi cross-component field có một owner và encoding.
- Không interface nào cần TM-1…TM-5 mới chạy được.

## 8. Phase 2 — Scaffold và continuous checks

### Mục tiêu

Tạo repository runtime tối thiểu, reproducible, không mang sample product.

### Layout đề xuất

```text
contracts/
  arc/
  genlayer/
services/
  api/
  worker/
packages/
  protocol/
  domain/
frontend/
tests/
  system/
scripts/
docs/evidence/
```

### Công việc

1. Chọn và pin Node/Python, package manager, Solidity toolchain, GenVM runner,
   OpenZeppelin, viem và GenLayer SDK family.
2. Tạo root scripts cho format, lint, typecheck, unit, contract, build và check.
3. Tạo `.env.example` chỉ chứa tên biến và giải thích, không secret.
4. Tạo test DB/queue adapters local và deterministic clock.
5. Tạo CI không dùng wallet, paid API hoặc network write.
6. Xóa toàn bộ sample contracts/routes/tests/metadata từ boilerplate.

### Exit

- Clean install chạy được.
- `npm run check` gọi đúng mọi suite đang tồn tại.
- Empty shells build/typecheck.
- Secret/public-path scan pass.

## 9. Phase 3 — Domain backend, persistence và bracket engine

### Mục tiêu

Xây phần thuần deterministic trước external I/O.

### 3.1 Contestant `AGENTS.md` and policy

- Create versioned contestant `AGENTS.md` artifacts; immutable version after
  tournament entry.
- Recompute commitment before generation.
- Validate tournament timestamps, entrant bounds, fee=1000 BPS, payout sum,
  retry/tie/expiry policy and model/topic/rubric versions.

### 3.2 Bracket engine

- Support the locked entrant range, initially 8–32.
- Produce preliminary matches and byes deterministically.
- Produce main, third-place, and fifth-place paths.
- Map A/B to entrant IDs only through persisted match data.
- Validate final ranking has complete ancestry and unique entrants.

### 3.3 Persistence

- Apply unique constraints to tournament, entrant, match, attempt, inference,
  GenLayer tx, progression and settlement effects.
- Store append-only attempt history.
- Use transactions/outbox for state plus job creation.
- Create lease/recovery fields; no in-memory-only canonical progress.

### Exit

- Domain tests cover all entrant counts and ranking paths.
- Restart/replay cannot create duplicate attempts or advancement.
- No network SDK is needed by domain tests.

## 10. Phase 4 — Arc `TournamentEscrow`, test first

### Mục tiêu

USDC custody/accounting hoạt động độc lập với backend và GenLayer adapters.

### 4.1 Construction/config

- Validate ERC-20 USDC address, six decimals assumption at integration boundary,
  immutable owner fee destination, configured operator and policy limits.
- Lock operator and fee policy for each tournament before first stake.

### 4.2 Registration

- Enforce caller, exact interval, exact stake, uniqueness and allowance/transfer.
- Apply checks-effects-interactions and safe token transfer.
- Prove failed transfer changes no entrant or liability.

### 4.3 State and recovery

- Close registration and mark running with explicit caller/time/state rules.
- Insufficient entrants and expiry open full refunds with zero fee.
- Recovery calls are idempotent and cannot strand liabilities.

### 4.4 Operator settlement

- Only configured operator.
- Ranking contains expected number of unique registered entrants.
- Contract derives fee, net pool, payouts and remainder.
- Credits open atomically; duplicate settlement rejects/no-ops safely.
- Ranking digest/reference is stored for public audit but not treated as a
  cryptographic GenLayer proof.

### 4.5 Withdrawal/close

- Debit ledger before transfer.
- Reentrancy, failing token, duplicate withdrawal and wrong recipient tests.
- Permit a relayer to trigger each winner payout without any alternate transfer
  destination; a failed recipient retains pull-withdrawal credit and does not
  block other payouts.
- Permit relayed platform-fee delivery only to the immutable owner recipient.
- Close only at zero liability.

### Exit

- Unit/fuzz/invariant suites pass.
- Conservation holds in settle, refund, failure and duplicate paths.
- Operator cannot set arbitrary amounts or non-entrant winners.

## 11. Phase 5 — GenLayer `ArenaMatchJudge`, test first

### Mục tiêu

Một Intelligent Contract nhỏ, chỉ phán quyết một match attempt.

### 5.1 Deterministic boundary

- One project-specific `gl.Contract` subclass.
- Store immutable rubric versions and bounded criterion IDs.
- Validate match/attempt IDs, output digest recomputation, output sizes and
  duplicate/conflicting submission.

### 5.2 Nondeterministic adjudication

- Leader returns criterion winner plus bounded reason for every criterion.
- Validator compares meaning against topic and both outputs.
- Normalize enums and reject missing/extra/duplicate criterion IDs.
- Contract code derives aggregate `A_WIN`, `B_WIN` or `TIE`.
- Reason and summary never supply payout or wallet data.

### 5.3 Canonical views

- `getMatchResult` distinguishes unknown from terminal state. GenLayer
  transaction lifecycle (`PENDING`, failed, undetermined, retryable) belongs to
  the Phase 7 tracker; it is not duplicated in contract storage.
- Returned state includes exact match/attempt, criterion mapping, reasons,
  summary, result and exact input digests. Transaction hashes and retry
  revisions belong to the tracker record.

### Exit

- GenVM lint recognizes exact contract class.
- Direct tests cover deterministic guards and hostile leader output.
- Consensus integration covers clear A/B, tie, retry and rationale consistency.
- No Arc RPC, bracket state, TEE receipt or settlement proof is required.

### Phase 5 feasibility checkpoint — passed on Studionet

`ArenaMatchJudge` V3 is deployed at
`0xD0F558c89Baea30C885d85D7F50C7937Eb102C85` on chain `61999`. V1 proved the
multi-topic and payload boundary; V2 added clarity/correctness independence and
validator rationale auditing. A 27-case adversarial run then exposed marginal
tie instability and harmful literal-compliance behavior. V3 adds a 10-point tie
margin, a decisive safety criterion, material-advantage rules, and a
deterministic identical-output tie. V1 and V2 are archived and must not receive
new submissions.

This passes the product's early adjudication feasibility gate and proves that
the MVP does not need one contract per topic. It does not mark the entire
production phase complete: broader statistical sampling and Phase 7
retry/finality integration remain required. Sanitized evidence lives in
`docs/evidence/studionet/`.

## 12. Phase 6 — Model generation adapter

### Mục tiêu

Tạo hai output có cùng request policy và mapping chính xác, không claim TEE.

### Công việc

1. Build the `arena-generation-input-v2` request: a platform-owned `system`
   wrapper explicitly delegates answer strategy to `AGENTS.md`; one JSON
   `user` message carries distinct `agents_md` and `topic` fields; model,
   temperature and `max_tokens` remain locked provider parameters.
2. Use the same provider/model/generation policy for both sides.
3. Persist an `InferenceRun` before sending a request.
4. Record provider request ID, status, response bytes, digest, usage and cost.
5. Never log `AGENTS.md` plaintext/output/secrets unintentionally.
6. Treat one-sided success as `PARTIAL_PAIR`; do not judge it.
7. Retry a whole attempt with a new attempt ID after classifying transient vs
   permanent failure.
8. Budget API spend per tournament from operations treasury.

### Exit

- Fixture adapters prove exact request equality except `AGENTS.md`/side identity,
  exact JSON round-trip for delimiter-like contestant text, and no wallet,
  payout, opponent prompt, or side field in the provider payload.
- A bounded paid-provider causal eval must compare the legacy envelope,
  delegated-user JSON, and a system-compiled alternative under fixed
  model/topic/settings. Activate a wrapper version only when AGENTS-directed
  traits follow the prompt across repeats and platform invariants remain intact.
- Duplicate worker does not issue duplicate calls after a known response.
- Ambiguous provider result is reconciled before retry when API supports it.
- No paid/live call is required for local acceptance.

## 13. Phase 7 — GenLayer submission and finality tracker

### Mục tiêu

Biến one-time output pair thành canonical GenLayer verdict safely.

### Công việc

1. Persist `JudgeSubmission` before submitting.
2. Reuse `(match_id, attempt_id)` as idempotency/domain key.
3. Save tx hash immediately; never resubmit only because polling timed out.
4. Track `SUBMITTED`, `PENDING`, `ACCEPTED/DECIDED`, `FINALIZED`, failure.
5. Require both intended finality and execution success.
6. Read `getMatchResult`; verify judge address, match ID, attempt ID and schema.
7. Normalize verdict into domain enums; reject malformed/stale result.
8. Apply progression effect once using a unique database constraint.

### Exit

- Mocked raw and normalized receipt shapes pass.
- Restart at every lifecycle point resumes the same transaction.
- Finalized execution failure does not advance a player.
- Wrong match/attempt/result cannot mutate bracket.

## 14. Phase 8 — Tournament orchestrator

### Mục tiêu

Chạy giải từ lúc đóng đăng ký đến ranking mà không cần người chơi online.

### Ordered workers

1. registration sync;
2. tournament start eligibility;
3. bracket creation;
4. match-attempt generation;
5. pair completion;
6. GenLayer submission;
7. finality polling and canonical read;
8. tie/retry or winner advancement;
9. next-round creation;
10. placement matches;
11. final-ranking validation.

### Liveness rules

- Every job has deterministic key, lease, heartbeat, retry count and next time.
- Two workers may race; only one terminal state transition succeeds.
- A process crash after external submission recovers the stored reference.
- Operator dashboard can retry eligible work but cannot bypass domain guards.

### Exit

- Full tournament completes using fake Arc/provider/GenLayer ports.
- Crash/restart matrix has no duplicate model call, transaction or progression.
- Tie/retry/expiry branches are deterministic.
- Top-five ranking traces to terminal match results.

## 15. Phase 9 — Arc settlement worker

### Mục tiêu

Submit final ranking once, reconcile Arc credits and trigger isolated automatic
payouts from the operations wallet.

### Công việc

1. Validate bracket completeness and ranking uniqueness again.
2. Build ranking digest and immutable settlement nonce.
3. Persist outbound operation before Arc write.
4. Submit through configured operator account.
5. Save tx hash, wait receipt, inspect execution and read settlement/credits.
6. On ambiguous result, read transaction and Arc state before retry.
7. Mark backend complete only when Arc canonical credits match expected math.
8. After settlement finality, submit one `withdrawCreditFor` transaction per
   ranked wallet and one `withdrawPlatformFeeFor` transaction; persist each
   operation independently before continuing.
9. Continue remaining payouts when one recipient fails. Retry each boundedly;
   after exhaustion retain the beneficiary's pull credit and report partial
   failure rather than rolling back settlement.
10. Close only after canonical `totalLiability == 0`; otherwise keep the
    tournament settled with outstanding credits.

### Exit

- Wrong operator/ranking/state is a controlled failure.
- Duplicate worker cannot create a second settlement.
- Backend expected accounting exactly matches Arc views.
- A worker restart does not duplicate an effective payout, and one failed
  beneficiary does not prevent the other four winners or owner fee.
- GenLayer tx references are displayed as audit links but are not described as
  Arc-verified proofs.

## 16. Phase 10 — Frontend and wallet lifecycle

### Mục tiêu

Hoàn tất trải nghiệm người chơi bằng canonical Arc reads và honest backend state.

### Routes

```text
/
/agents
/agents/new
/tournaments
/tournaments/:id
/matches/:id
/account
/account?tab=credits
```

### Required behavior

- Discover EIP-6963/injected wallets and let user select one.
- Switch/add Arc Testnet before writes; disconnect clears write capability.
- Prepare Agent identity and private `AGENTS.md` through the backend, register
  `agentId`/version/commitment in Arc `AgentRegistry` through the authenticated
  user's Circle-managed wallet, then persist and show the Agent only after a
  transaction hash is available. Never send plaintext to Arc.
- Open an owner-only Agent detail modal with copyable `AGENTS.md`, exact
  Tournament/Evaluation history and metrics derived only from bound records.
- Deactivate an Agent through an owner-only Arc transaction after the user types
  the exact Agent name; retain immutable history and exclude inactive Agents
  from active listings.
- Register with a real Arc contract write and refresh canonical entrant state.
- Show bracket as `platform-operated` state.
- Show each GenLayer transaction, lifecycle, verdict, per-criterion reasons and
  summary.
- Distinguish submitted/finalized/execution-failed/retryable/tie states.
- List the connected wallet's prepared tournament registrations, retain only
  entrants confirmed by canonical Arc reads, and show each Tournament ID under
  the Account credits tab.
- Show Claim only for a positive canonical Arc credit; withdraw through Arc,
  wait for the receipt, and refresh the canonical credit.
- Never show backend completion as Arc settlement completion.
- Mock mode is visibly development-only and impossible in production build.

### Exit

- Component, adapter and browser-local tests pass.
- Real SDK wallet-account preflight passes.
- No browser CORS/Failed to fetch on configured read paths.
- Responsive/accessibility checks pass.

## 17. Phase 11 — Local full lifecycle

### Happy path

1. Create tournament.
2. Register at least eight entrants and lock `AGENTS.md` versions.
3. Run preliminary/main/placement matches.
4. Generate two outputs per attempt.
5. Finalize every GenLayer verdict.
6. Produce Top 5.
7. Submit operator settlement twice.
8. Prove only one set of credits.
9. Withdraw all winner/platform credits.
10. Close with zero liability.

### Failure campaigns

- insufficient entrants and full refund;
- provider partial response and whole-pair retry;
- GenLayer submit timeout with existing tx recovery;
- finalized execution failure;
- malformed criterion/reason/result;
- two workers racing every external side effect;
- tie, retry cap and expiry;
- wrong/non-entrant/duplicate ranking;
- settlement/withdraw duplicates and reentrancy;
- every temporal boundary with stale stored phase.

### Exit

- `npm run check` passes from clean install.
- All rejected value paths preserve accounting.
- No severity-high unresolved issue.

## 18. Phase 12 — Authorized network lifecycle

### Prerequisites

- Phase 11 green;
- exact source/lockfile/runner frozen;
- current official Arc and GenLayer network definitions verified; and
- explicit action-time authorization for wallet, paid API, deployment and writes.

### GenLayer lane

1. Optional: deploy a bounded compatibility revision to Studio Dev `61997` with
   matching RC tooling; treat it as resettable evidence only.
2. Deploy the submission/demo revision to the workspace-selected stable network.
3. Verify receipt finality and execution success, source/schema and canonical view.
4. Run clear A/B, tie/retry and reasons cases.

### Arc lane

1. Deploy exact escrow revision on Arc Testnet.
2. Verify USDC/operator/fee/payout/time configuration.
3. Use minimum supported stake/entrants.
4. Prove deposit, one settlement, credits, withdrawals/refund and zero liability.

### Full/browser lane

- Execute one bounded real provider generation pair.
- Link every match to a real GenLayer transaction.
- Submit final ranking with configured operator and read Arc credits.
- Run browser registration, status, verdict reason and withdrawal flow.

### Exit

- Evidence directories remain network-separated.
- Every claim has receipt + execution + canonical state evidence.
- Studio Dev evidence is never called durable Studionet evidence.
- No mainnet claim.

### Execution record — 2026-09-13

- GenLayer lane: V10 is the active Studionet deployment with a 16,384-byte
  per-agent ceiling, exact source/config/operator readback, one finalized
  deterministic boundary transaction and one finalized distinct-output semantic
  boundary transaction at 16 KiB per side. The semantic case reached
  `MAJORITY_AGREE/SUCCESS` and canonical `FINAL/A_WIN` (90-0). The 12 successful semantic match
  transactions in the completed eight-entrant lifecycle remain V9 evidence;
  their canonical verdicts and bounded reasons were re-read before V9 was
  archived as superseded.
- Arc lane: one eight-entrant tournament locked `0.008` USDC, paid `0.0072`
  USDC across Top 5, paid the fixed `0.0008` USDC fee to the owner and closed
  with zero liability. A separate retry-exhausted tournament opened refunds
  after its immutable expiry, returned the full `0.008` USDC principal across
  all eight wallets with zero platform fee, and closed with zero liability;
  18 unique recovery receipts finalized successfully.
- Provider lane: 27 authenticated successful calls used 108,751 tokens. The
  provider did not return cost fields, so the configured reservation is not
  represented as an invoice amount.
- Remaining Phase 12 work: complete the real browser-wallet lane. Script-signed
  network evidence does not substitute for browser-wallet proof.

## 19. Phase 13 — Release and submission

1. Map every claim to code, test, canonical view, UI and evidence.
2. State trusted-operator limitations prominently.
3. Review Git root, status, staged list, public allowlist and history for secrets.
4. Exclude `.handoffs/`, `.tools/`, `AGENTS.md`, `.env` and internal controls.
5. Verify CI, deployed revisions, live URL and explorer links.
6. Produce copy-ready submission text.
7. Obtain explicit authorization before push, hosting or final submission.

## 20. Lộ trình phát triển trust-minimized

Roadmap này chỉ bắt đầu sau MVP và không chặn Phase 1–13:

### TM-1 — Verifiable generation

Thay `ModelProviderPort` artifact bằng atomic ACI/TEE pair receipt. GenLayer hoặc
một verifier riêng xác thực workload, prompt/model/topic bindings và output bytes.

### TM-2 — Verifiable bracket/randomness

Chuyển roster, seed, pairing và topic authority từ backend sang Arc snapshot mà
GenLayer có thể xác thực tại exact block.

### TM-3 — Threshold GenLayer finality

Thay configured operator settlement bằng 3-of-5 independently operated EIP-712
finality statements và permissionless Arc delivery.

### TM-4 — Reciprocal deployment binding

Bind immutable Arc manager, GenLayer judge, source/destination chains, verifier
revision và schema; deploy bằng predicted Arc manager nonce.

### TM-5 — Native proof path

Thay committee bằng bridge/light client/succinct proof khi có cơ chế chính chủ và
được chứng minh trên target runtime.

Mỗi stage có migration flag/version mới; không đổi lặng lẽ authority của một
tournament đang chạy.

## 21. Stop conditions

Dừng batch hiện tại và quay về owner phase nếu:

- Coding Agent phải tự quyết định schema/trust/payout;
- một interface cần roadmap TM chưa được chọn để MVP chạy;
- Arc nhận payout amounts từ operator;
- backend advance từ tx hash mà không đọc canonical verdict;
- một-sided provider response được gửi đi judge;
- duplicate/retry có thể tạo side effect mới không kiểm soát;
- frontend trình bày backend state như trustless/onchain state;
- paid/network action chưa có authorization;
- batch chuẩn bị mở rộng ngoại lệ sang project khác hoặc claim gate `PASS`;

## 22. Definition of implementation complete

MVP chỉ hoàn tất khi:

- Arc, GenLayer, backend và frontend đều thực thi đúng authority ở mục 3;
- every match has persisted A/B mapping, final successful GenLayer transaction
  and canonical verdict;
- complete bracket deterministically produces Top 5;
- Arc settles once, derives 10%/90%, supports withdrawals/refunds and reaches
  zero liability;
- full local suite and authorized network/browser lifecycle pass;
- public claims disclose the operator trust boundary; and
- no roadmap trust-minimization mechanism is claimed before implementation and
  live evidence.

Đây là Definition of Done của **Tournament MVP**, không phải của toàn bộ
Evaluation Platform.

## 23. Evaluation Platform expansion — dependency-ordered phases

Các phase này là hướng triển khai tiếp theo đã được owner duyệt về sản phẩm.
Một bounded EVAL-0/EVAL-1/Level-2-policy feasibility slice đã có evidence; các
phần còn lại không được suy diễn từ slice đó. Mọi external/paid/network/value
action tương lai vẫn cần authority tương ứng tại thời điểm thực hiện.

### EVAL-0 — Evaluation protocol and authority freeze

**Status:** `BOUNDED SLICE COMPLETE`; provider envelope, response/action-proposal
schema, failure distinction, bindings, scorecard invariants and 12-scenario
golden corpus đã khóa cho Level 1/2. Full TestPack/RuntimePolicy/trace/report
protocol và Tournament migration boundary vẫn mở.

**Mục tiêu:** khóa ngôn ngữ và interface trước khi viết production behavior mới.

1. Định nghĩa `AgentVersion`, `TestPack`, `TestScenario`, `RuntimePolicy`,
   `EvaluationRun`, `ActionTrace`, `DeterministicFinding`, `SemanticScorecard`
   và `EvaluationReport`.
2. Tách các trạng thái `EMPTY_OUTPUT`, `PROVIDER_TIMEOUT`, `PROVIDER_ERROR`,
   `TOOL_ERROR`, `POLICY_VIOLATION`, `JUDGE_RETRYABLE`, `UNVERIFIABLE` và
   `INFRASTRUCTURE_ERROR`.
3. Khóa score dimensions, range, weights, threshold, missing-dimension policy,
   aggregate derivation và consequence eligibility.
4. Lập Evidence Authority Matrix cho scenario fixture, tool result, model output,
   deterministic finding, GenLayer judgment và optional Arc consequence.
5. Khóa canonical encodings/golden vectors và migration rule cho dữ liệu
   tournament hiện có.
6. `AGENTS.md` vẫn là active Agent profile duy nhất. `SKILL.md` chỉ là roadmap
   UI cho đến khi protocol riêng được duyệt.

**Exit:** schema không mâu thuẫn, authority rõ cho từng field, fixture vectors có
expected digests, và không field prose nào tự quyết định payout/certification.

### EVAL-1 — GenLayer scorecard feasibility gate

**Status:** `BOUNDED FEASIBILITY PASS` với `AgentEvaluationJudge` V5. Contract
lint và 27 direct tests pass; 24/24 selected paid-provider runs đạt expected
AGENTS-directed behavior sau một invalid-output retry; bốn bounded Studionet
scorecards ở cả hai mode đã FINALIZED với canonical reason readback. Đây chưa là
benchmark/certification stability claim.

**Mục tiêu:** chứng minh phần khó nhất trước khi mở rộng backend/frontend.

1. Viết prototype contract/revision riêng; không sửa im lặng semantics của
   deployed `ArenaMatchJudge`.
2. Nhận exact scenario/rubric/evidence bindings và trả scorecard có đủ dimension,
   bounded reasons, result class và evidence references.
3. Contract code xác thực enum, range, coverage, duplicate/extra/missing dimension,
   score/reason consistency và tự derive aggregate/result.
4. Kiểm thử cùng scenario khác Agent, cùng Agent lặp lại, A/B swap nếu pairwise,
   prompt injection, malicious leader JSON, contradictory reason, empty/oversize
   evidence và close-score stability.
5. Chạy direct suite trước; chỉ chạy bounded Studionet calibration khi được phép.

**Exit:** chỉ `PASS` khi contract cho kết quả đủ ổn định trên corpus khóa trước,
mọi output không hợp lệ fail closed/retryable, và lý do có ích khi audit. Nếu
không đạt, redesign rubric/schema trước; không xây platform UI để che blocker.

### EVAL-2 — Deterministic Level 2 proposal policy

**Status:** deterministic inert-action policy slice implemented and tested.
GenLayer, không phải backend, là authority cho qualitative score/result/reasons.
Executable sandbox là Level 3 roadmap và không còn là prerequisite của EVAL-3.

**Prerequisite:** `EVAL-0 PASS`; semantic integration chỉ được coi complete khi
`EVAL-1 PASS`.

1. Xây assertion engine cho action limit, required/forbidden/unknown action,
   confirmation và argument allowlist trên proposal chưa thực thi.
2. Ghi immutable proposal, deterministic findings và exact scenario/output
   digests; không ghi fabricated tool result hoặc state diff.
3. Deterministic facts không được LLM đảo ngược. GenLayer validators đánh giá
   instruction adherence, reasoning, action selection, rule compliance, task
   completion và safety.

**Exit:** cùng canonical scenario/output tạo cùng findings; backend không tự gán
score/result; mọi proposal được GenLayer chấm từ exact bound evidence; không có
external side effect.

### EVAL-3 — Evaluation persistence and APIs

**Status:** core `EvaluationRun` persistence, the production-shaped
`AgentEvaluationJudge` V5 adapter, allowlisted public/owner-private Run Detail
projections, immutable Test Pack versions and authenticated campaign
creation/status APIs are implemented locally. Campaign execution wiring and
full Test Pack editing remain open.

**Prerequisite:** bounded `EVAL-0`, `EVAL-1` và `EVAL-2` outputs ổn định.

1. Versioned stores cho Test Pack, Scenario, Runtime Policy, Run, Trace, Finding,
   Judge Operation, Scorecard và Report.
2. Stable IDs được tạo trước side effect và reuse qua retry/restart.
3. Hidden fixtures chỉ được đọc bởi authorized runner; public projection không
   lộ fixture, `AGENTS.md`, provider secret hoặc raw private trace.
4. Existing tournament records giữ nguyên schema lịch sử; adapter migration tạo
   shared read model, không rewrite evidence.

**Exit:** restart/race/idempotency, ownership, redaction và immutable-version
tests pass. The current partial slice proves run/provider/judge restart recovery,
but does not claim the full exit until API redaction and pack/version stores pass.

### EVAL-4 — Solo evaluation and Run Detail

**Status:** bounded local lifecycle pass. A multi-scenario runner creates a
domain-bound run per scenario/attempt, retries classified provider failures,
resumes pending GenLayer finality, and preserves campaign/run state in SQLite.
Run Detail read APIs redact `AGENTS.md`, raw provider bytes, operation keys and
hidden context from the public view. Campaign creation API/UI and generalized
Test Pack editing/version management remain open. Owner-authenticated APIs now
persist immutable pack versions and create deterministic campaign records bound
to one Agent version and pack version; the worker resumes those records through
the same campaign namespace.

**Prerequisite:** `EVAL-1`, `EVAL-2`, `EVAL-3 PASS`.

1. Chạy một AgentVersion qua một Test Pack không yêu cầu Arc.
2. Distinguish provider/infrastructure failure from Agent failure.
3. Merge deterministic findings và validated GenLayer scorecard theo locked
   policy; prose không override deterministic failure.
4. UI hiển thị bindings, timeline, tool trace đã redact, findings, semantic
   reasons, score dimensions, finality và retry state.

**Exit:** local lifecycle hoàn chỉnh, report tái đọc được sau restart và không có
generic/global Agent score ngoài Test Pack/runtime/scoring version.

### EVAL-5 — Version comparison and regression

**Status:** local implementation pass. The owner-only API compares two immutable
versions of the same Agent from separate finalized SOLO campaign cohorts. A
versioned deterministic policy locks exact pack/scenario/generation policy/rubric/run
comparability, repeated-run aggregation, coverage, variance, per-dimension
minimum/drop boundaries, aggregate drop and critical-finding zero tolerance.
Executed models may differ between finalized runs; their identities are recorded
without changing score or regression thresholds.
Records are immutable, redacted and restart-readable. No provider call, GenLayer
transaction or Arc action is performed by comparison.

**Prerequisite:** `EVAL-4 PASS`.

1. So sánh hai AgentVersion trên cùng exact pack/generation policy; model thực thi có thể khác nhau và phải được ghi nhận.
2. Hỗ trợ repeated runs và policy khóa cách aggregate variance.
3. Regression thresholds theo dimension, critical deterministic rule và minimum
   scenario coverage.
4. Không tuyên bố cải thiện khi sample/pack/generation policy/scoring version khác nhau.

**Exit:** baseline/candidate isolation, threshold boundary, partial-run và
infrastructure-error tests pass.

### EVAL-6 — Pairwise and Tournament migration

**Status:** implementation and exit regression pass. New Tournament attempts can
use the shared Evaluation provider envelope and specialized rich
`ComparisonRun`; legacy attempts remain immutable projections under their
original judge/rubric. `ArenaComparisonJudge` is deployed and smoke-verified on
Studio Next. Arc payout/refund inputs and arithmetic are unchanged.

**Prerequisite:** `EVAL-5 PASS` và backward-compatibility plan được audit. Both
entry artifacts are now locally satisfied; the approved plan is
`docs/EVAL-6-BACKWARD-COMPATIBILITY-PLAN.md`.

1. Map existing MatchAttempt thành specialized ComparisonRun.
2. Preserve deployed transaction/evidence links và historical result semantics.
3. Tournament progression chỉ consume eligible terminal comparison result.
4. Existing Arc 10% fee, payout, refund và zero-liability invariants không đổi.

**Exit:** historical tournament fixtures vẫn đọc đúng; tournament full-system
regression và new shared EvaluationRun conformance cùng pass.

### EVAL-7 — Benchmarks, reports and optional Arc economics

**Prerequisite:** `EVAL-6 PASS`.

**Current bounded slice:** `PairMatchEscrow` is deployed on Arc Testnet; room
deposit/refund API/UI and the pair comparison/settlement worker have local tests.
The live two-wallet deposit, GenLayer verdict, Arc settlement and withdrawal
lifecycle remains open; EVAL-7 has not passed. See `PAIR-MATCH-ESCROW.md` for
the room-specific safety cards and value matrix.

The owner-requested pre-release runtime hardening for shared signer nonce safety,
Pair finality recovery, process-wide provider concurrency, Tournament capability
and observability, worker readiness, proxy-aware rate limiting and release
verification is specified in
[`RUNTIME-CONCURRENCY-AND-OPERATIONS-HARDENING-SPEC.md`](RUNTIME-CONCURRENCY-AND-OPERATIONS-HARDENING-SPEC.md).
It is an ordered hardening overlay on the implemented EVAL-6/bounded EVAL-7
runtime, not a new product phase or an EVAL-7 completion claim.

1. Leaderboard luôn scope theo TestPack version, runtime/scoring policy và run
   count; không có universal score.
2. Shared report khóa AgentVersion/evidence references và trạng thái finality.
3. Arc chỉ bật khi campaign khai báo bounty/stake/reward/refund/fee; solo/internal
   evaluation mặc định không tạo transaction.
4. Certification nếu có phải bind exact AgentVersion + TestPack + scoring version,
   có expiry/revocation policy và không dựa trên một run đơn lẻ.

**Exit:** claim-to-code matrix, privacy review, benchmark gaming tests và mọi
value-destination/accounting invariant pass trước public release.

## 24. Evaluation Platform stop conditions

Dừng và redesign phase hiện tại nếu:

- “reasoning quality” bị hiểu thành thu thập hidden chain of thought;
- một score được hiển thị mà thiếu TestPack/runtime/scoring version;
- LLM prose có thể override deterministic safety/policy failure;
- provider timeout hoặc infrastructure error bị tính như Agent score zero;
- hidden fixture bị gửi nhầm vào Agent instructions hoặc public API;
- arbitrary user code/tool chạy ngoài sandbox;
- generalized frontend bắt đầu trước khi `EVAL-1` chứng minh judge feasibility;
- Arc được thêm vào evaluation không có value-bearing use case; hoặc
- dữ liệu/evidence Tournament MVP cũ bị rewrite hay relabel thành bằng chứng cho
  capability mới.
