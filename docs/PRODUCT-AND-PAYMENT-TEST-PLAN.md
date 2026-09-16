# Arena ISS live website acceptance plan

- Status: `ACTIVE`, observation-only live acceptance, updated 2026-09-16
- Target: `https://arenaiss.xyz`
- Networks: Arc Testnet and GenLayer Studio Next
- Evidence: real browser actions, real hosted services, real testnet receipts

## Rules

Acceptance starts from the deployed website UI. Do not use preview records,
seeded storage, mocked providers, fake receipts, direct database edits, or an API
call that bypasses a missing UI control. API logs, RPC reads and explorers may be
used only to diagnose and reconcile an action started in the website.

Local automated checks remain release guards. They are not live acceptance
evidence.

Before financial execution, record the approved test accounts, maximum Arc
Testnet USDC budget, maximum provider-call budget and maintenance window. Never
use mainnet or expose credentials, sessions, private Agent content or keys.
The owner authorized Arc Testnet USDC funding from the owner wallet to the
seven preparatory wallets if needed. Verify each destination wallet belongs to
the intended test account, fund only the shortfall for its 1 USDC stake and
required gas, and record each confirmed funding receipt before registration.
Do not treat a sent transaction as a confirmed balance or expose wallet keys.

During live acceptance, do not edit source, deploy, change configuration, seed
or rewrite database state, restart workers to manufacture a failure, or repair
an observed defect. Record the defect, its evidence and impact, then continue
only with independent safe cases. Release fixes belong to a later, separately
authorized phase.

## Pass condition for one case

1. A user or operator starts the action in `arenaiss.xyz`.
2. The UI states network, amount, fee, recipient and pending state accurately.
3. Duplicate clicks cannot create duplicate external operations.
4. Every required Arc and Studio Next receipt finalizes on the expected network.
5. UI, API projection and canonical contract state agree.
6. USDC changes reconcile exactly at six decimals.
7. Reload, logout and login preserve the final state.
8. Another account cannot read or mutate private state.
9. Browser console and network errors are captured with a recovery path.

## Ordered execution

First prepare the time-bound Tournament case below. Then run public/auth and
Agent prerequisites, two Evo campaigns, Marketplace eligibility through
purchase, delivery and claims, and remaining Tournament/refund cases. Arc
account deposits and withdrawals support these paths. CCTP is not a
prerequisite for any core case.

### WEB-0: Time-bound Tournament setup and judge reference

Use the bounded one-time system launch backed by the configured operator signer
to create one real Arc Testnet Tournament
with exactly eight places, minimum eight entrants, and a stake of 1 USDC
(`1000000` ERC-20 base units) per wallet. Registration opens immediately and
closes at the configured start time, 30 minutes after the confirmed creation
time. Record the UTC creation, close, start and expiry timestamps from the
canonical Arc policy, not just browser-clock calculations.

Before the close time, the tester uses seven distinct controlled accounts to
register one real, versioned Agent per account through the live website. Each
registration must produce a successful Arc receipt. The contract permits one
entrant per wallet, so seven Agents under one wallet do not satisfy this setup.
The system operator signer creates and progresses the Tournament but never
registers a user entrant. Preserve the eighth place for the account already
signed in to the user's in-app browser. Do not switch, log out or use that
account while preparing the seven entries. Verify the Arc entrant count is
exactly seven and the website still offers the final registration. Record each
entrant ID, masked wallet, Agent version/commitment, stake receipt and
timestamp without exposing private `AGENTS.md` content.

The tester then uses the preserved in-app session as entrant eight. Confirm the
Arc count is eight and that the website reports the same roster and schedule.
Observe the real provider outputs, Studio Next comparison verdicts, bracket
progression and Arc settlement. The finalized match and verdict records may
serve as reference data for judge assessment, but do not label them an
independent authenticity proof or change judge policy during this acceptance
run. Preserve exact transaction links and bounded public evidence for later
analysis.

The one-time system launch is setup evidence, not a website UI pass. If it does
not yield an Arc receipt and public Tournament projection, mark setup blocked
and do not substitute a 24-hour Tournament. It is `BLOCKED_BY_ACCESS` if seven
distinct funded user accounts are unavailable. Test their registration only
through the live website and report the actual result.

### WEB-1: Public product and authentication

Open every route in a clean browser. Verify navigation, Docs, responsive layout,
loading and error states. Run email and wallet login, logout, session expiry and
cross-account isolation.

### WEB-2: Arc account payments

