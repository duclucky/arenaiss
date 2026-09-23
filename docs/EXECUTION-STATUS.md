# Implementation execution status

## 2026-09-24 ERC-8004 Marketplace V2 — Arc Testnet deployed

`AgentMarketplaceV2` replaces the legacy Arena registry as Marketplace
ownership authority with the official ERC-8004 Identity Registry. Eligibility
is exact-bound to the ERC-8004 token ID, Agent ID, version and commitment. The
seller flow uses the managed Circle wallet to approve that NFT before creating
the listing. Purchase atomically collects six-decimal Arc USDC, transfers the
complete ERC-8004 identity NFT, credits the seller, and credits the fixed 1%
platform fee. A failed NFT transfer reverts the USDC movement and all listing
state changes.

The contract is deployed on Arc Testnet at
`0x2763dF7a2f4e29EeA87Cc6f79aA09caE30a94819` in transaction
`0xa2dd5c63a411b147258a06ae4ab1ba15361baf930deaf1fc65f428be30b2fdff`.
Arc Studio reported no Critical, High or Medium finding, and the project-owned
Foundry regression suite passed. Deployment evidence is recorded in
`docs/evidence/arc-testnet/marketplace-v2-deployment-2026-09-24.json`. This is
testnet implementation evidence only and does not advance evidence-authenticity
or trustlessness gates.

## 2026-09-21 no-consensus scenario retry — local only

Tournament and Pair Match orchestration now treat a finalized GenLayer
`MAJORITY_DISAGREE` as `NO_CONSENSUS`, not as a generic execution error. The
affected match creates a new whole-pair attempt with a different scenario while
independent matches continue normally. Pair Match permits the initial attempt
plus at most three no-consensus retries, persists the winning attempt for exact
scorecard readback, and opens the existing automatic Arc refund path only after
all four attempts lack consensus. Provider, GenLayer execution and malformed
comparison failures retain their immediate recovery/refund behavior; a semantic
tie remains a finalized consensus outcome and is not retried. No GenLayer or Arc
contract source was changed and no provider call, transaction, deployment, push
or publication was performed for this batch.

## 2026-09-20 runtime concurrency and operations hardening — local only

The ordered hardening batch in
`docs/RUNTIME-CONCURRENCY-AND-OPERATIONS-HARDENING-SPEC.md` is implemented
locally. GenLayer and Arc submissions now share signer-scoped FIFO coordinators
that release as soon as the transaction hash is returned; receipt/finality
polling therefore does not block the next submission. Provider execution is
bounded at the shared transport boundary with a configurable maximum of 30,
and Evo resume work is parallelized with the same bounded scheduling model.
Pair progress has separate provider, submission, finality and Arc-settlement
state/retry accounting; a known GenLayer transaction continues finality polling
without consuming a new submission retry. Tournament pending counts now include
all judging/retryable matches and report recovery-required work separately.

The API now exposes fail-closed runtime capabilities, liveness/readiness with
worker heartbeat tracking, proxy-aware client identity, bounded rate-limit and
authentication TTL cleanup, and a safe loopback host-port default. The UI uses
the capabilities response before exposing Tournament entry actions. No paid
provider request, transaction, wallet operation, deployment, push or publication
was performed for this batch.

Fresh local evidence: 347 Node tests pass, 133 frontend tests pass, frontend
typecheck and an isolated production Vite build pass, 33 Foundry tests pass,
and all three GenLayer contracts pass GenVM lint and validation. The aggregate
`npm run check` remains incomplete because the installed GenLayer direct-test
runtime cannot access
`C:\Users\TBC\.cache\gltest-direct\trees-v2\v0.6.0-rc5\.extracted`
(`WinError 5`); 12 direct tests run before the same cache permission failure
blocks the remaining cases. A local Caddy binary/container runtime is also not
available, so the Caddyfile could not be parsed by `caddy validate` locally.
These environment limitations do not count as passing direct-test or Caddy
validation evidence and must be cleared before any release.

## 2026-09-17 pair-room escrow — deployed contract, local flow

An independent two-Agent `PairMatchEscrow` now has local create, equal-stake
join, winner credit, creator pre-join cancellation, mutual joined cancellation,
timeout refunds and pull withdrawals. The API pairs creator/challenger Arc
transaction hashes under one durable room ID, verifies canonical Arc room
readback, and retries a pending join after a transient read failure. The new
room page uses the managed Circle wallet and exposes cancellation, timeout and
claim actions. Pair deposits require the feature flag and a verified Arc Testnet
escrow configuration; the release Compose file enables that flag. The contract is deployed at
`0xD7CB8dE4cED8F988152CDc51EBCf7a17c602c6c1` (transaction
`0x108e4115cc0cffff3df5716647033f80f640339b57081d92c7f2bdc655c204b8`),
with USDC/operator/runtime readback. The pair worker now derives the winner from
a finalized canonical GenLayer comparison and submits a durable operator intent;
its local tests pass. No two-wallet live deposit/verdict/settlement/withdrawal
flow has been exercised. Details and safety boundaries are in
`PAIR-MATCH-ESCROW.md`.

## 2026-09-16 topic-pool expansion

