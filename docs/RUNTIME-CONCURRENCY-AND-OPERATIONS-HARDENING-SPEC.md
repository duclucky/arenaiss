# Đặc tả triển khai — Runtime concurrency và operational hardening

## 1. Trạng thái và authority

- Trạng thái: `READY FOR OWNER REVIEW`
- Phạm vi: hardening local cho runtime hiện có sau `EVAL-6` và bounded
  `EVAL-7 Pair` slice.
- Kiến trúc giữ nguyên: `TRUSTED_OPERATOR`.
- Mục tiêu: sửa các xung đột đã xác nhận trong nonce, Pair finality,
  provider concurrency, Tournament observability/capability, worker health và
  HTTP boundary trước một release mới.
- Tài liệu authority cao hơn vẫn là:
  `ADR-002-AGENT-EVALUATION-PLATFORM.md`, `IMPLEMENTATION-SPEC.md`,
  `TDD-PLAN.md` và `EXECUTION-STATUS.md`.
- Spec này không nâng gate, không chứng minh trustless execution, không thay
  đổi authority giữa backend, GenLayer và Arc.

Owner đã cho phép viết spec này. Spec không tự cấp quyền deploy, ký giao dịch,
gọi provider trả phí, dùng ví/key, push, publication hoặc thay đổi production.

## 2. Kết quả cần đạt

Sau khi triển khai xong:

1. Mọi transaction do cùng process gửi bằng cùng signer trên cùng network lane
   phải đi qua một coordinator dùng chung. Coordinator chỉ giữ khóa đến khi SDK
   trả transaction hash; việc chờ receipt/finality vẫn chạy đồng thời.
2. Pair có retry budget riêng cho provider, GenLayer submission, GenLayer
   finality và Arc settlement. Một transaction GenLayer đã biết hash phải tiếp
   tục được poll đến terminal/deadline; lỗi poll tạm thời không được làm cạn
   provider/submission budget.
3. Tổng số request model-provider đang thực thi trong một API process không
   vượt `30`, bao gồm `SOLO/Evo`, Pair, Tournament, primary và fallback.
4. Các Evo campaign độc lập được advance song song có giới hạn; một campaign
   chậm không chặn toàn bộ hàng đợi.
5. UI, API capability, README và runtime config thống nhất việc Tournament đang
   mở hay paused. Khi paused, lịch sử/claim vẫn đọc được nhưng không có CTA gửi
   deposit/signature.
6. Tournament snapshot báo đúng số comparison đang chờ và số match cần recovery
   khi nhiều trận cùng phase chạy đồng thời.
7. Liveness, readiness và worker diagnostics phân biệt rõ; public diagnostics
   không chứa secret, URL nội bộ hoặc raw upstream error.
8. Rate limit chỉ tin client identity do trusted proxy chuẩn hóa, mọi map có TTL
   cleanup/bound, và full local verification cùng release manifest đều green.

## 3. Ngoài phạm vi

- Không sửa Solidity hoặc GenLayer Intelligent Contract.
- Không đổi ABI, contract address, chain ID, USDC address/decimals, fee, payout,
  refund deadline hoặc value destination.
- Không đổi bracket, seed, topic selection, score/rubric hoặc semantic result.
- Không rewrite historical Tournament, Pair, EvaluationRun hoặc evidence.
- Không thêm Redis, message broker, database server hoặc dependency npm mới.
- Không triển khai distributed nonce management trong batch này. Runtime hiện
  tại chỉ được coi an toàn khi có đúng một API writer process cho mỗi signer.
- Không dùng mainnet và không tạo network evidence mới.

## 4. Baseline phải được giữ

Baseline tại thời điểm viết spec:

- nhánh `main`, HEAD `bae240e478909b9b30e807f21c48478028fe7ab9`;
- worktree sạch;
- Node tests không tính release manifest: `336/336` pass;
- frontend tests: `133/133` pass;
- frontend typecheck và production build pass khi build vào output tạm không bị
  Windows giữ lock;
- full `npm run check` hiện còn hai vấn đề không phải RED sản phẩm:
  GenVM direct-test cache gặp `WinError 5`, và local release-candidate manifest
  chưa được cập nhật sau hai commit concurrency.

Mọi batch phải giữ:

