# Kế hoạch Test-Driven Development — Tournament MVP và Evaluation Platform

## 1. Phạm vi

Kế hoạch này kiểm thử MVP đơn giản:

- backend trusted vận hành contestant `AGENTS.md`, bracket, API, mapping, retry và ranking;
- GenLayer quyết định semantic trên từng output pair đã submit;
- Arc giữ USDC và nhận final ranking từ configured operator;
- TEE/ACI, Arc-source quorum, threshold finality proof và reciprocal binding là
  post-MVP, không nằm trong completion gate.

Các prototype hiện có trong `spikes/` là characterization/future-hardening
evidence. Chúng không được dùng để tuyên bố production contract hay live flow.

Phần Tournament MVP bên dưới giữ nguyên regression authority cho code/evidence
hiện có. Hướng Evaluation Platform được owner duyệt ngày `2026-09-14` và có test
waves riêng tại mục 26; chưa wave nào ở đó được coi là implemented chỉ vì
Tournament suite đang green.

## 2. Luật RED → GREEN → REFACTOR

1. Mỗi behavior slice bắt đầu bằng test chạy được và fail tại assertion vì
   behavior còn thiếu.
2. Import/syntax/dependency/environment error hoặc zero selected tests không phải
   RED hợp lệ.
3. GREEN dùng implementation nhỏ nhất đáp ứng behavior và invariant đã khóa.
4. REFACTOR chỉ diễn ra sau focused GREEN và phải giữ regression cone green.
5. Không nới assertion, thêm retry mù hoặc skip test để đạt GREEN.
6. Test rejected path phải kiểm tra canonical state/accounting không đổi.
7. Coding Agent phải ghi RED/GREEN/result vào unique handoff result; primary
   agent tự chạy lại và thêm adversarial tripwire.

## 3. Definition of Ready

Một slice chỉ giao Coding Agent khi có đủ:

- phase prerequisite đã pass;
- exact allowed files và baseline hashes khi cần;
- public/private symbols và signature;
- state trước/sau;
- caller/time/idempotency/value rules;
- fixture mutations;
- exact test names, assertions và error messages;
- focused/regression commands;
- unique `.handoffs/results/*-RESULT.md`; và
- explicit forbidden surfaces.

Nếu thiếu một yếu tố có thể làm đổi hành vi sản phẩm, Coding Agent phải dừng thay
vì tự thiết kế.

## 4. Definition of Done

- RED hợp lệ được ghi lại.
- Focused suite pass đúng số test dự kiến.
- Required regression cone pass.
- Diff chỉ chứa allowed files.
- Không authority hoặc claim nào rộng hơn spec.
- No secret/network/paid/deploy action ngoài authorization.
- Primary audit ghi `ACCEPTED`; `REWORK` không mở phase tiếp theo.

## 5. Test levels

| Level | Mục tiêu | Không chứng minh |
| --- | --- | --- |
| Pure unit | IDs, schema, bracket, ranking, math, state guards | SDK/chain/provider |
| Component | DB, queue, provider adapter, receipt parser | Public network |
| Solidity unit/fuzz/invariant | Arc authorization/time/accounting/value | Deployed bytecode/liveness |
| GenLayer direct | Deterministic guards/storage | Real validator agreement |
| GenLayer consensus integration | Nondeterministic adjudication/equivalence | Arc settlement |
| Service integration | Idempotency, crash recovery, external adapters | Browser wallet/live networks |
| Browser-local | Real frontend adapter, provider selection, CORS path | Public transaction unless authorized |
| System local | Complete cross-component behavior | Testnet evidence |
| Network smoke | Exact frozen revisions on named networks | Untested branches/mainnet |

## 6. Test IDs

```text
DOM-*  domain/schema
BRK-*  bracket/ranking
DB-*   persistence/outbox/lease
ARC-*  Arc escrow
GLJ-*  GenLayer MatchJudge
INF-*  inference generation
GLT-*  GenLayer transaction tracker
COR-*  coordinator
SET-*  Arc settlement worker
FE-*   frontend/browser
SYS-*  local full system
NET-*  authorized network evidence
TM-*   post-MVP trust-minimization only
EVP-*  evaluation protocol/schema
EVJ-*  generalized GenLayer scorecard judge
POL-*  deterministic policy engine
SBX-*  side-effect-free tool sandbox
EVR-*  evaluation run/persistence/orchestration
CMP-*  version comparison/regression
BEN-*  benchmark/report/certification
```

Test name should state behavior, for example:

```text
test_finalized_execution_failure_does_not_advance_match
test_operator_cannot_supply_payout_amounts
test_partial_pair_never_reaches_genlayer_submission
```

## 7. Fixtures

### 7.1 Protocol golden vectors

Freeze JSON plus canonical bytes/digests for:

- tournament, entrant, round, match and attempt IDs;
- `AGENTS.md`, topic and output commitments;
- `JudgeSubmission` and normalized `JudgeVerdict`;
- `FinalRanking`, ranking digest and settlement ID;
- USDC 10%/90% math including rounding; and
- raw/normalized GenLayer receipt shapes.

Run the same vectors in TypeScript, Solidity and GenLayer Python wherever that
runtime consumes the field.

### 7.2 Time fixtures

Every public time-bounded write covers:

```text
boundary - 1
boundary
boundary + 1
```

Leave stored phase deliberately stale to prove each entrypoint checks transaction
time independently.

### 7.3 Provider fixtures

Include complete provider response shapes for:

- success A and B;
- timeout before request ID;
- timeout after request ID;
- one-sided success;
- malformed/truncated output;
- wrong model metadata;
- duplicate poll/result;
- rate limit and permanent rejection.

### 7.4 Semantic corpus

Minimum cases:

- clear A, clear B, legitimate tie, close call;
- every criterion tied except one;
- paraphrased reasoning with same criterion winners;
- prompt injection inside A/B output;
- missing/extra/duplicate criterion;
- invalid enum, swapped match/attempt and oversized reason;
- rationale contradicting the selected criterion winner;
- rationale attempting to define wallet/payout; and
- validator disagreement/temporary source failure -> `RETRYABLE`.

### 7.5 Token/wallet fixtures

- standard six-decimal USDC;
- false/no-return/reverting token behavior where relevant;
- allowance too low;
- EOA and compatible smart wallet path;
- account switch/disconnect/wrong network;
- exact zero and one-unit boundary values.

## 8. Proposed commands

Commands become required only after Phase 2 creates the scripts:

```powershell
npm run test:domain
npm run test:arc
npm run test:genlayer:direct
npm run test:genlayer:integration
npm run test:services
npm run test:frontend
npm run test:system
npm run typecheck
npm run build
npm run check
```

Current pre-scaffold characterization remains:

```powershell
$env:PYTHONUTF8='1'
python -m unittest discover -s spikes -p 'test_*.py'
python -m compileall -q spikes
```

## 9. Wave 0 — Architecture/policy characterization

### Prerequisite

Owner-approved simplified MVP architecture.

### Checks

- docs consistently say `TRUSTED_OPERATOR`;
- TEE/notary/Arc-source proof are post-MVP;
- GenLayer judges submitted bytes only;
- Arc trusts configured operator ranking but calculates amounts itself;
- old prototype tests still pass;
- no production source/dependency/network action is introduced.

### Exit

Documentation/link/terminology checks pass; the project-only exception is
explicit and does not silently upgrade any gate.

## 10. Wave 1 — Domain schema and deterministic tournament engine

### DOM-1 validation

RED cases:

- invalid timestamp order;
- fee not exactly 1000 BPS;
- payout BPS not 10000;
- unsupported entrant/rank count;
- zero/oversized stake;
- missing model/topic/rubric/operator version;
- mutable policy after first accepted entry.

GREEN locks validated constructors/parsers with field-specific errors.

### DOM-2 identifiers/encoding

- identical logical data -> identical bytes/digest;
- one field difference -> different digest;
- wrong chain/address/schema/version cannot collide;
- list order is either canonicalized or rejected by spec;
- bool is never accepted as integer in Python consumers;
- zero IDs/addresses rejected where identity is required.

### BRK-1 formation

For every supported count 8–32:

- expected preliminary matches and byes;
- no duplicate/missing entrant;
- deterministic output for same seed/policy;
- different tournament domain changes match IDs;
- no operator-provided arbitrary pairing after creation.

### BRK-2 progression/ranking

- only terminal A/B win advances;
- tie/retry does not advance;
- all previous round matches required;
- final/third/fifth paths produce unique Top 5;
- ancestry mismatch, duplicate rank, missing match and extra match reject;
- duplicate progression is a no-op/error without new state.

### DB-1 persistence

- unique entrant/match/attempt/inference/tx/progression/settlement effects;
- state and outbox job commit atomically;
- lease expiry allows recovery;
- stale worker cannot finalize a newer attempt;
- restart reconstructs work from DB without in-memory state.

### Exit Wave 1