New Tournament operations freeze a 24-topic scenario deck at activation and use
their persisted random bracket seed to shuffle topic order reproducibly. Older
operations keep the six-topic selection rule. Evo Core V2 offers 18 scenarios
across six capability categories and randomly selects one per category for an
Agent. That six-scenario pack is persisted for the Agent across campaigns and
versions so existing comparison and Marketplace eligibility checks retain exact
pack comparability. Local checks passed; no paid provider, GenLayer, Arc, or
live evaluation was performed as part of implementation.

## 2026-09-16 product-flow hardening

This source revision reconciles submitted Marketplace listings, persists and reuses Circle
intent keys for listing, purchase, cancellation and managed USDC withdrawal, and
restore withdrawal status from the API after a browser reload. Evo failure views
distinguish provider timeout from an unfinished score. Agent and Docs copy now
discloses the exact profile bytes sent to providers and GenLayer validators.
The release-candidate manifest covers this reviewed source revision. Local
tests and the production build are the release checks; live Arc/Circle/GenLayer
payment and recovery journeys remain unverified. Frontend-wide lint has
existing failures outside this batch. This source release does not advance an
evaluation or evidence-authenticity phase gate.

## Snapshot

- Date: `2026-09-16`
- Product direction updated: `2026-09-14`
- Product: `Arena ISS — Intelligence, Safety & Standards`, an Agent Evaluation
  Platform; see `docs/ADR-002-AGENT-EVALUATION-PLATFORM.md`
- Implemented architecture: `TRUSTED_OPERATOR` Tournament MVP approved by owner
- Current implementation baseline: Phase 12's bounded backend/onchain network lifecycle and the
  expiry-gated refund recovery are complete.
  Phases 3–11 remain locally implemented, and one paid-provider → GenLayer → Arc
  lifecycle has now reached terminal settlement on the configured testnets.
  The real browser-wallet lane and release/publication remain separate work.
- Current planning state: Tournament is retained as one evaluation mode. The
  bounded Level 1/2 provider protocol, inert action-policy slice, independent
  GenLayer scorecard feasibility gate, EvaluationRun persistence, first local
  multi-scenario `SOLO` runner and Run Detail read APIs are implemented. Full
  Test Pack editing/version browser, `SOLO` creation UI and optional Level 3
  executable sandbox remain open. Deterministic `EVAL-5` version comparison and
  regression is implemented locally with immutable owner-only records. The
  `EVAL-6` Tournament convergence is implemented and locally verified through
  the specialized ComparisonRun model. The owner-private Agent detail UI now
  compares two finalized Evo-backed versions under the locked regression
  policy; benchmark claims remain open.

## Evo fee escrow and infrastructure refund — 2026-09-16

- Evo no longer transfers its fixed 1 USDC fee directly to the owner. The
  user's Circle-managed Arc wallet approves and deposits the exact amount into
  `EvoFeeEscrow` at `0xa7693481E17736F1617b3a6dc199aA31D86398E9`.
- The configured operator releases the fee only after the full campaign reaches
  `FINALIZED`, and refunds it when the campaign reaches an infrastructure
  failure. Concurrent settlement shares one operation and terminal release and
  refund states cannot cross. The payer can recover a still-held fee directly
  after a 24-hour timeout.
- Arc Testnet deployment transaction
  `0x87e73cb0ef9fe82a389668027a56a53103df400b63d92956ee8e4a60f253c13a`
  succeeded at block `62289514`; exact immutable readback and runtime bytecode
  evidence is recorded in
  `docs/evidence/arc-testnet/evo-fee-escrow-deployment-2026-09-16.json`.
- The earlier failed live Evo campaign's legacy direct fee was returned in Arc
  transaction
  `0xda138915cd5eddbfec8f3842805e5e87ebb44eb71ec6c9ebda504d435c6a3563`.
  Sanitized evidence is recorded in
  `docs/evidence/live/evo-fee-refund-2026-09-16.json`.
- This is an unaudited testnet contract and remains within the disclosed
  trusted-operator architecture; Arc does not verify the GenLayer verdict.

## EVAL-6 Studio Next deployment — 2026-09-16

- `ArenaComparisonJudge` (`AgentComparisonV1`) is deployed at
  `0xe5210eCCC4182090A1416f515Dc7001B27274BcB` on Studio Next, chain `61997`.
- Deployment transaction
  `0xebff1bca9a8b97eacf38bb79bbce4a04d37efadceda01ab89d09ae82780aee38`
  finalized `MAJORITY_AGREE` with `FINISHED_WITH_RETURN`. Exact normalized
  deployed source SHA-256 is
  `a6b098f777af6d70dfc3debdbe29354a14b8a776b11c04f180d1a7645c2bcb9a`.
- Final-address deterministic smoke transaction
  `0x4b651de4fed5a3cc8b9233ab6ba34ded8b07b42ed18e4beb7a8f306f3f9b0b3d`
  finalized with a canonical six-dimension `TIE` and exact evidence bindings.
- The fee profile records the Studio Next v0.6 envelope needed by both deploy
  and `submit_comparison`. Failed fee/payload calibration attempts did not write
  contract state and are not represented as successful evidence.
- Sanitized evidence is recorded at
  `docs/evidence/studio-next/arena-comparison-deployment-2026-09-16.json`.
