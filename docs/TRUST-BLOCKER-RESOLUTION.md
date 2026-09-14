# Lộ trình phát triển trust-minimized sau MVP

> **Status change — 2026-09-11:** The owner approved a simpler
> `TRUSTED_OPERATOR` MVP. The TEE/ACI pair runner, authenticated Arc snapshot,
> 3-of-5 finality committee, reciprocal binding and permissionless proof
> delivery described below are retained as post-MVP hardening research. They
> are not current MVP prerequisites, implemented features or security claims.
> The active architecture and build order are `docs/ARCHITECTURE.md` and
> `docs/IMPLEMENTATION-SPEC.md`.

## 1. Trạng thái đề xuất

- Đây là thiết kế đề xuất cho Phase 1, chưa phải implementation evidence.
- Mục tiêu là giải quyết hai blocker kỹ thuật mà không trao quyền chọn winner hoặc payout cho coordinator.
- Quyết định sản phẩm của owner: việc trùng ý tưởng tournament/jury không phải vấn đề kinh doanh.
- Giới hạn workspace: gate `Differentiation` vẫn tồn tại trong bộ 14 gate bắt buộc của parent workspace. Vì vậy có thể bỏ nó khỏi tiêu chí sản phẩm, nhưng không được xóa hoặc giả đánh dấu `PASS` trong hồ sơ submission khi policy gốc chưa thay đổi.

## 2. Kiến trúc khuyến nghị

```text
Arc Tournament Escrow
  ├─ canonical roster / prompt commitments / topic policy / seed
  └─ GenLayerFinalityVerifier
              ^
              |
permissionless submitter / keeper
              |
TEE Match Runner ── signed A/B receipt + artifacts ──> GenLayer Tournament Judge
      |                                                   |
      | same provider route + same policy                 | verifies ACI profile,
      | generates A and B atomically                      | Arc snapshot and digests
      +---------------------------------------------------+
                                                   |
                                                   | finalized ranking
                                                   v
                                  independent finality notary committee
                                                   |
                                                   | threshold EIP-712 attestation
                                                   v
                                        Arc settlement + pull credits
```

Hai authority domain có governance và signer domain riêng:

- inference attestors không được tự xác nhận GenLayer finality;
- finality notaries không tạo hoặc sửa output;
- coordinator/keeper không phải signer bắt buộc ở cả hai domain;
- GenLayer chỉ judgment sau khi ACI profile và Arc snapshot hợp lệ;
- escrow chỉ hành động khi finality proof hợp lệ, không dựa vào `msg.sender` có quyền đặc biệt.

## 3. Blocker 1 — authenticated same-model inference

### 3.1 Vấn đề cần chứng minh

Một output hash chỉ chứng minh byte stability. Nó không chứng minh:

- plaintext prompt khớp prompt commitment đã đăng ký;
- A và B dùng cùng model artifact;
- topic, system wrapper và generation parameters không bị đổi;
- operator không chỉnh output hoặc retry riêng một phía;
- model call thực sự chạy trong workload đã khóa.

### 3.2 Giải pháp khuyến nghị: một attested match job tạo cả A và B

Dùng một TEE runner có workload measurement và signing key được attestation. Một request tạo **cả hai output trong cùng atomic job**. Bên trong job có thể là hai provider calls trả phí hoặc một batch call nếu provider hỗ trợ; operator không được tách chúng thành hai job có quyền retry/chọn kết quả độc lập.

Canonical request `MatchInferenceRequestV1`:

```text
schema_version
arc_chain_id
escrow_address
tournament_id
round_id
match_id
attempt_id
entrant_a_id
entrant_b_id
prompt_commitment_a
prompt_commitment_b
topic_id
topic_digest
system_wrapper_digest
model_artifact_digest
model_policy_digest
generation_policy_digest
request_nonce
issued_at
expires_at
```

TEE runner thực hiện theo thứ tự cố định:

1. kiểm tra request domain, nonce và expiry;
2. giải mã hoặc nhận hai master prompt trong enclave;
3. canonicalize prompt và recompute hai prompt commitment;
4. từ chối nếu commitment không khớp Arc state;
5. nạp exact model artifact, hoặc khóa exact provider endpoint + model ID theo assurance mode, cùng generation policy;
6. tạo output A và B trong cùng workload, dùng cùng route/artifact và cùng policy;
7. không cho retry riêng một contestant; retry tạo attempt mới cho cả match;
8. canonicalize output, tính digest và ký một receipt chứa cả A/B.

Canonical receipt `AttestedMatchReceiptV1`:

```text
request_digest
output_a_digest
output_b_digest
model_artifact_digest
workload_measurement
enclave_key_id
receipt_nonce
issued_at
expires_at
signature
```

Ký một receipt chung cho A/B là load-bearing: operator không thể chạy A bằng model/policy khác B mà vẫn tạo receipt hợp lệ.

### 3.3 Mức đảm bảo model

Có hai chế độ, phải ghi rõ trong tournament policy:

| Chế độ | Điều receipt chứng minh | Giới hạn |
| --- | --- | --- |
| `ATTESTED_MODEL_ARTIFACT` | exact model artifact/weights chạy trong TEE | yêu cầu confidential GPU hoặc workload đủ mạnh |
| `ATTESTED_PROVIDER_ROUTE` | TEE gửi exact request tới endpoint/model ID khóa và ký exact response nhận về | không chứng minh provider không đổi weights phía sau cùng model ID |

Khuyến nghị production là `ATTESTED_MODEL_ARTIFACT`. MVP chỉ được dùng `ATTESTED_PROVIDER_ROUTE` nếu UI và docs nói đúng giới hạn; không được quảng bá là chứng minh exact model weights.

### 3.4 Candidate technology

Ba hướng phù hợp để spike:

1. **Marlin Oyster / Nitro attestation** — có attestation verifier enclave, secp256k1 signing chain và hướng onchain verification; phù hợp với EVM verifier. Tài liệu: [attestation verifier](https://docs.marlin.org/oyster/build-cvm/examples/attestation-verifier) và [remote attestations](https://docs.marlin.org/oyster/core-concepts/remote-attestations).
2. **OpenGradient TEE gateway** — response đã bind request hash, output hash, timestamp và TEE signature; có x402 payment integration. Cần spike khả năng chuyển verification path sang Arc. Nguồn: [tee-gateway](https://github.com/OpenGradient/tee-gateway) và [verifiable LLM execution](https://docs.opengradient.ai/learn/onchain_inference/verifiable_execution).
3. **dstack Attested Confidential Inference** — có workload attestation, signed per-request receipt và byte-exact test vectors; cần chứng minh EVM-friendly verifier. Nguồn: [ACI specification](https://github.com/Dstack-TEE/private-ai-gateway/tree/main/spec).

Khuyến nghị bắt đầu với Oyster nếu ưu tiên Solidity verification trên Arc; dùng OpenGradient nếu ưu tiên sẵn inference + x402 và chấp nhận làm thêm adapter/proof verification spike.

### 3.4.1 Decision after bounded prototype (`2026-09-11`)

Chọn dstack ACI `aci/1` làm receipt base cho prototype vì có specification,
Ed25519/JCS verifier semantics và byte-exact official vectors tại revision
`19daf2b7152eeaf1f8be3fd66d261b8c1ce8eac5`. Arena thêm local profile bắt buộc
một receipt ký chung cho slot A/B, nhưng profile hiện mới là synthetic fixture;
chưa có deployed attested workload.

OnLatch được chọn làm optional operational gateway để giữ upstream credential,
khóa endpoint/method/model/payload, timeout, rate và spend. Public Proxy API hiện
chỉ mô tả correlation headers và một short-lived authorization receipt mà chưa
công bố đủ schema/key/attestation/test-vector để xác minh complete output
provenance offline. Vì vậy OnLatch không thay ACI trong consequential path. Chi
tiết tại `docs/ONLATCH-EVALUATION.md`.

### 3.5 Verification path

Preferred path:

1. GenLayer đọc `snapshotV1` của exact Arc manager bằng `ArcSourcePolicyV1` và
   khóa tournament/roster/bracket/seed bindings.
2. GenLayer xác minh ACI attestation/keyset policy và receipt signature theo
   `AsyncAgentArenaACI/1`.
3. Verifier khóa `workload_measurement`, allowed provider route/model policy và
   enclave receipt-key epoch.
4. GenLayer recompute request digest, A/B output digests, timestamp, nonce và
   exact prompt/topic/match/entrant bindings.
5. Receipt chỉ được consume một lần cho đúng `attempt_id` trong judge state.
6. Output plaintext lưu ở content-addressed store; GenLayer fetch exact bytes và
   recompute digest trước LLM judgment.
7. Arc không xác minh hay lưu output receipt; nó chỉ custody stake và chỉ consume
   final ranking qua `GenLayerFinalityVerifier`.

Nếu current GenVM không thể xác minh trực tiếp ACI cryptography/attestation
deterministically, fallback phải là một threshold ACI-verifier committee có
domain, keys và controlling quorum tách khỏi finality committee. Fallback này
phải được ghi đúng là threshold-attested và cần một Evidence Authority Matrix
riêng; không được âm thầm biến coordinator thành authority.

### 3.6 Internal provider billing — không phải player flow

x402/Gateway có thể được backend dùng để thanh toán provider theo request, nhưng đây là chi tiết vận hành nội bộ. Player chỉ nạp stake vào Arc escrow; player không ký hoặc trả một x402 call nào.

```text
payment authorization/settlement != inference authenticity
```

Quy tắc đề xuất:

- một atomic match job chứa hai provider calls, hoặc một batch call nếu exact provider API hỗ trợ;
- platform operations treasury trả API và GenLayer gas, tách hoàn toàn khỏi prize escrow;
- khóa `max_price_per_call`, `max_calls_per_attempt`, `max_price_per_match`, `max_total_execution_budget` và currency/network;
- x402 là tùy chọn; API key, prepaid account hoặc billing method khác không làm thay đổi protocol;
- billing metadata không nằm trong consequential receipt và không được Arc/GenLayer dùng để quyết định winner hoặc payout;
- payment success không làm inference receipt trở thành valid;
- invalid provenance hoặc provider failure → `RETRYABLE`, không loại contestant;
- nếu chỉ một call thành công, không phát hành usable match receipt; retry dùng attempt mới cho cả cặp theo locked retry policy;
- ambiguous payment phải query payment status trước retry để tránh trả hai lần.

Circle x402 phù hợp cho billing nhưng không thay thế TEE receipt. Nguồn: [x402 concepts](https://developers.circle.com/gateway/nanopayments/concepts/x402).

### 3.7 Failure policy

| Failure | Canonical result | Consequence |
| --- | --- | --- |
| Missing/invalid attestation | `RETRYABLE_PROVENANCE` | không submit judge, không advance |
| Wrong prompt/model/topic binding | `RETRYABLE_PROVENANCE` | không advance, evidence recorded safely |
| Stale/future/replayed receipt | reject | không state/value change ngoài allowed retry record |
| A có output, B thất bại | whole match retry | không dùng partial result |
| Provider billing/API authorization failed | `RETRYABLE_BILLING` | platform xử lý nội bộ; không loại contestant hoặc debit escrow |
| Output artifact unavailable/digest mismatch | `RETRYABLE_EVIDENCE` | GenLayer không judge |
| Retry cap reached | locked tournament fallback | refund/cancel path, không operator-selected winner |

### 3.8 Tests bắt buộc trước khi PASS

- exact request/receipt golden vectors;
- wrong enclave key, measurement, model digest và signature;
- valid output digest nhưng wrong prompt/topic/match/entrant binding;
- stale, future và replayed nonce;
- swapped A/B output;
- selective retry attempt;
- content-addressed bytes không khớp digest;
- payment valid nhưng provenance invalid;
- billing failure/retry không thay đổi stake, bracket hoặc provenance state đã final;
- rejected receipt giữ bracket, credits và prize accounting unchanged.

## 4. Blocker 2 — finalized GenLayer result verification on Arc

### 4.1 Giải pháp MVP khuyến nghị: independent threshold finality attestation

Không chờ một generic bridge chưa xác minh hỗ trợ cả Arc và GenLayer. Dùng một committee finality riêng, ví dụ `3-of-5`, mỗi node độc lập đọc canonical GenLayer state và ký cùng statement.

Mỗi finality notary phải kiểm tra:

1. source network và judge contract đúng version đã khóa;
2. GenLayer transaction đã thật sự `Finalized`;
3. execution result là success, không chỉ lifecycle status;
4. canonical judge view chứa exact tournament, roster, bracket và ranking digest;
5. mọi required match/placement đã được cover;
6. settlement nonce chưa được node ký trước đó cho payload khác;
7. destination Arc chain và escrow khớp tournament policy.

Canonical statement `FinalizedRankingAttestationV1`:

```text
schema_version
source_chain_id
source_judge_address
genlayer_transaction_id
genlayer_finalization_reference
arc_chain_id
arc_escrow_address
tournament_id
roster_commitment
bracket_commitment
ranking_digest
settlement_nonce
notary_set_epoch
issued_at
expires_at
```

Mỗi notary ký EIP-712 statement. Bất kỳ caller nào thu đủ chữ ký đều gọi Arc; caller không cần role.

### 4.2 Reciprocal immutable deployment binding

Áp dụng thêm topology khóa hai chiều giữa hai deployment:

```text
GenLayer TournamentJudge ──► exact Arc chain + TournamentManager
Arc TournamentManager ─────► exact GenLayer chain + TournamentJudge
Arc TournamentManager ─────► exact IResultVerifier revision
```

`TournamentJudge` khóa trong constructor:

- `arc_chain_id = 5042002` cho Arc Testnet;
- exact predicted `arc_manager` address;
- schema/domain version dùng để tính các ID.

Judge phải recompute `tournament_id`, `round_id`, `match_id`, `attempt_id`, roster commitment và destination binding từ canonical fields. Mọi payload mang manager khác, chain khác, schema khác hoặc deployment cũ đều bị reject trước semantic judgment.

`TournamentManager` khóa trong constructor:

- exact GenLayer source chain ID;
- exact `TournamentJudge` address;
- exact `IResultVerifier` revision;
- Arc chain được kiểm tra lại từ `block.chainid` trong mọi domain-separated digest.

Finality statement ở mục 4.1 chứa cả hai phía của binding. Arc chỉ chấp nhận statement khi source và destination khớp toàn bộ immutable state. Như vậy relay không thể thay judge, manager hoặc chain trong payload.

Do hai contract cần biết địa chỉ của nhau, thứ tự deploy phải là:

1. deploy và xác minh `IResultVerifier` trên Arc;
2. đọc nonce kế tiếp của một Arc deployer không có pending transaction;
3. dự đoán địa chỉ `TournamentManager` từ exact deployer + nonce, rồi khóa nonce đó trong deployment manifest;
4. deploy `TournamentJudge` trên GenLayer với Arc chain ID và địa chỉ manager dự đoán;
5. đọc canonical judge config để xác minh binding GenLayer → Arc;
6. nếu Arc deployer nonce vẫn đúng, deploy `TournamentManager` bằng đúng nonce đã khóa và truyền exact judge/verifier addresses;
7. đọc lại cả judge, manager và verifier để chứng minh binding hai chiều trước khi mở registration.

Trong khoảng bước 2–6, deployer không được gửi Arc transaction nào khác. Nếu nonce drift, địa chỉ dự đoán sai hoặc một readback không khớp, bỏ topology đó trước khi nhận USDC và bắt đầu lại bằng deployment revision mới; không vá một phía bằng mutable admin setter.

Binding này giải quyết giả nguồn và replay giữa deployment, nhưng không phải bridge và không tự chứng minh finality. Một relay được phép gọi hàm vẫn không đủ thẩm quyền để tự đặt `consensusFinalized = true`. Quorum ở mục 4.1 phải ký finality statement sau khi từng notary tự kiểm tra GenLayer.

### 4.3 Arc verification

`GenLayerFinalityVerifier` phải:

- recompute EIP-712 digest bằng Arc `chainId` và verifier address;
- recover distinct active signers;
- reject duplicate signer và chữ ký không canonical;
- yêu cầu quorum của exact `notary_set_epoch` pinned cho tournament;
- xác minh source judge, destination escrow, tournament, roster, bracket, ranking và nonce;
- consume `settlement_id` đúng một lần;
- trả normalized verified payload cho escrow;
- không nhận payout wallet/amount từ attestation prose.

Escrow tự derive rank wallets từ locked roster/ranking IDs và tự tính payout từ locked BPS.

### 4.4 Ai đánh thức contract

Contract vẫn thụ động. Liveness flow:

```text
scheduled keeper (primary)
        or
any permissionless caller (fallback)
        |
        v
collect threshold attestations
        |
        v
Arc settleWithProof(...)
        |
        v
contract verifies proof, not caller identity
```

Keeper chỉ trả gas và vận chuyển proof. Nếu keeper chết, bất kỳ ai cũng có thể gọi. Không caller nào có quyền settlement nếu proof không đủ quorum.

### 4.5 Independence và governance

Để tránh một backend kiểm soát cả winner và payout:

- ít nhất 5 signer do các operator/organization độc lập vận hành;
- tournament operator không được nắm quorum;
- inference attestation committee và finality committee không được có cùng controlling quorum;
- signer set, threshold và epoch được snapshot trước registration;
- rotation dùng timelock và không áp dụng hồi tố cho active tournament, trừ emergency recovery đã khóa;
- pause có thể ngăn settlement nhưng không được set ranking hoặc chuyển tiền;
- quorum unavailable tới expiry kích hoạt refund/recovery policy đã khóa.

### 4.6 Trust statement

MVP được mô tả là:

> Threshold-attested GenLayer finality with permissionless delivery to Arc.

Không mô tả là trustless bridge hoặc light client. Safety assumption là ít nhất `threshold` finality notaries không cùng ký một payload sai. Liveness assumption là đủ quorum online trước expiry.

### 4.7 Production upgrade path

Giữ interface `IResultVerifier` ổn định để sau này thay bằng:

1. native bridge/OApp/CCIP lane nếu cả Arc và GenLayer có official deployment;
2. zk light client hoặc state proof verifier của GenLayer trên Arc;
3. attestation service có economic security/slashing mạnh hơn.

Không tích hợp LayerZero/CCIP/Hyperlane chỉ vì hai chain đều EVM-compatible. Phải xác minh exact endpoint deployment, source-finality semantics và Arc destination support trước.

### 4.8 Tests bắt buộc trước khi PASS

- exact EIP-712 golden vector giữa TypeScript và Solidity;
- 2-of-5 fail, 3-of-5 pass;
- duplicate signer không tăng quorum;
- wrong source chain/judge/transaction/finality status;
- wrong reciprocal Arc manager binding hoặc GenLayer deployment revision;
- `Finalized` nhưng execution failed;
- wrong Arc chain/escrow/tournament/roster/bracket/ranking;
- stale/future/replayed attestation;
- wrong notary epoch và mid-tournament rotation;
- duplicate delivery không double-credit;
- keeper chết và caller khác settle thành công;
- predicted manager address golden vector, nonce drift abort và three-contract readback;
- invalid proof giữ liabilities/credits unchanged;
- quorum unavailable dẫn tới exact locked recovery path.

## 5. Combined end-to-end trust flow

```text
1. Player registers prompt commitment + USDC stake on Arc.
2. Arc locks roster, seed, match and topic policy.
3. TEE Match Runner verifies both prompts and creates both outputs atomically.
4. GenLayer validators fetch and authenticate the exact Arc snapshot.
5. GenLayer verifies one attested A/B receipt and exact output artifacts.
6. GenLayer judges semantics and finalizes the complete ranking.
7. Independent finality notaries verify Finalized + execution success + ranking view.
8. Each notary also verifies the reciprocal source/destination deployment binding.
9. Any keeper submits threshold proof to Arc.
10. Arc verifier consumes proof once.
11. Escrow derives payout and opens pull credits.
```

Không actor đơn lẻ có đủ quyền để vừa tạo output giả, vừa chọn winner, vừa mở payout.

## 6. Evidence Authority Matrix — proposed rows

| Consequential fact | Authority | Deterministic verification | Failure state | Blocked consequence |
| --- | --- | --- | --- | --- |
| Prompt plaintext matches registration | attested TEE workload | workload measurement + signed receipt + prompt commitment binding | `RETRYABLE_PROVENANCE` | output binding, judgment |
| A/B used same model/policy | one atomic TEE match receipt | same model/policy digest inside signed receipt | `RETRYABLE_PROVENANCE` | judgment |
| Output bytes are authentic | attested workload key | signature + output digest + content recomputation | `RETRYABLE_EVIDENCE` | judgment/advance |
| Match winner | GenLayer validators | meaning-level consensus + deterministic verdict invariants | `RETRYABLE_JUDGMENT` | advancement |
| Ranking is finalized on GenLayer | independent finality notary quorum | distinct EIP-712 signatures over finalized canonical state | `SETTLEMENT_PENDING` | Arc credit |
| Result belongs to this deployment topology | immutable config on both contracts + signed finality statement | exact source chain/judge and destination Arc chain/manager/verifier binding | reject/`SETTLEMENT_PENDING` | Arc credit |
| Arc payout | Arc escrow state | one-time proof consumption + locked roster/BPS calculation | unchanged/reject | transfer/credit |

## 7. Concrete Phase 1 decision gates

Blocker 1 chỉ chuyển `PASS` khi:

- chọn exact TEE stack;
- có official/open verifier và license phù hợp;
- khóa receipt schema và workload/model measurement;
- có positive + adversarial verification vectors;
- chứng minh GenLayer hoặc một independently governed threshold ACI-verifier
  committee xác minh receipt deterministically;
- GenLayer recompute exact output digest trước judgment.

Blocker 2 chỉ chuyển `PASS` khi:

- khóa notary independence policy, threshold và epoch lifecycle;
- khóa reciprocal constructor bindings và có deterministic manager-address prediction/readback flow;
- có EIP-712 golden vectors;
- Solidity verifier prototype reject toàn bộ negative cases;
- chứng minh một permissionless caller settle được và duplicate không double-credit;
- docs gọi đúng trust model là threshold-attested.

## 8. Khuyến nghị quyết định

Đề xuất chọn:

- **Blocker 1:** dstack ACI `aci/1` plus locked
  `AsyncAgentArenaACI/1` atomic A/B profile; ưu tiên direct GenLayer verification
  và chỉ dùng tách biệt threshold ACI-verifier fallback nếu target runtime buộc phải dùng.
- **Blocker 2:** `3-of-5` independent finality notaries + permissionless Arc submission cho MVP.
- **Provider payment:** platform trả từ operations treasury; x402 chỉ là lựa chọn billing nội bộ, không xuất hiện trong player flow hoặc winner proof.
- **Production upgrade:** direct TEE proof verification và zk/native cross-chain verifier qua cùng interface, không đổi escrow accounting.

Hai bounded verifier prototypes và golden fixtures đã được chạy ở
`spikes/phase1/`; 66/66 tests pass. Kết quả này khóa được message format và
adversarial behavior cho các phase sau, nhưng chưa đủ đổi Evidence authenticity
sang `PASS` vì chưa có live Arena pair-runner/key-custody evidence, Solidity
verifier parity, hoặc real independent notary committee. Xem
`docs/PHASE1-SPIKE-RESULTS.md`, `docs/ACI-PAIR-RUNNER-PROFILE.md`, và
`docs/FINALITY-COMMITTEE-POLICY.md`.