Pure domain suite passes without blockchain/provider libraries.

## 11. Wave 2 — Shared protocol conformance

### PRT-1 schemas

Test valid/min/max values and reject missing/extra/wrong-type/wrong-version
fields for every cross-component payload.

### PRT-2 parity

TypeScript, Solidity and GenLayer Python consumers reproduce the same IDs,
digests and ranking math for golden vectors.

### PRT-3 mutation

Mutate every domain field individually and prove verification changes/rejects.
Special focus: match, attempt, A/B, output digests, ranking order, nonce and
operator.

### Exit Wave 2

No component needs to reinterpret another component's encoding.

## 12. Wave 3 — Arc escrow vertical slices

### ARC-1 constructor/config

- reject zero/wrong token, operator or fee recipient;
- fee fixed at 1000 BPS;
- payout sum exactly 10000;
- config locked after first stake;
- canonical views return exact values.

### ARC-2 create/open/register

For each write: wrong caller, wrong state, duplicate, time `-1/0/+1`, invalid
stake, failed token transfer and unchanged accounting on rejection.

Registration proves:

- exact wallet/agent/`AGENTS.md` commitment;
- exact USDC received;
- no duplicate agent/wallet entry per locked rule;
- fee not yet credited.

### ARC-3 close/run/cancel

- close/start only in allowed state/time;
- insufficient entrants -> refundable;
- expiry -> refundable under locked rule;
- cancellation creates full credits and zero platform fee;
- duplicate recovery creates no extra credit.

### ARC-4 operator settlement

- wrong operator rejects;
- wrong state rejects;
- wrong rank count, duplicate/non-entrant/zero wallet reject;
- ranking digest/nonce replay rejects;
- operator has no payout-amount input;
- contract derives fee/net/payout/remainder;
- credits atomically equal gross pool;
- settlement reference is stored but explicitly not a GenLayer proof.

### ARC-5 withdraw/close

- zero credit, wrong caller, duplicate withdrawal, reentrancy, failed transfer;
- ledger debit occurs before external call;
- fee recipient only receives fee credit;
- permissionless relayer payout always transfers to the credit beneficiary,
  never to the relayer or an alternate recipient;
- relayed fee payout always transfers to the immutable owner recipient;
- one failed relayed payout preserves its credit/liability and does not block
  successful payouts for other winners;
- close rejects while liabilities remain;
- full withdrawals allow zero-liability close.

### ARC-6 fuzz/invariant

Assert conservation after arbitrary allowed/rejected sequences. Mutate comparison
operators, replay guards and BPS math; no critical mutation may survive.

### Exit Wave 3

All Arc tests pass and every rejected value path preserves accounting.

## 13. Wave 4 — GenLayer MatchJudge vertical slices

### GLJ-1 metadata/storage

- correct Depends/runner/API family;
- exactly one recognized project-specific contract class;
- immutable rubric version and bounded criteria;
- canonical unknown/final view; pending and retryable transaction lifecycle is
  tested in the GenLayer tracker rather than duplicated in contract storage.

### GLJ-2 submission guards

- exact match/attempt IDs;
- output digests recomputed from exact bytes;
- non-empty bounded topic/output/reason fields;
- duplicate identical request is idempotent or rejected consistently;
- conflicting duplicate rejects with state unchanged;
- no wallet or payout fields accepted.

### GLJ-3 normalized verdict

- every expected criterion exactly once;
- no extra/duplicate/missing IDs;
- only `A/B/TIE` enums;
- derived aggregate matches deterministic rule;
- invalid leader-provided aggregate ignored/rejected;
- reason max length and summary max length;
- explanation cannot change aggregate or settlement.

### GLJ-4 semantic consensus

Run the corpus through leader and validator behavior. Compare critical structured
meaning, not identical prose. Clear cases must settle; ambiguous/invalid cases
must leave no terminal contract winner, and the Phase 7 tracker must map the
transaction outcome to `RETRYABLE` without inventing a verdict.

### GLJ-5 reasons

- reason references the correct criterion and evidence in A/B;
- paraphrases may differ while decision remains valid;
- contradiction/payout instruction is rejected or stripped to non-authoritative
  text according to the locked normalizer;
- canonical view exposes bounded reasons and summary.

### Exit Wave 4

Lint, direct tests and bounded consensus integration pass. No TEE receipt, Arc
snapshot, bracket or final ranking exists in the contract.