- All active GenLayer SDK factories, frontend build defaults, Compose and
  integration configuration now resolve through the canonical Studio Next RPC.
  The public verifier binds only `AgentEvaluationJudge` and
  `ArenaComparisonJudge`. `ArenaMatchJudge` is archived from active runtime,
  image configuration and new writes; its source, compatibility reader and
  immutable evidence remain available for historical Tournament readback.
  Historical Studionet scripts and evidence remain deliberately chain-specific
  and were not rewritten. The pre-archive three-contract source/schema/CORS evidence is in
  `docs/evidence/studio-next/rpc-synchronization-2026-09-16.json`.

## Studio Dev release-candidate deployment — 2026-09-14

- The hackathon's canonical name and endpoint are now reflected in the app as
  **Studio Next**, `https://studio-next.genlayer.com/api`, chain `61997`. Direct
  readback proved that this endpoint and the earlier `studio-dev` deployment
  endpoint expose the same chain, deployment receipts, contract source bytes
  and schemas for both judge addresses. No redeployment was necessary.
- The frontend now carries the required prerelease client stack:
  `@genlayer/transaction-kit` and its React adapter at `0.1.0-rc.2`, plus
  `genlayer-js` `2.0.0-rc.1`. A public Evaluations-page verifier reads chain,
  source and schema directly from Studio Next and compares the exact reviewed
  source digests for both deployed judges; it does not expose a public judge
  write path because the trusted-operator backend owns that authority.
- Sanitized canonical-endpoint verification is recorded at
  `docs/evidence/studio-next/verification-2026-09-14.json`. Historical
  Studionet verdicts remain labelled and linked to the chain that produced them.

- Studio Dev `v0.123.0-rc.6` (chain `61997`) has finalized deployments of
  the now-archived `ArenaMatchJudge` `GeneralResponseV7` at
  `0xbd5592dc0A45B78614cd5d1c2f29F6F35dabB679` and
  `AgentEvaluationJudge` `AgentEvaluationV5` at
  `0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d`.
- Both deployments reached `MAJORITY_AGREE` with
  `FINISHED_WITH_RETURN`; deployed source hashes match the final local files,
  schema readback passed and each contract reports the expected operator.
- The contracts use the Studio Dev GenVM `v0.3.0-rc7` API and pinned runner
  `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`.
  Runtime adapters now expose separate Studio Dev factories and submit the exact
  fee quote returned by `genlayer-js` `2.0.0-rc.1`; Studionet factories remain
  available for historical lifecycle verification.
- The local toolchain has since been refreshed from official boilerplate
  `v2-dev` revision `816f3b8`: `genlayer-py 0.19.0rc2`, `genlayer-test
  0.30.0rc2`, and `genvm-linter 0.11.1rc2`, all dependency-pinned to exact
  upstream commits. `gltest.config.yaml` now selects the preconfigured
  `studio_devnet` chain type while overriding its RPC with the canonical Studio
  Next endpoint. GenVM `v0.6.0-rc5` contains the deployed `5jyc...` runner;
  contract SDK validation and all 79 direct tests pass with this stack.
- Sanitized replacement deployment and semantic smoke evidence is recorded at
  `docs/evidence/studio-dev/redeployment-2026-09-14.json`. The superseded first
  deployment remains preserved in `deployment-2026-09-14.json` and
  `smoke-2026-09-14.json`. Studio Dev remains a
  resettable release-candidate environment, so this supplements rather than
  rewrites the durable Studionet evidence below.
- The original semantic smoke exposed that GenVM v0.3 renamed
  `gl.vm.run_nondet_unsafe` to `gl.vm.run_nondet`. A focused 2-case regression
  failed before and passed after the two-call-site migration. On the replacement
  contracts, the A/B semantic smoke finalized `A_WIN` with a `100-0` score, and
  the independent evaluation smoke finalized `STRONG/100` across all applicable
  dimensions with `actions_executed=false`. Both canonical results were read
  back from contract state.
- A fresh same-bytes, full-consensus comparison against the active Studio Dev
  and Studionet deployments finalized 16/16 successful transactions across four
  pairwise and four independent-evaluation cases per network. Pairwise result,
  swap, tie and safety class matched 4/4; three evaluation result classes and
  scores matched exactly. For `l1_instruction_hierarchy`, Studio Dev correctly
  treated the scenario override as untrusted evidence and returned `STRONG/100`,
  while Studionet incorrectly followed that override as authoritative and
  returned `WEAK/52`. This bounded sample favors Studio Dev judgment quality but
  is not a general network benchmark. One earlier Studionet factual canary also
  finalized successfully but is excluded from the balanced 16-result table
  because an idempotent resubmission was selected after the canary had not yet
  reached finality. Sanitized evidence is in
  `docs/evidence/genlayer-network-comparison-2026-09-14.json`.

## VPS deployment slice — 2026-09-14

- Rootless Docker API/web deployment is live under a dedicated unprivileged
  service account on the owner-managed Ubuntu host. Unrelated host workloads
  remain isolated from the Arena Compose stack.
- Caddy serves the built SPA, applies security headers, and proxies `/api` and
  `/healthz` same-origin to the internal-only API container.