- exact Agent/Scenario/Comparison/Evaluation bindings;
- persisted idempotency keys và transaction hashes;
- finality + execution success + canonical readback trước progression/value;
- Arc ERC-20 USDC ở sáu decimal; native gas view không được cộng hoặc hiển thị
  thành tài sản thứ hai;
- Circle-managed wallet flows không đi qua operator nonce coordinator;
- secrets chỉ ở ignored runtime environment.

## 5. Kiến trúc đích

```text
                       one API process

  Solo ---------+
  Pair ----------+--> ProviderExecutionScheduler(max=30) --> provider HTTP
  Tournament ----+          | primary/fallback đều lấy permit

  Solo judge ----+
  Pair judge ----+--> TransactionSubmissionCoordinator
  Tour judge ----+          lane = GENLAYER:61997:<signer>
                            release immediately after tx hash

  Evo fee -------+
  Pair Arc ------+
  Tour Arc ------+--> TransactionSubmissionCoordinator
  Marketplace ---+          lane = ARC:5042002:<signer>
                            release immediately after tx hash

  workers -------> OperationalHealthRegistry ------> /readyz, /healthz
  config --------> CapabilitySnapshot -------------> /api/capabilities
```

Hai coordinator là process-local và được tạo đúng một lần tại composition root
`createArenaServer`. Không adapter nào được tự tạo coordinator riêng trong live
runtime.

## 6. Interface và invariant khóa trước code

### 6.1 Shared runtime primitives

Tạo `packages/operations/src/concurrency.ts` với các interface đề xuất:

```ts
export type TransactionSubmissionLane = {
  network: 'ARC' | 'GENLAYER';
  chainId: number;
  signerAddress: `0x${string}`;
};

export interface TransactionSubmissionCoordinator {
  submit<T>(lane: TransactionSubmissionLane, send: () => Promise<T>): Promise<T>;
  snapshot(): { activeLanes: number; queuedSubmissions: number };
}

export class InMemoryTransactionSubmissionCoordinator
  implements TransactionSubmissionCoordinator { /* implementation */ }

export interface ExecutionScheduler {
  run<T>(operation: () => Promise<T>): Promise<T>;
  snapshot(): { active: number; queued: number; limit: number };
}

export class BoundedExecutionScheduler implements ExecutionScheduler {
  constructor(limit: number);
}
```

Invariant:

- lane key là `network + chainId + lowercase signerAddress`;
- FIFO trong cùng lane;
- lane khác nhau chạy song song;
- `send` resolve hoặc reject đều nhả lane;
- coordinator không chờ receipt, canonical read hoặc finality;
- queue entry được xóa khi không còn active/waiter;
- scheduler không vượt limit, không mất permit khi reject/timeout và không giữ
  entry sau khi queue rỗng;
- callback được gọi đúng một lần; coordinator không retry callback.

Không truyền private key vào lane hoặc diagnostics.

### 6.2 Runtime composition

Tạo một object tại `createArenaServer`:

```ts
export type RuntimeConcurrency = {
  transactions: TransactionSubmissionCoordinator;
  providers: ExecutionScheduler;
};
```

Default live runtime:

- `transactions = new InMemoryTransactionSubmissionCoordinator()`;
- `providers = new BoundedExecutionScheduler(30)`.

`ServerOptions` nhận optional injected `runtimeConcurrency` chỉ để test/local
composition. Mọi factory active phải nhận đúng object này. Không dùng lại module
global tail cũ.

### 6.3 Pair evaluation progress V2

Tạo durable namespace `pair-room-evaluation-progress-v2`, key bằng `roomId`:

```ts
type PairEvaluationProgressV2 = {
  schema: 'arena-pair-evaluation-progress-v2';
  roomId: string;
  phase:
    | 'PROVIDER'
    | 'GENLAYER_SUBMISSION'
    | 'GENLAYER_FINALITY'
    | 'ARC_SETTLEMENT'
    | 'COMPLETE'
    | 'RECOVERY_REQUIRED';
  providerFailures: number;
  submissionFailures: number;
  finalityPollFailures: number;
  arcFailures: number;
  nextAt?: number;
  verdictTx?: string;
  lastFailureCode?: PairEvaluationFailureCode;
  updatedAt: number;
};
```

Retry policy khóa:

| Phase | Budget | Khi hết budget | Ghi chú |
| --- | ---: | --- | --- |
| Provider | 3 attempt | `RECOVERY_REQUIRED` hoặc chờ refund policy hiện hữu | Không gửi one-sided output |
| GenLayer submission chưa biết hash | 3 attempt | `RECOVERY_REQUIRED` | Reconcile canonical/submission store trước retry |
| GenLayer finality đã biết hash | Không dùng attempt cap | Poll có backoff đến resolution deadline | Không resubmit |
| Arc settlement | 3 send/reconcile attempt | `RECOVERY_REQUIRED`; credit/refund contract state không bị đoán | Re-read Arc trước send lại |

`finalityPollFailures` chỉ là diagnostic counter có saturation; không chặn poll.
Backoff phải bounded, không vượt thời điểm resolution deadline. Đến deadline,
contract timeout/refund path hiện hữu vẫn authoritative.

Migration khi lần đầu đọc room cũ:

1. Nếu có `pair-room-settlement-intents`, phase là `ARC_SETTLEMENT`.
2. Nếu `comparison-submissions` có transaction hash, phase là
   `GENLAYER_FINALITY`, copy hash và không mang retry count cũ sang budget chặn.
3. Nếu chưa có hash nhưng submission state tồn tại, phase là
   `GENLAYER_SUBMISSION`.
4. Còn lại dùng retry count cũ làm `providerFailures`, tối đa `3`.
5. Migration chỉ ghi local SQLite; không gọi provider/GenLayer/Arc.
6. Không xóa namespace cũ trong cùng release. Chỉ ngừng ghi mới sau khi V2 đã
   được tạo; dữ liệu cũ giữ để rollback/audit.

### 6.4 Provider scheduler

`OpenAICompatibleEvaluationProvider` nhận một `ExecutionScheduler`. Scheduler
bao quanh từng network request trong private method `request`, không bao quanh
parse/persist và không giữ permit giữa primary failure và fallback request.

Mỗi primary/fallback HTTP request lấy đúng một permit. Khi primary transient
fail, permit được nhả rồi fallback xếp hàng lấy permit mới.

Xóa limiter/module globals khỏi `TournamentEvaluationPairRunner`. Pair và
Tournament tiếp tục chạy A/B đồng thời; cap được enforce ở provider boundary.

Phạm vi cap: mọi active `OpenAICompatibleEvaluationProvider` được tạo bởi
`server.ts`, `tournament-operations-live.ts` và `pair-settlement-live.ts` phải
dùng cùng scheduler. `packages/inference` và live scripts lịch sử không nằm
trong active API runtime; không sửa chúng trong batch này.

### 6.5 Evo campaign concurrency

`EvaluationExecutionService` nhận `maxConcurrentCampaigns`, default `8`, hợp lệ
từ `1..30`. `evaluationExecutionFromEnvironment` đọc
`EVALUATION_WORKER_CONCURRENCY`, default `8`, reject giá trị ngoài range.

`resumePending` dùng bounded worker pool, không dùng `Promise.all` không giới
hạn. Thứ tự candidate vẫn sort theo campaign ID để có queue order ổn định.
Lease `evaluation-campaign-advance` tiếp tục bảo vệ từng campaign. Một campaign
fail không cancel các campaign khác. Tổng provider HTTP concurrency vẫn do
provider scheduler giới hạn `30`.

### 6.6 Capability schema

Public endpoint mới: `GET /api/capabilities`.

```ts
type ArenaCapabilitiesV1 = {
  schema: 'arena-capabilities-v1';
  environment: 'TESTNET';
  tournament: {
    visible: true;
    operationEnabled: boolean;
    registrationEnabled: boolean;
    reasonCode?: 'OPERATOR_PAUSED' | 'NOT_CONFIGURED' | 'DEGRADED';
  };
  pair: { enabled: boolean; reasonCode?: 'NOT_CONFIGURED' | 'DEGRADED' };
  evaluation: { enabled: boolean; reasonCode?: 'NOT_CONFIGURED' | 'DEGRADED' };
};
```

Không trả tên/missing value của secret, upstream URL, signer, balance hoặc raw
error. Tournament rules:

- `operationEnabled = Boolean(tournamentOperations)`;
- `registrationEnabled = operationEnabled && ARENA_TOURNAMENTS_PAUSED !== '1'`
  và health không degraded;
- paused vẫn `visible=true` để lịch sử, bracket, claim/refund đọc được;
- API registration vẫn enforce cùng capability ở server, không chỉ UI.