Observed checkpoint on `2026-09-11`: V2 lint/validation and 27 direct tests
pass. Its Studionet deployment finalized nine rationale-hardening cases: two
clarity/correctness contrasts, an exact A/B swap pair, and five identical
near-tie repetitions. Winner stability was 5/5 for that bounded near-tie pair;
the exact criterion vector was 4/5. This closes the early feasibility question,
not general statistical stability or Phase 7 tracker tests. Evidence:
`docs/evidence/studionet/`.

## 14. Wave 5 — Inference generation

### INF-1 canonical request

- A and B share wrapper/topic/model/generation policy/output bounds;
- only contestant `AGENTS.md` and side/agent mapping differ;
- stored `AGENTS.md` recomputes the registered commitment;
- provider input uses the versioned `arena-generation-input-v2` JSON envelope,
  preserving exact `agents_md` and `topic` strings without delimiter ambiguity;
- platform `system` instructions delegate reasoning/content/style to
  `AGENTS.md` and must not silently improve an intentionally weak strategy;
- fixed-topic swap/collision evals prove output traits move with `AGENTS.md`,
  while synthetic protocol-disclosure attempts remain blocked;
- unexpected policy/version rejects before provider I/O;
- `AGENTS.md` plaintext/output are not logged by default.

### INF-2 external operation identity

- persist before call;
- deterministic idempotency key;
- known response prevents another request;
- timeout with provider request ID enters reconciliation;
- rate limits use bounded backoff and budget checks.

### INF-3 atomic pair behavior

- both success -> `OUTPUTS_READY`;
- one success -> `PARTIAL_PAIR`, never judge submission;
- whole-pair retry creates new attempt;
- stale A from old attempt cannot pair with new B;
- swapped A/B/agent mapping rejects;
- output digests match stored bytes.

### INF-4 budget

- per-tournament cap;
- no player stake debit;
- duplicate usage callback does not double count;
- exhausted budget follows locked retry/cancel policy.

### Exit Wave 5

All provider behavior is proven with fixtures; no live paid call needed.

## 15. Wave 6 — GenLayer transaction tracker

### GLT-1 submission

- only complete pair may submit;
- submission persisted before RPC;
- exact judge address/network/schema/match/attempt;
- duplicate job recovers existing tx hash;
- ambiguous submission queries known state before retry.

### GLT-2 lifecycle parser

Cover raw and normalized shapes:

```text
SUBMITTED -> PENDING -> ACCEPTED/DECIDED -> FINALIZED
```

Lifecycle status alone is insufficient. Test finalized-success, finalized-
execution-failure, reverted, missing result, malformed receipt and wrong network.

### GLT-3 canonical read/mapping

- read expected judge contract;
- exact match/attempt required;
- valid criterion mapping/result required;
- map A/B through persisted match only;
- unique progression effect once;
- stale attempt result cannot advance current match.

### GLT-4 restart matrix

Crash after operation row, RPC submit, tx hash save, finality, canonical read and
progression commit. Every restart resumes without duplicate transaction or winner.

### Exit Wave 6

No match advances from tx hash, `ACCEPTED`, backend guess or execution failure.

## 16. Wave 7 — Tournament orchestrator

### COR-1 scheduler

- exact start time and stale-phase boundaries;
- only eligible tournament jobs;
- two schedulers race safely;
- missed wake-up is recovered from DB scan;
- players never need an online session.

### COR-2 complete tournament

Run 8, 13, 16 and 32 entrant representative paths plus property coverage for all
supported counts. Ensure every required main/placement match completes and Top 5
matches ancestry.

### COR-3 tie/retry/expiry

- first tie gets policy-selected next topic/new attempt;
- later tie uses frozen fallback;
- provider/GenLayer retry caps are separate and bounded;
- expiry cannot invent winner;
- refundable outcome requests Arc cancellation once.

### COR-4 worker races

Race generation, submission, polling, progression, next-round creation, ranking
and settlement jobs. Unique constraints and compare-and-set transitions prevent
double effects.

### Exit Wave 7

Fake-port tournament completes and all crash/race scenarios preserve one history.

## 17. Wave 8 — Arc settlement worker

### SET-1 final ranking validation

- complete bracket required;
- ranked entrants unique/registered;
- expected count and payout profile;
- deterministic ranking digest/nonce;
- linked GenLayer refs retained for audit.

### SET-2 Arc write/reconciliation

- configured operator only;
- operation persisted before send;
- receipt execution success and canonical credits required;
- timeout/restart reads tx and settlement view first;
- duplicate worker cannot send a second effective settlement;
- accounting mismatch -> recovery required, never backend complete.

### SET-3 honest boundary