- Production API state was seeded idempotently from the sanitized live evidence:
  one completed `0.008 USDC` tournament, 11 final matches and their exact
  GenLayer transaction/verdict metadata. Browser inspection confirmed the live
  label, finality/execution, scores, five criteria and Arc zero-liability trail;
  the browser console had no warnings/errors.
- Mutation rate limiting, secret-free structured HTTP logs, bounded Docker log
  rotation, graceful SIGTERM close, verified SQLite backup/restore, container
  restart policy, rootless Docker boot enablement and a daily backup timer are
  active.
- The named Cloudflare Tunnel is connected with four QUIC connections
  and routes `arenaiss.xyz` plus `www.arenaiss.xyz` to the web service without a
  stable public IP. The `.xyz` registry delegates to the assigned Cloudflare
  nameservers, Cloudflare and Google DNS-over-HTTPS return both proxy addresses,
  the managed Universal certificate is active, and root/www health plus the
  public tournament API returned HTTP 200 through the Cloudflare edge. Recursive
  caches may temporarily retain the previous registrar nameservers.
- Still open: host administrator sleep/firewall policy, wired connectivity and
  the real injected-wallet transaction. The in-app browser reported no EVM
  provider. The production unattended tournament scheduler also remains
  separate from the bounded lifecycle script and is not claimed as deployed.
- Production status: MVP contract deployments are testnet-only and unaudited
- Network/financial status: the active GenLayer Studionet judge revision is V10
  at `0x09Ba3CE193E477a66Fdaf556bA63519A767eb130`; deployment, source and readback
  evidence is recorded under `docs/evidence/studionet/deployment.json`. The
  Active Arc Testnet `TournamentEscrowV2` is deployed and exact-match verified at
  `0xc908a4BFb6E94dDD3F32C34d9bfEBf774E3b702B`, with owner
  `0xC495ef51618D03267A1f227aFe5b27B38c748272` and canonical Arc USDC bound;
  deployment/readback evidence is under `docs/evidence/arc-testnet/`.
  The Arc Testnet `AgentRegistry` is deployed and exact-match verified at
  `0x4c0b1787Ae48bE1A34E7dE7e767BA25016609E25`; deployment, zero-state
  readback and compiler evidence is recorded in
  `docs/evidence/arc-testnet/agent-registry-deployment-2026-09-15.json`.
  V2 adds permissionless `withdrawCreditFor` and `withdrawPlatformFeeFor`
  entrypoints whose destinations remain fixed by the credit ledger and immutable
  owner policy. Its source is verified, but its automatic payout lifecycle is not
  yet funded/exercised. The prior V1 at
  `0x2875BeA04e01EdaAA762987431ad5a87CF11445d` remains the address bound to the
  following historical lifecycle evidence: a successful eight-entrant lifecycle locked `0.008` USDC, finalized 12
  GenLayer transactions for an 11-match bracket, settled Top 5, withdrew
  `0.0072` USDC of winner credits and sent the fixed `0.0008` USDC fee to the
  owner wallet. Arc readback is `CLOSED` with zero tournament liability. The
  provider completed 27 authenticated calls using 108,751 tokens but omitted
  invoice/cost fields, so no exact monetary API charge is claimed. Sanitized
  evidence is in `docs/evidence/live/trusted-operator-lifecycle-settlement-2.json`.

  An earlier bounded run correctly exhausted its three-attempt budget after
  two semantic ties and one incomplete provider pair. After the immutable
  expiry at Unix `1789280496`, the recovery opened refunds, returned the full
  `0.008` USDC principal to all eight registered wallets, charged zero platform
  fee and closed with zero locked stake and zero liability. All 18 recovery
  receipts are unique and successful. The lifecycle evidence remains in
  `docs/evidence/live/retry-exhausted-refund-pending-2026-09-13.json`; its
  canonical outcome is now `REFUNDED_CLOSED`.

  The separate independent-evaluation contract is `AgentEvaluationJudge` V5 at
  `0x7f9f5D4798e2A69576B5E1a5113849E2c4bF64BD` on Studionet. Its deployed source
  matches local source, owner/config readback is canonical, and four bounded
  Level 1/2 transactions finalized with six-dimension scores and reasons. V1–V4
  are superseded and marked as receiving no further transactions. This contract
  executes no tools, moves no value and does not replace `ArenaMatchJudge`.

## Architecture decision

### Evaluation Platform direction

Arena now means a controlled Agent testing ground rather than only an elimination
bracket. The platform will evaluate observable reasoning artifacts, action
selection, rule compliance, robustness and task completion. It will not claim
access to hidden model chain of thought. Deterministic code will own objective
policy/tool facts; GenLayer will own qualitative semantic judgment over submitted
evidence; Arc will be used only for value-bearing campaigns.

The current `ArenaMatchJudge`, Tournament backend and Arc escrow remain valid
implemented evidence for the Tournament mode. They have not been relabeled as a
generalized scorecard platform. Historical live evidence remains historical and
must not be rewritten.

### Current Tournament MVP trust decision

The MVP no longer requires TEE/ACI generation provenance, GenLayer-authenticated
Arc snapshots, a 3-of-5 finality committee, reciprocal deployment binding or a
native GenLayer-to-Arc proof.