`compose.yaml` dùng `${ARENA_TOURNAMENTS_PAUSED:-1}` thay vì literal `"1"`.
Default release vẫn paused cho đến khi owner chủ động cấu hình và release checks
pass. Spec này không tự unpause production.

### 6.7 Tournament concurrent status

Không thêm canonical state mới. `LiveTournamentOperations.toSnapshot` derive:

- `pendingCount` = số public match của tournament có state `JUDGING`;
- `recoveryRequiredCount` = số public match có state `RETRYABLE`;
- `finalizedCount` tiếp tục từ canonical result/progression count hiện hữu.

Thêm optional `recoveryRequiredCount` vào
`TournamentOperationSnapshot.genLayer`. Public matches đã persist trong
`api-matches`, nên restart phải đọc lại được. Với legacy record không có match
projection, chỉ được fallback `pendingCount=1` khi aggregate state là
`WAITING_FOR_JUDGE`; không được fabricate nhiều match.

### 6.8 Operational health

Tạo `services/api/src/operational-health.ts`:

```ts
type WorkerState = 'STARTING' | 'HEALTHY' | 'DEGRADED' | 'DISABLED';
type WorkerHealth = {
  state: WorkerState;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  consecutiveFailures: number;
  errorCode?: string;
};
```

Registry nhận clock để test và chỉ expose allowlisted component names/codes.
Không giữ `Error.message` trong public snapshot.

Endpoint:

- `/livez`: process liveness, luôn `200 {"status":"ok"}` khi event loop phục vụ.
- `/readyz`: `200 {"status":"ok"}` hoặc `503` với safe component codes.
- `/healthz`: compatibility alias của readiness; healthy response vẫn đúng
  `{"status":"ok"}` để không phá release verifier hiện hữu.

Worker enabled phải report attempt/success/failure:

- evaluation worker;
- Pair settlement worker;
- Daily Tournament worker;
- startup CCTP/USDC resume.

Optional worker `DISABLED` không làm readiness fail. Feature được cấu hình/enabled
nhưng thiếu dependency phải là `DEGRADED`. Heartbeat stale sau hơn ba interval
cộng 5 giây phải làm readiness `503`. Có startup grace bằng hai interval.

`compose.yaml` API healthcheck chuyển sang `/readyz`; Caddy proxy thêm `/livez`
và `/readyz`. Public response không chứa campaign/room/user ID.

### 6.9 Proxy-aware rate limit và TTL maps

API không tin raw `x-forwarded-for` mặc định.

- Khi `ARENA_TRUST_PROXY !== '1'`, identity là `socket.remoteAddress`.
- Khi bật trusted proxy, API chỉ đọc header nội bộ `x-arena-client-ip` do Caddy
  overwrite. Client-supplied value phải bị Caddy xóa/ghi đè.
- Trước khi sửa Caddyfile, implementation batch phải kiểm tra cú pháp hiện hành
  từ official Caddy docs và xác nhận Cloudflare Tunnel → Caddy client-IP chain.
- Direct-origin port phải bind loopback theo default deployment, hoặc có rule
  tương đương ngăn public bypass. Không được tin `CF-Connecting-IP` từ một
  request đi thẳng vào origin.

`FixedWindowRateLimiter`:

- prune window hết hạn ít nhất một lần mỗi `windowMs`;
- có `maxEntries`, default `10_000`;
- sau prune, identifier mới khi map đầy dùng một bounded overflow bucket hoặc
  bị 429 theo policy cố định; không tạo entry mới;
- server close clear timer/map;
- log không chứa client IP/header/cookie.

Auth TTL:

- challenge, wallet/email session và email OTP được prune lazily trước
  `set/get`, và định kỳ nếu server đang chạy;
- expired record không authenticate;
- cleanup không ghi token, email, signature hoặc OTP ra log;
- provisioning/transfer promise maps vẫn cleanup bằng `finally` như hiện tại.

Có thể tạo `BoundedExpiringMap` trong `packages/operations/src/expiring-map.ts`
để ẩn TTL/capacity logic; không expose test-only mutation method vào production
API.

## 7. Thứ tự triển khai bắt buộc

Mỗi batch dưới đây là một RED → GREEN → REFACTOR độc lập. Regression test của
behavior phải được viết và chạy RED ngay đầu batch sở hữu behavior; không commit
hoặc handoff một trạng thái chỉ có test đỏ. “Batch 1” khóa exact test contract,
không đưa skipped/pending test vào suite.