Tests/UI payloads label the operator authorization as trusted. No field or message
calls ranking digest/GenLayer tx a cryptographic Arc proof.

### SET-4 automatic payout and fallback

- settlement credits remain the canonical ledger before any transfer;
- each Top 5 payout and owner fee is a separate resumable operation;
- canonical zero credit prevents an effective duplicate after restart;
- pending receipt resumes without a second send;
- one transfer failure does not stop unrelated beneficiaries;
- bounded retry exhaustion leaves the original pull credit withdrawable;
- closure occurs only after canonical zero liability.

### Exit Wave 8

One ranking yields one exact credit set and backend/Arc accounting agrees.

## 18. Wave 9 — API and frontend

### FE-1 API authorization/data minimization

- `AGENTS.md` owner access;
- no other user's `AGENTS.md` plaintext;
- public tournament/match result contains only intended fields;
- retries/admin actions require operator authorization and domain eligibility.

### FE-2 wallet

- EIP-6963 and injected fallback discovery;
- user chooses provider; no auto-pick;
- Arc chain switch/add;
- account validation, switch and disconnect;
- real SDK adapter omits invalid raw-string per-call account override;
- writes disabled without valid connection/config.

### FE-3 registration/withdrawal

- real adapter encodes exact tournament/agent/`AGENTS.md` commitment/stake;
- submitted/confirmed/failed states;
- canonical Arc reload after receipt;
- withdrawal refreshes credit/balance;
- duplicate UI action does not bypass contract state.

### FE-4 tournament/match display

- backend bracket clearly labeled platform-operated;
- GenLayer tx link, finality, execution, criteria, reasons and summary;
- `RETRYABLE`, tie, failed and recovery states distinct;
- backend complete cannot override Arc unsettled state.

### FE-5 browser-local

- all routes render in real browser;
- Arc wallet and GenLayer read routes avoid CORS/Failed to fetch;
- loading/empty/error/responsive/keyboard/accessibility checks;
- mock mode visibly development-only and disabled in production build.

### Exit Wave 9

Frontend suite, real-adapter preflight, typecheck and production build pass.

## 19. Wave 10 — Local full-system lifecycle

### SYS-1 happy path

Create, register, run all matches, finalize reasons/verdicts, produce Top 5,
settle twice, credit once, withdraw all and close at zero liability.

### SYS-2 provider/GenLayer recovery

Inject partial pair, provider timeout, submit timeout, receipt parser variants,
execution failure, retryable verdict and tie. Prove eventual deterministic result
without duplicate side effects.

### SYS-3 cancellation/refund

Insufficient entrants, retry exhaustion and expiry each return full stakes with
zero fee and no orphaned liability.

### SYS-4 adversarial operator inputs

Wrong `AGENTS.md` commitment, swapped outputs, stale attempt, malformed verdict,
wrong/non-entrant ranking, duplicate rank, arbitrary amount attempt, replayed
settlement and duplicate withdrawal all fail at the boundary that can enforce it.

The suite must also explicitly demonstrate the residual trust gap: a correctly
authorized operator can submit a valid-shape but dishonest ranking, and Arc cannot
detect divergence from GenLayer. This is an expected MVP limitation, not a test
failure or hidden claim.

### Exit Wave 10

`npm run check` passes and final local accounting is exact.

## 20. Wave 11 — Authorized network/browser evidence

### Prerequisite

Local full suite green, exact revisions frozen, current official network/tooling
verified and explicit action-time authorization granted.

### NET-GL

- optional Studio Dev RC compatibility deploy, separately labeled;
- stable target deploy receipt + execution success + code/schema readback;
- clear A/B, tie/retry and bounded reason result;
- transaction status plus canonical view.

### NET-ARC

- exact token/operator/fee/payout config;
- minimum-value registrations;
- successful operator settlement and exact credits;
- withdrawals/refund and zero liability;
- ambiguous transaction checked before retry.

### NET-FULL/FE

- one bounded real provider pair;
- backend A/B mapping to final GenLayer result;
- ranking submission and Arc credit readback;
- browser wallet registration/result/withdrawal without CORS failure.

### Exit Wave 11

Sanitized evidence is separated by network. No finalized execution failure, mock,
Studio Dev resettable state or read-only response is mislabeled as full evidence.

### Wave 11 execution record — 2026-09-13