The backend is intentionally trusted to run prompts, manage the bracket, map
GenLayer A/B verdicts to agents and submit the final ranking to Arc. GenLayer
judges one submitted pair at a time. Arc holds USDC and derives payout amounts
from immutable policy after a configured operator submits the ranking.

The removed mechanisms are retained under **Lộ trình phát triển
trust-minimized** and do not block MVP execution.

## Current verified artifacts

The repository still contains bounded offline spikes for provenance, finality,
randomness, Arc-source normalization, semantic verdicts and accounting. A fresh
run after R2 REWORK-1 collected `84` tests and passed. `compileall` also passed.

The current full local regression is `84` Python direct tests, `204` TypeScript
domain/service/system tests, `17` Foundry tests and `59` frontend tests. GenVM
lint/validation, frontend typecheck and the production frontend build pass. The
former 525 kB bundle warning is resolved; the latest build split the largest
wallet chunk to about 294 kB and the main chunk to about 221 kB.

The provider prompt boundary now uses the selected
`arena-generation-input-v2` delegated-user JSON envelope. A bounded live
evaluation completed 54/54 paid calls across three candidate envelopes. The
selected structure achieved 13/15 strict AGENTS-directed checks versus 7/15
for the legacy concatenated prompt, passed every exact hierarchy/structure case
and retained the platform boundary in 3/3 canary attempts. A subsequent
two-call smoke through the production adapter followed two distinct exact
AGENTS.md strategies despite a conflicting topic in 2/2 calls. Exact word
limits remain soft model behavior; the provider token ceiling and backend byte
rejection remain the hard bounds. Details and limits are recorded in
`docs/AGENTS-PROMPT-PROTOCOL.md`.

The Evaluation V1 provider envelope has separately completed 24/24 selected
AGENTS-directed corpus runs across 12 paired scenarios after one invalid-output
retry. Exact `AGENTS.md`, scenario and response commitments feed
`AgentEvaluationJudge`; deterministic code checks inert action proposals before
semantic grading. V5's explicit grade anchors and adjacent-tier validator policy
resolved the consensus liveness failures preserved in V1–V4 archives. Four of
four bounded Studionet scorecards finalized; this is feasibility evidence, not
broad statistical stability or Agent certification.

The landing hero no longer seeks through a remote MP4 on every pointer event.
It renders a bundled, contiguous 97-frame WebP sequence through one canvas and
one requestAnimationFrame loop, with time-based easing, bounded preloading, a
first-frame poster fallback and overscan that prevents exposed page edges.
Fine pointers can scrub the character deliberately; coarse pointers stay on a
stable frame, while reduced-motion mode disables parallax. The full sequence is
about 1.39 MB, compared with roughly 4.59 MB for the former source video.

Phase 3A has a versioned deterministic protocol and pure TypeScript domain
modules for policy validation, domain-separated SHA-256 IDs, 8–32 entrant
bracket formation and terminal progression to a unique Top 5.

Phase 3B persistence primitives are accepted locally after direct primary-agent fixes:
runtime SHA-256 digest validation, duplicate identity checks on restore,
atomic snapshot restore, and outbox ordering by primary `eventId` are covered
by 10 in-memory persistence tests. A Node SQLite runtime store now persists
external-operation records and counters and provides fingerprint-bound,
expiring leases across independent database connections. Node `24+` is pinned
because the built-in SQLite API still emits an experimental warning in the
current runtime; this is a bounded local MVP choice, not a production database
claim.

Phases 6–9 now have local provider, GenLayer tracking, orchestrator and Arc
settlement adapters. Inference output/cost, GenLayer transaction/progression and
Arc settlement records survive SQLite reopen. Submission and polling leases
prevent duplicate calls and stale receipt races across two local connections.
Pending GenLayer transactions resume without new attempts, execution failure
enters recovery, Arc accepts both numeric and viem receipt status shapes, a
missing receipt remains pending, and Arc transaction hashes must be 32-byte hex
values. The full fake-port lifecycle has also been restarted between pending
judgment and final settlement without a duplicate provider call or transaction.
These remain local single-host guarantees; lease heartbeat/fencing and a
multi-host production database remain open. The separate Phase 12 evidence now
proves the bounded real calls and network writes described above.

The Phase 10 frontend foundation has strict runtime configuration, EIP-6963 and
injected wallet discovery, authenticated agent APIs, real Arc wallet adapter
boundaries, lifecycle/focus behavior and a successful production build. Public
tournament, match and bounded verdict views now have a normalized API service,
anonymous `credentials: omit` browser adapter, GenLayer explorer URL mapping,
production preview gating, and explicit loading/error/retry UI. Vite proxies
`/api` same-origin to the local API. Browser visual smoke passed at the default
viewport and a 375x812 mobile viewport. A seeded local API session was then
served through the proxy and verified in-browser end-to-end: the tournament,
finalized match, bounded verdict reasons, and GenLayer explorer transaction link
all rendered from persisted API records. The HTTP boundary now decodes encoded
canonical digest IDs before routing, and the browser fetch adapter preserves the
global receiver required by native `window.fetch`.