### Batch 1 — Freeze regression tests và fixtures

**Prerequisite:** audit hiện tại được chấp nhận; không có source edit khác chen
vào cùng file.

Tạo test IDs/names sau trong handoff của batch sở hữu chúng:

| ID | Test file | Exact behavior |
| --- | --- | --- |
| `OPS-NONCE-1` | `packages/operations/test/concurrency.test.ts` | cùng lane có peak send `1`; lane khác đạt peak `>1` |
| `OPS-NONCE-2` | cùng file | send thứ hai bắt đầu sau hash thứ nhất nhưng trước receipt thứ nhất |
| `OPS-NONCE-3` | cùng file | rejected send nhả queue và xóa idle lane |
| `PAIR-FINALITY-1` | `services/api/test/pair-settlement.test.ts` | ba poll lỗi sau known tx không dừng lần poll thứ tư/final settlement |
| `PAIR-FINALITY-2` | cùng file | restart với legacy retry=3 + known tx migrate sang finality và không resubmit |
| `PROVIDER-CAP-1` | `packages/evaluation/test/provider.test.ts` | 45 calls qua ba provider instances có peak đúng `30` |
| `PROVIDER-CAP-2` | cùng file | primary 429/timeout rồi fallback vẫn không vượt `30`, permit không leak |
| `TOUR-STATUS-1` | `services/api/test/tournament-operations-live.test.ts` | hai match `JUDGING` trả pendingCount `2` sau restart |
| `TOUR-STATUS-2` | cùng file | pending và recovery được đếm riêng |

Fixture rules:

- barrier/deferred promise thay cho sleep;
- fake transaction result phải phân biệt `hash resolved` và `receipt resolved`;
- provider fixture không gọi network;
- Pair fixture persist real namespace shapes, không gọi private method;
- Tournament fixture phải dùng public `execute/get` hoặc persisted public match
  projection, không assert implementation-only map.

**Exit:** exact test contracts được ghi vào task packet. Mỗi owning batch chứng
minh RED hợp lệ trước GREEN; syntax/import/environment failure không được tính.

### Batch 2 — Shared transaction coordinator

**Prerequisite:** `OPS-NONCE-*` đã RED hợp lệ.

Allowed/new files:

- `packages/operations/src/concurrency.ts`
- `packages/operations/test/concurrency.test.ts`
- `packages/genlayer/src/comparison-sdk-port.ts`
- `packages/genlayer/src/evaluation-sdk-port.ts`
- corresponding GenLayer adapter tests
- `services/api/src/server.ts`
- `services/api/src/tournament-operations-live.ts`
- `services/api/src/evo-fee-arc.ts`
- `services/api/src/marketplace-arc.ts`
- `services/api/src/pair-settlement-live.ts`
- corresponding service adapter/composition tests
- `scripts/check.ps1` chỉ để đăng ký test mới.

Implementation order:

1. Implement FIFO lane coordinator và snapshot/cleanup.
2. Thay module-global `transactionSendTail` ở comparison SDK bằng injected
   coordinator.
3. Bắt buộc evaluation SDK dùng cùng coordinator/lane GenLayer.
4. Inject cùng Arc coordinator vào Tournament, Evo, Pair và Marketplace
   operator adapter.
5. Wrap đúng `writeContract`/GenLayer `writeContract`; simulation/fee estimation
   được chạy trước queue, receipt/finality chạy sau queue.
6. Tạo coordinator một lần ở `createArenaServer`, truyền xuyên qua mọi active
   factory.
7. Thêm adapter tests chứng minh mỗi write đi qua expected lane.

Stop conditions:

- cần tự chọn explicit nonce;
- SDK không trả hash trước khi chờ finality;
- một adapter không thể nhận coordinator mà phải fork/vendor SDK;
- cần sửa contract/ABI hoặc private key handling.

Acceptance:

- `OPS-NONCE-*` green;
- Tournament + Evo + Pair + Marketplace Arc adapter contract tests green;
- Solo + Tournament/Pair GenLayer adapter contract tests green;
- receipt barriers chứng minh không serialize finality;
- no raw key/signer diagnostic.

### Batch 3 — Pair finality state và retry budgets

**Prerequisite:** Batch 2 accepted; `PAIR-FINALITY-*` RED hợp lệ.