- `NET-GL`: V10 deployment/readback exposes a 16,384-byte per-agent ceiling and
  has two finalized 16 KiB-per-side boundary transactions: one deterministic
  identical-output tie and one distinct-output semantic `A_WIN` at 90-0, both
  `MAJORITY_AGREE/SUCCESS`. The 12 finalized
  semantic lifecycle transactions and canonical-verdict/reason comparison are
  retained as historical V9 evidence rather than relabeled as V10 evidence.
- `NET-ARC`: 34 successful Arc receipts cover create/register/run/settle, five
  winner withdrawals, owner fee withdrawal and zero-liability closure; decoded
  withdrawal events total 7,200 + 800 micro-USDC from an 8,000 micro-USDC pool.
- `NET-FULL`: 27 successful paid-provider calls generated the complete pairs
  used by the successful bracket. Three failed one-sided calls were explicitly
  abandoned and never submitted as complete pairs.
- `NET-ARC-RECOVERY`: after expiry, 18 unique successful receipts opened
  refunds, claimed and withdrew all eight stakes, and closed the retry-exhausted
  tournament with zero locked stake, zero liability and zero platform fee.
- Still open: the real browser-wallet transaction lane. It remains open rather
  than being inferred from the script-signed lifecycle.

## 21. Regression cone

| Change | Focused | Required regression |
| --- | --- | --- |
| Schema/ID/digest | relevant DOM/PRT | domain + Arc + GenLayer + services + system |
| Bracket/ranking | BRK | domain + coordinator + settlement + system |
| Arc state/value/time | ARC slice | all Arc + settlement + frontend adapter + system |
| GenLayer deterministic/parser | GLJ | lint + direct + tracker + system |
| GenLayer semantic/rationale | corpus case | full corpus + integration + tracker/system |
| Provider adapter | INF | inference + coordinator + system |
| Receipt/finality | GLT | tracker + coordinator + frontend + system |
| Queue/DB/retry | DB/COR | services + affected system crash matrix |
| Wallet adapter | FE | frontend + real SDK preflight + browser-local |
| Dependency/runtime | install/build | full `npm run check` |
| Docs only | link/claim/terminology | no artificial unit tests |

## 22. CI gates

### Pull request

1. lockfile integrity/clean install;
2. format/lint;
3. domain/protocol;
4. Arc unit/fuzz bounded suite;
5. GenVM lint/direct;
6. service/frontend tests;
7. typecheck/build.

### Local full

- Arc invariants;
- GenLayer consensus integration;
- DB/queue/provider/receipt integration;
- browser-local;
- full system lifecycle;
- public-path/secret scan.

### Network

Manual, bounded, serial and explicitly authorized only.

## 23. Failure triage

Classify first:

```text
PRODUCT_BUG
TEST_BUG
FIXTURE_DRIFT
SPEC_CONFLICT
ENVIRONMENT
EXTERNAL_TRANSIENT
EXPECTED_TRUST_LIMIT
```

Do not fix production for environment failures, weaken assertions for product
bugs, or retry semantic cases until they produce a preferred winner.

## 24. Post-MVP trust-minimization tests

These test families are dormant until the corresponding roadmap stage is
explicitly activated:

- `TM-ACI-*`: attested atomic prompt/model/output pair receipt;
- `TM-ARC-SOURCE-*`: exact-block Arc snapshot quorum and no reroll;
- `TM-FINALITY-*`: independent threshold finality statements;
- `TM-BINDING-*`: reciprocal deployment/domain replay rejection;
- `TM-BRIDGE-*`: native proof/light-client verification.

Existing `spikes/phase1` tests remain regression coverage for those future
interfaces but do not block trusted MVP waves.

## 25. Definition of TDD complete

TDD is complete only when:

- every MVP state transition and write has valid RED/GREEN history;
- domain/TypeScript/Solidity/GenLayer schema parity passes;
- Arc accounting and time invariants pass;
- GenLayer direct plus semantic consensus tests pass;
- provider, finality tracker, coordinator and settlement restart/race suites pass;
- frontend real-adapter and browser-local suites pass;
- full system happy/retry/refund/adversarial paths pass;
- authorized network evidence confirms exact deployed revisions; and
- trust assumptions and residual operator attack are tested and disclosed rather
  than mislabeled as trustless behavior.

Mục này chỉ hoàn tất TDD của Tournament MVP. Evaluation Platform có completion
gate riêng dưới đây.

## 26. Evaluation Platform TDD waves

### Wave E0 — Protocol characterization (`EVAL-0`)

**Current evidence:** bounded Level 1/2 schemas, canonical bindings, provider
failure parsing and the 12-scenario/two-variant corpus are green. Full shared
TestPack/RuntimePolicy/trace/report characterization remains open.

