# Phase 2 — Value-destination matrix (admission draft)

> **Requires MVP refresh:** the 10%/90%, refund, credit and withdrawal accounting
> remains useful, but proof-trigger assumptions are superseded. Phase 1 must
> freeze a new matrix where configured-operator ranking authorizes settlement and
> Arc still derives every amount.

All amounts below are integer micro-USDC (`1 USDC = 1,000,000`); native Arc gas
is the same USDC asset represented at 18 decimals and is never added to escrow
accounting. API and GenLayer execution costs are platform-operations expenses,
not deductions from a tournament purse.

| Purse/credit | Payer/source | Locked state and amount | Release/refund/forfeit destination | Terminal states | Duplicate/late/retry behavior | Canonical proof view |
| --- | --- | --- | --- | --- | --- | --- |
| Entrant entry stake | Player wallet via Arc USDC `transferFrom` | `registerEntrant` in `REGISTRATION_OPEN`; exact policy stake in micro-USDC; one stake per entrant ID | Remains in escrow until verified ranking, or 100% refund credit on cancellation/expiry; never sent to coordinator | `SETTLED` (allocated) or `CANCELLED` (refundable), then `CLOSED` only at zero liability | Duplicate entrant or wrong amount rejects with no balance delta; late registration rejects; retryable match does not forfeit stake | `entrantView`, `grossPool`, `liability`, token transfer receipt, roster digest |
| Gross tournament pool | Sum of all accepted entry stakes | Locked at roster lock; `grossPool = entrantCount × entryStake` | Deterministically partitions on verified settlement into platform fee + winner credits; cancellation maps whole gross pool to refunds | `SETTLED` or `CANCELLED`; never partially allocated | A failed proof, retry, or duplicate delivery leaves gross pool untouched; no partial settlement | `accountingView(tournamentId)` with gross, net, fee, credits, refunds |
| Platform fee | Derived from gross pool by Arc code | `platformFeeBps = 1,000` immutable; `fee = floor(gross × 1,000 / 10,000)` only after accepted operator settlement | Fee credit to the escrow deployer's immutable `owner` wallet; owner may pull or any relayer may trigger delivery only to that locked owner | `SETTLED` then withdrawn; zero on `CANCELLED` | Invalid/replayed ranking creates no fee; duplicate withdrawal rejects; transfer failure keeps credit | `feeCredit`, `platformFeeBps`, owner, settlement digest, USDC receipt/balance delta |
| Net prize pool | `grossPool − platformFee` | `netPrizePool = gross − fee`; five payout BPS are locked per tournament and must sum to `10,000` | Winner credits derived by Arc code, never from validator prose; ranks 1–5 only when objectively determined | `SETTLED` then all credits withdrawn; no prize allocation on cancellation | Missing/duplicate/invalid rank or accounting mismatch reverts before credits; duplicate proof cannot add credits | `netPrizePool`, `winnerCredits[1..5]`, ranking digest, conservation invariant |
| Winner rank 1–5 credit | Net prize pool | `floor(net × payoutBps / 10,000)` per rank; all five entries locked for 8–32 entrant policy | Credit to the wallet bound to the finalized roster/ranking; operations relayer normally triggers delivery, while the wallet retains pull withdrawal as fallback; no alternate recipient | Credit exists after `SETTLED`, becomes zero after successful withdrawal | Zero/duplicate withdrawal rejects; relayer cannot redirect funds; one failed recipient keeps its credit/liability and does not block other payouts | `creditView(tournament, wallet, rank)`, withdrawal receipt, balance delta |
| Rounding remainder | Integer division residual `net − sum(floored credits)` | Destination `rank_1` locked in policy; exact residual added once to rank-1 credit | Rank-1 winner credit | Settled with rank-1 credit; zero on cancellation | Any alternate destination or second application fails accounting invariant; duplicate settlement cannot add residual | `roundingRemainder`, rank-1 credit, conservation view |
| Cancellation/refund credit | Escrow-held entrant stake | Entire original stake per accepted entrant; platform fee `0`; created only by valid cancellation/expiry | Pull refund to the original entrant wallet | `CANCELLED` then withdrawn; `CLOSED` only at zero refunds | Early/unauthorized/duplicate cancel rejects; retryable path does not silently forfeit; transfer failure keeps refund credit | `refundCredit`, cancellation reason, liability, transfer receipt |
| Unclaimed fee/winner/refund credit | Existing escrow liability | Credit remains recorded until recipient withdraws; close forbidden while positive | Same locked recipient; no sweep to operator while owed | `SETTLED`/`CANCELLED` active liability; `CLOSED` only after zero | Duplicate withdrawal rejects; no expiry-based confiscation in MVP; recovery must preserve owner binding | `totalLiability`, per-credit view, withdrawal status |
| External model/API budget | Platform operations treasury | Per-call cap and tournament cap are platform policy; never part of gross pool | Provider billing account through selected adapter (API key, prepaid, or optional x402) | Job `PAID`, `RETRYABLE`, or `FAILED`; does not alter entrant escrow | Duplicate job key must not create an extra billable call beyond documented provider delivery; cap stops new calls | Operations ledger/job receipt, not an Arc tournament accounting view |
| GenLayer execution/gas budget | Platform operations treasury | GEN budget reserved externally; no deduction from USDC purse or entrant credit | GenLayer transaction fee payer/operations wallet | Transaction `FINALIZED`, `EXECUTION_FAILED`, or `RETRYABLE` | Ambiguous status is queried before retry; failure leaves Arc purse unchanged and entrant non-penalized | GenLayer canonical transaction status plus operations receipt |

## Conservation and terminal rules

For every accepted settlement:

```text
grossPool = platformFee + sum(winnerCredits[1..5])
```

For every cancellation:

```text
refundTotal = grossPool
platformFee = 0
winnerCredits = 0
```

`closeTournament` is legal only when `totalLiability == 0` and no pending
settlement/retry branch can still create a credit. A rejection must preserve the
pre-call accounting snapshot. These are admission invariants; Solidity
property tests and live Arc receipts belong to the later implementation phases.