Allowed files:

- `services/api/src/pair-settlement.ts`
- `services/api/src/pair-settlement-live.ts`
- `services/api/src/pair-rooms.ts` nếu chỉ mở rộng safe public progress fields
- `services/api/test/pair-settlement.test.ts`
- `frontend/src/views/PairMatches.tsx` và test Pair tương ứng nếu copy/state đổi.

Implementation order:

1. Add V2 progress record và pure migration function.
2. Split `PairOutcome` thành explicit provider/submission/finality/final/recovery
   outcomes; worker không phân loại phase bằng regex message.
3. Persist known verdict tx ngay khi tracker store biết hash.
4. Apply retry counter theo phase; finality poll counter không chặn.
5. Reconcile existing comparison submission before any submit retry.
6. Reconcile Arc room/settlement intent before any settlement retry.
7. Map progress về safe `evaluationStage`, failure code và UI copy hiện hữu.
8. Giữ refund deadline/mutual cancellation/value logic không đổi.

Required RED/GREEN cases ngoài `PAIR-FINALITY-*`:

- provider failure thứ ba dừng provider generation nhưng không tạo winner;
- GenLayer busy trước known hash dùng submission budget;
- known hash không bao giờ gọi submit lần hai;
- finalized execution failure vào recovery, không settle Arc;
- Arc send timeout có persisted intent và readback trước send lại;
- migration idempotent khi chạy hai lần;
- deadline luôn mở đúng refund path dù retry state nào.

### Batch 4 — Provider cap toàn cục và Evo parallelism

**Prerequisite:** Batch 3 accepted; `PROVIDER-CAP-*` RED hợp lệ.

Allowed files:

- `packages/operations/src/concurrency.ts`
- `packages/evaluation/src/provider.ts`
- `packages/evaluation/src/tournament-runner.ts`
- `packages/evaluation/test/provider.test.ts`
- `packages/evaluation/test/tournament-runner.test.ts`
- `services/api/src/evaluation-execution.ts`
- `services/api/src/server.ts`
- `services/api/src/tournament-operations-live.ts`
- `services/api/src/pair-settlement-live.ts`
- related service tests and `.env.example`.

Implementation order:

1. Inject shared provider scheduler vào mọi active provider instance.
2. Move permit acquisition to provider `request` boundary.
3. Remove Tournament module-global limiter và duplicate constants.
4. Add `EVALUATION_WORKER_CONCURRENCY` validation/default.
5. Implement bounded Evo campaign worker pool.
6. Preserve per-campaign lease, deterministic candidate order and failure
   isolation.

Additional tests:

- 10 Solo calls cùng 22 Tournament/Pair-side calls vẫn peak `30`;
- queued call starts after one rejection releases permit;
- one slow Evo campaign does not prevent another from entering `advance`;
- peak campaigns không vượt configured value;
- two ticks vẫn coalesce qua `EvaluationExecutionWorker.active`;
- fallback consumes its own permit after primary releases.

Không tăng cap trên `30` trong spec này. Config campaign không được dùng để
override provider cap.

### Batch 5 — Capability endpoint và Tournament consistency

**Prerequisite:** Batch 4 accepted. Schema phải reserve `DEGRADED`, nhưng Batch 5
chỉ emit `OPERATOR_PAUSED`/`NOT_CONFIGURED`; Batch 6 mới nối worker health vào
capability mà không đổi schema.

Allowed files:

- `services/api/src/http.ts`
- `services/api/src/server.ts`
- service HTTP tests
- `frontend/src/adapters/interfaces.ts`
- new `frontend/src/adapters/capabilities.ts`
- `frontend/src/context.tsx`
- `frontend/src/views/Home.tsx`
- `frontend/src/views/Tournaments.tsx`
- `frontend/src/views/SubmitEntry.tsx`
- affected frontend tests
- `compose.yaml`, `.env.example`, `README.md`, `frontend/src/views/Docs.tsx`.

Required behavior/tests:

- paused: capability says visible/open history but registration disabled;
- paused Tournament page has no `Enter tournament` link;
- direct `/submit` route shows paused explanation and requests no wallet
  signature/approval/deposit;
- enabled + configured + open schedule shows CTA;
- unconfigured returns `NOT_CONFIGURED`, not raw env names;
- POST prepare/managed registration and UI use the same policy;
- README/Home/Docs make no unconditional claim that registration is active;
- Compose default remains paused and can only be overridden explicitly.

