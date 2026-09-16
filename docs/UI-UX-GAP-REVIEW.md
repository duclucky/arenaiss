# Arena ISS UI and UX gap review

- Reviewed: `2026-09-16`
- Sources: deployed website observation and current frontend/API/contract code
- Scope: released product surfaces and value-bearing recovery paths

## Completed in the current local change

| Area | Previous gap | Current behavior |
| --- | --- | --- |
| Evo results | Failed campaign showed unrun scenarios as `Pending` | Unrun scenarios show `Not run` |
| Evo fee | User could not see held, released or refunded fee state | Owner-private fee projection shows escrow state and Arc refund receipt |
| Evo timeout | Contract supported payer timeout refund but website had no control | Website shows the recorded deadline and enables the payer action after 24 hours |
| Marketplace eligibility | User manually typed version digest, campaign IDs and judge address | Website derives them from owned Agent, finalized Evo records and Studio Next config |
| Marketplace price | UI requested USDC base units | UI accepts decimal USDC and converts to six-decimal base units |
| Marketplace approval | Operator approval route had no usable website flow | Restricted review lists score, coverage and expiry, then signs on Arc server-side |
| Marketplace delivery | Buyer-private delivery API had no entry point | Canonical buyer can open private AGENTS.md from the sold listing |
| Marketplace proceeds | Contract credit and withdrawal had no user flow | Seller sees canonical Arc credit and withdraws through the managed SCA |
| Marketplace platform fee | Platform recipient credit had no restricted surface | Operator sees canonical Arc credit and withdraws through the configured signer |
| Marketplace cancellation | Seller could not cancel an active listing | Current seller can cancel through the managed SCA and receives canonical Arc state |
| Legacy network evidence | Old Tournament receipts looked like current Studio Next activity | Non-61997 GenLayer receipts are explicitly labelled as historical evidence |
| Marketplace recovery | Errors had no immediate recovery action | Error panel offers canonical state refresh and financial controls stay disabled while busy |
| Tournament operations | Create, progress, settle, expire and refund were script-only | Authenticated operator API and restricted UI expose bounded commands through an injected live runner port; ranking and payout inputs are never accepted |
| Version comparison | Comparison was backend-only | Agent detail exposes safe version metadata and compares finalized Evo evidence under locked regression thresholds |
| Evo execution | Browser had to stay open and mutate campaign state | API worker resumes held campaigns after restart; browser submits once and polls read-only status |

## Remaining release gaps

| Priority | Gap | Required work |
| --- | --- | --- |
| P1 | Hosted Tournament control plane still needs the live runner composition | Provide the production `TournamentOperationsPort` when creating the API server, then execute real Arc and Studio Next browser acceptance. The route returns 503 when the port is absent. |

The remaining P1 deployment item blocks a claim that every payment and operator
flow can be tested solely from the hosted website. It must not be bypassed with
scripts in live acceptance.