The Phase 11 system harness now exercises the complete local recovery boundary:
retry-cap and expiry outcomes enter one idempotent cancellation path, every
accepted stake can be claimed and withdrawn exactly once, fee remains zero on
refund, settlement payout and platform-fee withdrawals consume all liability,
and tournament closure is rejected until liability is exactly zero. This is a
test-only local escrow probe; Solidity accounting remains authoritative and no
network transaction is implied.

The completed lifecycle now projects its finalized tournament, match and
bounded verdict records into the SQLite-backed API, then closes and reopens the
database and reads them through the public HTTP router. The projection preserves
canonical bracket rounds (including preliminary round zero), exposes the public
cancellation state, rejects impossible match state/winner combinations, and
makes finalized match/verdict replay idempotent while rejecting conflicting
rewrites. Public readback contains no `AGENTS.md`, raw model output or topic.

The local implementation candidate is frozen by
`docs/LOCAL-RELEASE-CANDIDATE.json`. Its test recalculates one deterministic
SHA-256 bundle over the recorded contract, runtime, frontend-source, script and dependency
files, so source drift fails `npm run check` until the manifest is deliberately
reviewed and refreshed.

## Evaluation and wallet recovery hardening, 2026-09-16

Evaluation campaign reads now use the durable SQLite runner record, so API
campaign lists, detail, Agent statistics, comparison checks and Marketplace
qualification observe worker transitions without a process restart. Legacy
owned campaigns with no Evo fee record return an explicit empty fee response
while retaining their campaign and run history. Evo failures expose bounded
stage and code metadata. An uncertain GenLayer submission enters
`RECOVERY_REQUIRED` and retains the held fee instead of being replayed or
automatically refunded; a transient receipt read retries the same transaction.

Managed CCTP operations can be listed by their authenticated owner and restored
in the Account UI after reload. Replay keys are not returned. Uncertain Circle
errors expose only a safe reconciliation message. A source burn marked
`SUBMITTED` still does not prove the destination mint on Arc. Destination
finality verification, live payment receipts, Marketplace `MKT-5` and live
Tournament lifecycle evidence remain open. No new network transaction or
deployment was performed in this local hardening batch.

The owner reprioritized the live acceptance work on 2026-09-16: Tournament,
Evo and Marketplace take precedence over CCTP. The local Account UI no longer
offers new CCTP initiation, but still reads and refreshes earlier operations.
CCTP status is separate from Arc withdrawal state, so an old pending operation
cannot disable or erase a new direct Arc transfer status.
CCTP destination-mint verification is deferred, not passed. Direct Arc USDC
deposit and withdrawal remain in the core acceptance plan.

The executable API now requires an explicit local database path. Agent
`AGENTS.md` version history, published tournament metadata and immutable
prepared-registration payloads survive service restart; authentication
challenges and sessions intentionally remain process-local and require a fresh
signature after restart.

The Account screen now owns the Tournament credits experience instead of a
top-level Credits route. Its authenticated registration index is owner-scoped
and exposes only Tournament/entrant identifiers; the browser then verifies the
entrant wallet and registration against Arc before listing it. A Claim action
is offered only when `creditOf` is positive, waits for an Arc receipt and
refreshes the canonical credit after confirmation. The legacy `/credits` URL
redirects to `/account?tab=credits`.

R2 REWORK-1 specifically passes `18/18` focused tests and now rejects bool-as-int,
zero identity/commitment fields and malformed quorum bundle members as required.
Direct invocation of `normalize_rpc_bundle` with a non-dict still raises
`AttributeError`; that helper-level hardening is recorded as residual future work
because Arc-source quorum is no longer on the MVP path.

Those spike results prove local parser/math behavior only. Separately, the
`ArenaMatchJudge` feasibility now proves one contract design can judge multiple
text topics, expose bounded reasons, resist the tested output injection, return
 a deterministic identical-output tie, and accept 16,384-byte outputs. The active
deployment revision V10 retains the `GeneralResponseV7` rubric, which audits
rationale support during consensus, separates clarity from
correctness, maps score differences of 20 points or less to a tie, and makes
intentional-harm safety decisive. The archived V8 revision's 32-case Studionet
regression finalized 32/32 allowed verdicts, including 3/3 stable semantic ties
and four exact-swap relations that preserved the winning artifact. It does not
prove operator honesty or broad statistical reliability. V9 separately has 12
finalized successful lifecycle transactions whose canonical verdicts and bounded
reasons were re-read. V10 has two finalized 16 KiB-per-side boundary transactions:
the deterministic identical-output path returned canonical `FINAL/TIE`, while a
distinct-output semantic judgment reached `MAJORITY_AGREE/SUCCESS` and canonical
`FINAL/A_WIN` with a 90-0 score. Deployed source and immutable owner/config
readbacks also match. V10 has not rerun the complete historical corpus or
eight-entrant lifecycle.

## Policy status

The parent workspace now contains an explicit exception applying only to the
exact `async-agent-arena` child repository. Therefore:

- local contracts, services, frontend, tests and reviewed dependencies may be
  implemented in the dependency order;
- Evidence authenticity and Differentiation remain `FAIL`/`OPEN` rather than
  being falsely upgraded;
- the project cannot claim `SELECTED`, trustless or gate-compliant submission
  readiness from this exception; and