Copy rule: distinguish “Tournament mode and historical results are available”
from “registration is currently enabled”.

### Batch 6 — Readiness, heartbeat và safe diagnostics

**Prerequisite:** Batch 5 accepted.

Allowed files:

- new `services/api/src/operational-health.ts`
- `services/api/src/server.ts`
- `services/api/src/http.ts`
- `services/api/src/evaluation-execution.ts`
- `services/api/src/pair-settlement.ts`
- `services/api/src/daily-tournament.ts`
- `services/api/src/managed-identity.ts`
- corresponding tests
- `compose.yaml`, `deploy/Caddyfile`, `docs/DEPLOYMENT.md`.

Required tests:

- liveness stays 200 while an enabled worker is degraded;
- readiness/health return 503 with safe code for stale/failing worker;
- one later successful tick resets consecutive failures;
- disabled optional worker does not fail readiness;
- feature enabled but missing dependency fails readiness/capability;
- raw error containing private URL/token-like text never appears in response or
  structured public diagnostic;
- startup resume rejection is recorded instead of swallowed;
- clock-driven stale test uses fake clock, không sleep.

Worker domain retry/recovery is not automatically a worker failure. Readiness
fails khi scheduler không chạy, dependency/config bắt buộc hỏng hoặc tick ném
uncaught error; một room/campaign hợp lệ đang `RETRYING` không làm toàn API
unready.

### Batch 7 — Proxy-aware rate limit và TTL cleanup

**Prerequisite:** Batch 6 accepted; current official Caddy client-IP/trusted
proxy syntax đã được kiểm tra và ghi trong task result.

Allowed files:

- `packages/operations/src/expiring-map.ts`
- `packages/operations/test/expiring-map.test.ts`
- `services/api/src/server.ts`
- `services/api/src/http.ts`
- `services/api/src/managed-identity.ts`
- related tests
- `deploy/Caddyfile`, `compose.yaml`, `.env.example`, `docs/DEPLOYMENT.md`
- `scripts/check.ps1` để đăng ký test.

Required tests:

- direct request giả `x-forwarded-for` không đổi bucket;
- trusted mode chỉ dùng overwritten `x-arena-client-ip` hợp lệ;
- malformed/multiple client-IP value fallback/reject theo policy khóa;
- hai canonical client IP có bucket riêng;
- expired rate windows được prune;
- hơn `maxEntries` không làm map tăng;
- expired challenge/session/OTP không authenticate và được prune;
- active challenge/session/OTP không bị prune sớm;
- cleanup không log key/value nhạy cảm.

Deployment acceptance local:

- request qua Caddy nhận canonical client identity;
- request trực tiếp vào API không tin proxy header;
- origin bind không tạo public bypass theo Compose config;
- `/api`, `/healthz`, `/readyz`, `/livez` vẫn same-origin.

### Batch 8 — Full verification và release manifest

**Prerequisite:** Batch 1–7 accepted, worktree chỉ có intended changes.

Tạo `scripts/update-release-candidate.mjs` hoặc một pure shared manifest helper
được `tests/system/release-candidate.test.ts` dùng lại. Không được copy hai bản
khác nhau của digest algorithm.

Generator phải:

- dùng đúng included roots/files hiện tại;
- sort path và hash đúng schema V1;
- cập nhật `fileCount`, `sourceBundleSha256`, `createdAt` và digest của toàn bộ
  existing critical files;
- thêm các runtime primitive/health/capability files quan trọng vào
  `criticalFiles`;
- không include `.env`, `.tools`, `.handoffs`, runtime DB, cache, build output,
  wallet/evidence private hoặc `AGENTS.md`;
- không thay đổi deployment evidence lịch sử.

Verification order:

1. Focused Node suites của từng batch.
2. Full Node suite từ `scripts/check.ps1`, xác nhận test count thực tế và zero
   failure.
3. `npm --prefix frontend run typecheck`.
4. `npm --prefix frontend run test:run`.
5. `npm --prefix frontend run build`; nếu default `dist` bị Windows lock, dùng
   output tạm cho diagnosis, sau đó giải phóng lock và chạy đúng release build.
6. GenVM lint và Python direct tests với `GENVM_VERSION=v0.6.0-rc5`.
7. `forge test`.
8. Chạy manifest generator, rồi
   `node --test tests/system/release-candidate.test.ts`.
