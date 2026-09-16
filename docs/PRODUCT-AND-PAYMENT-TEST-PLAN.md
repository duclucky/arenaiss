# Arena ISS live website acceptance plan

- Status: `PROPOSED`
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

### WEB-1: Public product and authentication

Open every route in a clean browser. Verify navigation, Docs, responsive layout,
loading and error states. Run email and wallet login, logout, session expiry and
cross-account isolation.

### WEB-2: Account payments

Run one real CCTP deposit from the Account page through burn, attestation and
mint. Reload while pending and confirm tracking resumes. Then run one direct Arc
USDC withdrawal to an external address. Reconcile source and destination ERC-20
balances, keeping native Arc gas separate.

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

For an infrastructure failure, use a dedicated campaign and stop only its real
worker after the Arc deposit is final. Do not forge state. Verify the operator
refund returns exactly 1 USDC.

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

Create a real campaign through the operator product surface. Register eight
distinct accounts through the website with real stakes. Run the real bracket,
settle on Arc, verify Top 5 credits, fixed 10% fee and all withdrawal receipts.

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

During dedicated cases, close or reload the browser, let a session expire,
restart the real API after a durable external operation ID exists, and retry from
two tabs. Verify the original operation resumes and no extra charge is created.

## Evidence

For every case record the deployed Git revision, UTC timestamps, masked account,
page URL, browser actions, before and after balances, transaction hashes, blocks,
contract states, API projection, screenshots, console errors and reconciliation.
Use `PASS`, `FAIL`, `BLOCKED_BY_UI` or `BLOCKED_BY_CONFIGURATION`.

Stop all financial cases on any lost, duplicate, misdirected or unreconciled
funds, wrong network, wrong spender, ownership mismatch or private-data leak.

## Exit criteria

All released flows must pass from the deployed website with real services and
testnet receipts. Evo success and both refund paths, Marketplace settlement and
delivery, Tournament settlement and refund, CCTP and direct Arc withdrawal must
all reconcile. There must be no open fund-safety or authorization defect.

Backend-ready version comparison is not a released website feature until its
dedicated UI passes this same process. Planned sandbox and trust-minimization
features are outside the current release.