Run one direct Arc USDC deposit to the managed wallet and one direct Arc USDC
withdrawal to an external address. Reconcile sender and recipient ERC-20
balances, keeping native Arc gas separate. The Account page must not offer a new
CCTP transfer while that feature is deferred. Existing CCTP operations must
remain readable after reload so pending users are not stranded.

### WEB-3: Agent lifecycle

Create an Agent, verify Arc registration, reload, reopen private details and
deactivate it. The confirmation modal must accept normal continuous typing,
support keyboard dismissal and preserve immutable public history.

### WEB-4: Evo success

Run two complete Evo campaigns for the same Agent version. For each campaign,
verify the 1 USDC Arc escrow deposit, real provider execution, Studio Next
judgments, final score, receipt links and fee release. Verify the owner wallet,
not the user, pays Studio Next gas.

### WEB-5: Evo refunds

For an infrastructure failure, observe a naturally occurring dedicated
campaign if one occurs. Do not stop a worker or forge state to manufacture it.
Verify the operator refund returns exactly 1 USDC; otherwise mark this case
`NOT_OBSERVED`, not `PASS`.

For timeout recovery, isolate a second real campaign, wait the full 24-hour
contract delay, then claim from the website. Verify an early claim is disabled,
another account cannot claim, a second claim transfers nothing and the campaign
cannot later release the same fee.

### WEB-6: Marketplace

Use the two real Evo campaigns. The seller selects the Agent without manually
typing digests or judge addresses. The operator reviews score, coverage and
expiry, then approves on Arc from the restricted UI. The seller lists a decimal
USDC price. A different account buys once.

Verify registry ownership transfer, private delivery to only the buyer, seller
credit, fixed 1% platform credit and the seller withdrawal.

```text
platform fee = floor(price * 100 / 10000)
seller credit = price - platform fee
buyer decrease = price
```

Reject one-campaign, wrong-version, unapproved, expired, self-purchase and second
purchase cases without invalid writes.

### WEB-7: Tournament success

Use a separately approved bounded system launch to create a real Arc Testnet
Tournament, then register eight distinct accounts through the website with real
stakes. The system operator signer owns the lifecycle actions; no caller may
submit ranking or payout amounts. Run the real bracket, settle on Arc, verify
Top 5 credits, fixed 10% fee and all withdrawal receipts.

```text
pool = sum(confirmed stakes)
platform fee = floor(pool * 1000 / 10000)
net prize = pool - platform fee
sum(Top 5 credits) = net prize
```

### WEB-8: Tournament refund

Create a separate campaign, register fewer than the minimum, wait for the real
deadline and trigger the documented cancellation path from the website. Verify
every confirmed stake returns, no platform fee is charged, double refund fails
and campaign liability reaches zero.

### WEB-9: Recovery and concurrency

During dedicated cases, close or reload the browser, let a session expire and
retry from two tabs where safe. Observe a naturally occurring API restart only;
do not restart production to manufacture the condition. Verify the original
operation resumes and no extra charge is created, or mark it `NOT_OBSERVED`.

## Evidence

For every case record the deployed Git revision, UTC timestamps, masked account,
page URL, browser actions, before and after balances, transaction hashes, blocks,
contract states, API projection, screenshots, console errors and reconciliation.
Use `PASS`, `FAIL`, `BLOCKED_BY_UI`, `BLOCKED_BY_ACCESS`,
`BLOCKED_BY_CONFIGURATION` or `NOT_OBSERVED`. Report each defect with a stable
ID, severity, exact reproduction, expected versus actual result, monetary
exposure, receipt links and the last safe state. Summarize case totals and
unreconciled liabilities without repairing them during the test phase.

Stop all financial cases on any lost, duplicate, misdirected or unreconciled
funds, wrong network, wrong spender, ownership mismatch or private-data leak.

## Deferred: CCTP

CCTP initiation and destination-mint acceptance are outside the current core
release. Resume this lane only after Tour, Evo and Marketplace pass their live
website cases. Before exposing it again, verify an actual source burn,
attestation, destination mint, cross-chain balance reconciliation and recovery
after reload. A source `SUBMITTED` status alone is not destination completion.

## Exit criteria

All released flows must pass from the deployed website with real services and
testnet receipts. Evo success and both refund paths, Marketplace settlement and
delivery, Tournament settlement and refund, and direct Arc deposit and withdrawal
must all reconcile. There must be no open fund-safety or authorization defect.

Backend-ready version comparison is not a released website feature until its
dedicated UI passes this same process. Planned sandbox and trust-minimization
features are outside the current release.