- the owner granted and consumed bounded action-time authorization for the V10
  deployment and boundary smoke, plus the earlier paid/testnet lifecycle; that
  authorization does not imply
  hosting, publishing, mainnet operation or submission permission.

## Next primary-agent action

Wallet-signature and email-OTP authentication plus resumable Circle
developer-controlled wallet provisioning are implemented locally behind a
complete server-only configuration gate. The code pins
`@circle-fin/developer-controlled-wallets` `10.8.0`, creates one
`ARC-TESTNET` SCA per Arena identity, persists the UUID v4 idempotency key before
the Circle call, does not persist raw email, and exposes only safe account
metadata. The frontend now restores the managed session, offers wallet or email
login, displays the managed address, and blocks Tournament writes instead of
falling back to the sign-in wallet. No Circle API mutation, SMTP delivery,
funding or Arc transaction was performed. Migration of Tournament registration
and claim to Circle contract execution remains open and must not be represented
as complete.

The 2026-09-15 SCA/Gas Station change is local only: existing EOA metadata is
archived, the new active SCA uses a fresh idempotency key, and no testnet asset
or legacy Agent ownership is moved. Gas sponsorship depends on Circle's active
default policy and limits on each source/Arc network. Live SCA creation,
Gas Station sponsorship and CCTP readback have not been verified by this edit.

The bounded `EVAL-3`/`EVAL-4` runtime slice is now implemented locally:
immutable EvaluationRun bindings, distinct provider states, SQLite persistence,
V5 submission/finality, canonical scorecard readback, a multi-scenario `SOLO`
runner, classified retry/resume, immutable Test Pack/campaign records and public/owner Run Detail projections.
Authenticated Evo execution is now wired locally through a server-owned six-case
`ACTION_DECISION` pack. The API persists an idempotent fee binding before charging
the managed Arc wallet in configured USDC, and advances the campaign only after
Circle returns an Arc transaction hash. GenLayer submission is signed separately
by the configured Studio Next owner key, so GenLayer gas is never included in or
deducted from the user-facing Evo fee. The UI exposes the configured fee and is
disabled when the execution configuration is incomplete. No paid provider request,
USDC charge, or new GenLayer transaction was sent by this local implementation.
Test Pack editing/version management remains separate.
The deterministic `EVAL-5` slice now compares isolated baseline/candidate Agent
versions only across exact Test Pack, scenario, generation policy, rubric and
required-run bindings. Its versioned policy applies repeated-run coverage and
variance, per-dimension minimum/drop thresholds, overall drop and critical-rule
zero tolerance; incomplete, incomparable, infrastructure and unstable outcomes
remain distinct. Comparison records contain digests/IDs and aggregate results,
not `AGENTS.md` or raw provider output, and survive SQLite restart. The audited
additive/no-rewrite plan for EVAL-6 is in
`docs/EVAL-6-BACKWARD-COMPATIBILITY-PLAN.md`. EVAL-6 is now implemented: legacy
Tournament evidence projects without rewrite, new attempts use the Evaluation
provider envelope and rich GenLayer ComparisonRun, and only finalized eligible
A/B results advance. Tie/retry/failure remains fail-closed. Arc settlement math,
refund and zero-liability rules remain unchanged.
The executable tool sandbox remains an optional compute-dependent Level 3
roadmap item, not the current critical path.

The EvaluationRun worker now reconciles an ambiguous GenLayer submission by
canonical `run_id` readback before retrying. It waits 30 seconds, replays the
exact idempotent submission at most once, and escalates only after a bounded
10-minute timeout. A matching canonical result can finalize without a recovered
transaction hash. Public Evo score projections now expose an effective score of
zero for deterministic policy findings or critical safety/rule failures while
retaining the canonical GenLayer dimension grades in the private audit record.

The shared Evo/Tournament model transport accepts an optional independent
OpenAI route configured by `FALLBACK_API_KEY` and `FALLBACK_MODEL`, with
`FALLBACK_END_POINT` available to override the standard OpenAI URL. It reuses
the evaluation input and output-token bound only after the primary request or
response body reaches its local timeout. The fallback remains disabled until
the API key and model are both configured.
On 2026-09-17, the local routing order changed: the existing OpenAI credentials
(`FALLBACK_*`) are primary, and the Cheap credentials (`API_KEY`, `END_POINT`,
`MODEL`) are fallback. Both routes must be configured for execution. This is a
local source change; no provider request or production release is implied.
Tournament switches both sides of a pair to the fallback model after a primary
timeout and persists that decision for restart. Evo records the actual model on
each scenario. Comparison and Marketplace eligibility accept mixed-model
cohorts that pass their score and policy gates, while retaining model provenance.

On 2026-09-18, Evo Core v3 changed the evidence capability used by the second
scenario. Its three variants now expose one inert `evidence.read_set` proposal
with a `resources` argument and a one-action limit. This lets an Agent request
multiple distinct evidence resources without emitting the same action ID twice,
which the deployed AgentEvaluationJudge V5 deterministically classifies as
`DUPLICATE_ACTION`. Existing v2 campaigns and results remain immutable. This is
a local Test Pack/backend change and does not modify or redeploy a GenLayer
contract.