#### EVP-1 schema and canonical bindings

RED cases must reject:

- mutable or missing Agent/TestPack/Scenario/RuntimePolicy versions;
- missing/extra/duplicate score dimensions;
- invalid score ranges, enums, weights or aggregate;
- run evidence bound to the wrong scenario, Agent version or attempt;
- a public projection containing hidden fixture or private Agent plaintext; and
- a universal score without pack/runtime/scoring identifiers.

Golden vectors cover canonical bytes/digests for every evaluation entity and
must be consumed identically by each runtime that uses them.

#### EVP-2 failure taxonomy

Table-driven tests distinguish `EMPTY_OUTPUT`, `PROVIDER_TIMEOUT`,
`PROVIDER_ERROR`, `TOOL_ERROR`, `POLICY_VIOLATION`, `JUDGE_RETRYABLE`,
`UNVERIFIABLE` and `INFRASTRUCTURE_ERROR`. No infrastructure/provider state may
silently become an Agent failure or score zero.

**Exit:** protocol, authority matrix, invariant table and vectors are frozen.

### Wave E1 — GenLayer scorecard feasibility (`EVAL-1`)

**Current evidence:** V5 passes GenVM lint and 27 direct tests. Four bounded
Studionet cases finalized with canonical scorecards/reasons across `RESPONSE`
and `ACTION_DECISION`. V1–V4 failure revisions are archived. This satisfies the
bounded feasibility gate, not broad repeatability or certification coverage.

#### EVJ-1 deterministic boundary

Direct tests cover exact run/scenario/rubric/evidence digests, size limits,
owner/operator authorization, idempotent duplicates, conflicting duplicates,
all required dimensions, bounded reasons and unknown/result views.

#### EVJ-2 semantic normalization

Validator output with valid JSON but invalid meaning must fail closed:

- duplicate/missing/extra dimensions;
- score outside range;
- reason contradicting selected class or evidence reference;
- aggregate/result inconsistent with locked weights/thresholds;
- deterministic policy fact reclassified by prose; and
- prompt text attempting to redefine authority, score policy or consequence.

Contract code derives aggregate/result after validation.

#### EVJ-3 stability corpus

Lock corpus groups for clear pass/fail, close calls, instruction hierarchy,
unsafe action selection, compliant refusal, over-refusal, hallucinated tool
success, conflicting rules, irrelevant verbosity, empty evidence and exact
repeat. Repeated runs measure allowed class/score-band variance; pairwise cases
also include exact A/B swap relations.

**Exit:** direct suite green and bounded consensus calibration meets the
predeclared stability threshold. If not, return to rubric/schema design; do not
advance to broad UI.

### Wave E2 — Level 2 proposal policy (`EVAL-2`)

**Current evidence:** `POL-1` has a bounded, side-effect-free action-proposal
slice for limits, unknown/duplicate/forbidden actions, confirmation and argument
allowlists. GenLayer remains the Level 2 qualitative evaluator; no tool execution
or backend-created score is claimed.

#### POL-1 objective assertions

Table-driven RED cases cover forbidden/unknown/duplicate action, confirmation
gate, argument allowlist and proposal count. Each rejected path proves no
external effect and an immutable finding with evidence reference.

**Exit:** proposal-policy facts are deterministic and cannot be overridden by
semantic score prose; GenLayer returns the qualitative score and reasons.

`SBX-1` reproducible tools and `SBX-2` executed trace integrity move to the
compute-dependent Level 3 roadmap. They are not prerequisites for Level 1/2,
EvaluationRun persistence or the initial `SOLO` lifecycle.

### Wave E3 — Evaluation persistence (`EVAL-3`)

**Current evidence:** the local `EvaluationRun` core persists immutable
Agent/scenario/provider bindings in SQLite, distinguishes provider terminal
states, persists GenLayer submission intent before send, deduplicates concurrent
submissions/polls, resumes a stored transaction after restart, and validates the
V5 canonical scorecard before finalizing. The SDK adapter is covered against the
exact V5 ABI order. Test Pack/version stores and public/private API projections
remain open.

The first pack/campaign boundary is also covered: a pack version is immutable
by `(packId, version)`, a campaign binds the selected Agent version, pack
version, rubric and runtime policy into a deterministic ID, and anonymous
campaign status contains no Agent plaintext, scenario context or provider
operation data. Owner listing and restart reload use the same SQLite namespace.

#### EVR-1 immutable version stores