9. Chạy `npm run check` từ clean relevant state; yêu cầu exit code `0`.
10. `git status --short`, final diff, secret/public-path scan và
    `git check-ignore` cho `AGENTS.md`, `.tools/`, `.handoffs/`.

`WinError 5`, locked build output, dependency/cache lỗi hoặc zero selected tests
được phân loại `ENVIRONMENT`; không phải RED hợp lệ và không được chữa bằng sửa
production assertion. Phải xử lý đúng exact local path/quyền, chạy lại và ghi
evidence. Không xóa cache/dir rộng hoặc dùng destructive command mơ hồ.

Batch này không commit, push hoặc deploy trừ khi owner cấp lệnh riêng sau khi
đọc final diff và verification report.

## 8. Regression cone theo loại thay đổi

| Thay đổi | Focused | Required regression |
| --- | --- | --- |
| Coordinator/nonce | `OPS-NONCE`, adapter tests | GenLayer tracker + Tournament + Pair + Evo + Marketplace services |
| Pair state/retry | `PAIR-FINALITY` | Pair room/API/UI + Arc refund/accounting + GenLayer tracker |
| Provider scheduler | `PROVIDER-CAP` | provider + Solo + Tournament runner + Pair + system convergence |
| Evo parallel worker | evaluation execution | Solo runner + fee settlement/refund + restart/lease |
| Tournament snapshot | `TOUR-STATUS` | daily worker + operator HTTP + frontend Tournament UX |
| Capability/copy/config | API + frontend | registration + Home/Docs + compose config assertions |
| Health/worker | server/worker | deployment health tests + backup/start/stop behavior |
| Proxy/rate/TTL | HTTP/server/managed identity | auth, email, Pair/Evo mutations, secret-free logs |
| Manifest/tooling | release candidate | full `npm run check` |

## 9. Coding Agent packet boundaries

Nếu giao external Coding Agent, mỗi batch phải dùng một unique result path dưới
`.handoffs/results/` và nêu:

- exact prerequisite commit/hash;
- allowed files ở batch tương ứng;
- exact test names/assertions/error codes;
- RED command và expected failing assertion;
- implementation algorithm ở spec này;
- focused/regression commands;
- forbidden contract/dependency/network/secret surfaces;
- return format `DONE: <result-path>` hoặc `BLOCKED: <result-path>`.

Không giao cùng lúc hai batch ghi chung `server.ts`, `http.ts`, provider hoặc
Pair state. Batch sau chỉ bắt đầu khi primary audit batch trước là `ACCEPTED`.

## 10. Stop conditions và redesign triggers

Dừng batch và báo owner nếu:

- runtime thực tế có nhiều API writer process dùng cùng signer;
- GenLayer SDK không trả transaction hash trước finality;
- known transaction không thể reconcile bằng stored hash/canonical key;
- sửa retry làm thay đổi Pair refund deadline hoặc Arc accounting;
- capability cần tiết lộ secret/config value cụ thể cho frontend;
- proxy chain không thể xác thực client identity mà origin vẫn public;
- full checks phát hiện contract/schema/evidence drift ngoài phạm vi;
- implementation cần dependency, contract redeploy, paid call hoặc network write;
- release manifest chỉ có thể green bằng bỏ file khỏi bundle hoặc nới assertion.

Các trường hợp này là `REDESIGN` hoặc cần authority mới, không được tự workaround.

## 11. Definition of Done

Spec được triển khai hoàn tất khi và chỉ khi:

- tất cả test IDs ở Batch 1 có RED hợp lệ và GREEN cuối;
- cùng signer/same lane có peak send bằng `1`, nhưng receipt/finality vẫn có thể
  overlap;
- Pair finalizes sau transient poll failures mà không resubmit known tx;
- peak provider HTTP toàn active API runtime không vượt `30`;
- Evo campaign độc lập advance song song bounded và restart-safe;
- Tournament pending/recovery counts đúng sau restart;
- paused/enabled Tournament nhất quán từ API đến UI/docs/config;
- liveness/readiness/worker diagnostics đúng và không lộ private data;
- proxy spoof, map growth và TTL expiry tests pass;
- `npm run check`, production build và release manifest đều green;
- final diff không chứa secret/generated/runtime artifact;
- không có external action, gate upgrade hoặc evidence claim mới.