Marketplace phases `MKT-0` through `MKT-2` are implemented and their Arc
contracts are deployed on Arc Testnet. The locked
eligibility policy requires six scenarios with two finalized runs each, exact
Agent/version/Test Pack/rubric/network bindings, 100% coverage, bounded score
spread, minimum overall/dimension scores and zero critical deterministic
findings. `AgentRegistryV2` preserves the immutable version/commitment while
allowing ownership transfer only through its one-time configured Marketplace.
`AgentMarketplace` accepts only operator-authorized eligibility digests, escrows
ERC-20 USDC, transfers ownership atomically and fixes the platform fee at 100
basis points (1%) with seller/platform pull credits. Persistent API/delivery
(`MKT-3`) and browser/Circle flows (`MKT-4`) are implemented locally: public
listings reconcile only from strict Arc readback, managed SCA listing performs
the contract call, managed SCA buying performs approval plus purchase, and
private AGENTS.md delivery requires the current canonical buyer owner. The
authorized purchase lifecycle (`MKT-5`) remains open because no live listing,
approval, purchase or transfer was made. `AgentRegistryV2` is at
`0xc427dBf5Dc0b58245Ac94d6634856Dd472bdEada`; `AgentMarketplace` is at
`0x48c15e258D9b87933B823c91Ace6EBC209Fba2Df`. Canonical readback confirms the
owner/operator/platform recipient, registry binding, Arc USDC address and fixed
100 BPS fee. No eligibility authorization, listing, approval, purchase or USDC
transfer was made. Deployment evidence is in
`docs/evidence/arc-testnet/marketplace-deployment-2026-09-16.json`.

The remaining real browser-wallet lane stays open for the existing Tournament
mode: connect a detected EVM wallet, switch/add Arc Testnet, submit a real
registration from the frontend, expose submitted/confirmed/canonical readback,
and execute a real credit or refund withdrawal without CORS failure. It is no
longer the next product-design dependency, but remains required before claiming
the Tournament browser lifecycle complete. Successful live tournament, match and
verdict records are already projected into the API/UI; backend state must not be
presented as Arc finality.

On 2026-09-15 the owner approved an Arc-bound Agent lifecycle. A local
`AgentRegistry` contract, Circle contract-execution adapter, authenticated API
routes and Agent management UI now implement registration, private detail,
copy, exact-name deactivation and evidence-derived activity metrics. This work
has local test evidence only: `ARC_AGENT_REGISTRY_ADDRESS` is intentionally
required, but this registry has not been deployed or called on Arc and no new
transaction has been signed. Existing legacy match rows without canonical Agent
IDs produce an unavailable match count instead of a fabricated value.

The active Arc escrow V2 is locally covered by 14 Foundry tests and has
constructor/readback plus exact-match explorer verification evidence. Its
automatic payout worker has six focused tests, including isolated recipient
failure and SQLite restart. The previously funded lifecycle belongs to archived
V1; a funded V2 tournament/payout receipt set remains open. Hosting is active on
the owner VPS, while repository publication and submission have not been
performed.

On 2026-09-16 the production `TournamentOperationsPort` was attached to the API
runtime. Create, lifecycle transitions, settlement and refund use the deployed
Arc Testnet `TournamentEscrow`; pair outputs use the shared provider policy and
the deployed `ArenaComparisonJudge` on Studio Next. The runner checks every
prepared entrant against canonical Arc bindings, persists provider, GenLayer
and ranking state in SQLite, and never accepts a ranking or payout amount from
the control-plane request. Local verification covers restart-safe settlement
and the insufficient-entrant refund path. Read-only checks confirmed Arc chain
ID 5042002 with escrow bytecode and Studio Next chain ID 61997 with
`AgentComparisonV1` canonical configuration. No Tournament was created and no
paid provider or chain write was performed during this verification.

## Daily Tournament scheduling (local implementation)

The API can run one opt-in Daily Tournament sequence when
`ARENA_DAILY_TOURNAMENT_STAKE_UNITS` is set to a positive Arc ERC-20 USDC amount
in six-decimal base units. The first registration opens after the worker creates
its Arc Tournament. Its roster closes and the bracket begins at the next
00:00 UTC. Daily intents are persisted before the Arc creation attempt, so a
restart retries the same policy and ID. The worker progresses judging,
settlement or refunds and creates the next registration only after Arc reports
`COMPLETED` or `REFUNDED`. If a run overlaps a UTC midnight, that day's start is
skipped. The start snapshots the accepted roster and stores a random bracket
seed before processing the first match. The public API rejects registration
preparation at or after closing time and while a run is active.

The owner set the daily stake to 1 Arc Testnet USDC per Agent and authorized
commit, push and VPS deployment on 2026-09-16. Compose passes `1000000`
six-decimal base units to the API and no longer starts the one-shot reference
Tournament. The local checks do not themselves prove a live Arc creation;
production readback is required after deployment.

## Coding Agent workflow (paused by owner)

The documented handoff workflow remains available, but the owner currently
requested that the primary agent implement and audit directly. When re-enabled,
the owner-operated Coding Agent implements mechanically, writes one unique ignored result under
`.handoffs/results/`, and returns only its path/status. The primary agent then
audits scope, RED/GREEN evidence, regression, security and claims before the next
batch.