Ownership, append-only versioning, hidden-fixture access, public redaction,
stable IDs, unique constraints and restart recovery are tested for every core
entity.

#### EVR-2 external operation ledger

Provider, tool and GenLayer operations are persisted before send. Duplicate or
concurrent workers reuse one operation; ambiguous completion reconciles existing
state before retry.

#### EVR-3 historical compatibility

Current Tournament fixtures and live evidence projections remain byte/read
compatible. Migration creates a shared read model without rewriting historical
transactions or verdict semantics.

**Exit:** restart/race/idempotency and privacy regression cone green.

### Wave E4 — Solo evaluation and report (`EVAL-4`)

**Current evidence:** a bounded two-scenario local runner completes through
provider output, one V5 transaction per scenario, finality and canonical
scorecard readback. SQLite restart, concurrent advance, repeated empty output,
failure-record/campaign-record crash recovery and pending-finality resume are
covered. Public/owner Run Detail routes are tested for redaction and ownership.
No paid provider call, tool execution or network write is implied by this local
suite.

The authenticated API can create those immutable pack/campaign records; a
separate execution worker advances the persisted campaign and exposes the same
public state through the status route.

#### EVR-4 complete solo lifecycle

One AgentVersion runs through a multi-scenario pack; deterministic findings and
validated GenLayer semantic scores merge under the locked policy. Tests cover
partial packs, retryable judge, provider failure, empty output, tool failure and
resume after restart.

#### FE-EVAL-1 Run Detail

Frontend tests cover bindings, state timeline, redacted action trace,
deterministic findings, semantic reasons, dimension scores, GenLayer reference,
retry/finality and explicit infrastructure failure. Hidden fixtures and private
Agent plaintext never appear publicly.

**Exit:** full local solo lifecycle and persisted report pass without Arc.

### Wave E5 — Comparison and regression (`EVAL-5`)

#### CMP-1 exact comparability

Reject comparison when TestPack, Scenario set, RuntimePolicy, model policy,
scoring version or required run count differs. Do not infer improvement from
non-comparable runs.

#### CMP-2 threshold boundaries

Test per-dimension minimums, critical-rule zero tolerance, aggregate deltas,
variance policy, exact threshold-minus/at/plus boundaries and incomplete runs.

**Exit:** candidate/baseline isolation and regression decisions are reproducible.

### Wave E6 — Pairwise/Tournament convergence (`EVAL-6`)

Existing `GLJ`, `COR`, `SET`, Arc and full-system suites remain mandatory.
Additional tests prove:

- MatchAttempt maps to the intended ComparisonRun once;
- historical A/B verdict and transaction links remain unchanged;
- only eligible terminal comparison results advance a bracket;
- scorecard additions cannot alter locked Arc payout math; and
- refund, retry exhaustion and zero-liability closure remain exact.

### Wave E7 — Benchmark/report/economics (`EVAL-7`)

#### BEN-1 scoped benchmark

Leaderboard rows require identical TestPack/runtime/scoring versions and declared
run counts. Sybil, cherry-pick, partial-run and stale-score cases are rejected or
clearly excluded from ranked results.

#### BEN-2 report/certification claims

Reports bind exact AgentVersion and evidence. Any certification additionally
requires minimum sample coverage, expiry and revocation semantics. One run cannot
produce a broad certification.

#### BEN-3 optional Arc value

Only value-bearing campaign modes enter Arc tests. Each new purse/bounty/reward
requires safety cards, value-destination rows, time boundaries, duplicate/retry
tests and zero-liability closure. Non-value evaluation remains offchain/GenLayer
without a decorative Arc transaction.

## 27. Evaluation regression cone and completion gate

| Change | Focused | Required regression |
| --- | --- | --- |
| evaluation schema/digest | EVP | policy + persistence + judge + report |
| semantic rubric/score | EVJ corpus | full EVJ + orchestrator + report |
| policy assertion | POL | sandbox + run + report |
| sandbox tool/trace | SBX | policy + persistence + solo lifecycle |
| persistence/worker | EVR | all affected lifecycle/restart/race tests |
| comparison threshold | CMP | solo + comparison + benchmark |
| tournament adapter | E6 | complete existing Tournament/Arc suite + E6 |
| benchmark/certification | BEN | comparison + privacy + claim checks |

Evaluation Platform TDD is complete only when E0–E7 acceptance relevant to the
declared release scope are green, `npm run check` remains green, authorized
network evidence exists for every network claim, and the UI distinguishes
implemented evidence from planned modes. Trust-minimization `TM-*` remains a
separate security roadmap.
