# Arc `TournamentEscrow` safety cards (local MVP)

All amounts are ERC-20 USDC base units (six decimals). Arc native USDC gas is
not a second balance and never enters escrow accounting. The contract is
configured for exactly `1_000` BPS platform fee and five locked payout BPS that
sum to `10_000`; callers never provide payout amounts. The escrow deployer is
the immutable `owner`; every tournament policy must route its 10% fee to that
owner wallet.

| Write | Caller | State/time guard | Idempotency | Value effect | Negative proof |
|---|---|---|---|---|---|
| `createTournament` | any creator; policy names immutable operator and must name immutable owner as fee recipient | no existing ID; `open < close <= start < expiry` | duplicate ID rejects | none | invalid bounds, wrong fee recipient, zero addresses, bad BPS |
| `register` | entrant wallet | `DRAFT`; `open <= now < close` | entrant ID and wallet unique | exact stake `transferFrom`; increments locked stake | early/late, duplicate, malformed identity |
| `closeRegistration` | permissionless scheduler | `DRAFT`; `now >= close` | state guard | none | early/wrong state |
| `markRunning` | permissionless scheduler | closed; `now >= start`; min entrants | state guard | none | early/insufficient entrants |
| `settleByOperator` | configured operator only | `RUNNING`; five unique registered IDs; nonce increases | one terminal settlement | contract derives fee/credits; remainder rank 1 | wrong caller, duplicate/unknown ranking |
| `cancelAndOpenRefunds` | configured operator only | pre-settlement; insufficient after close or expiry | one cancellation | clears locked stake; no fee | early/wrong caller/state |
| `claimRefund` | registered wallet | refundable state; one claim per wallet | refund flag | creates exact stake credit | wrong entrant/duplicate |
| `withdrawCredit` | credit holder | positive credit | debit-before-transfer | decrements liability, transfers credit | empty credit, failed transfer |
| `withdrawCreditFor` | any relayer/keeper | beneficiary has positive credit | debit-before-transfer; duplicate payout sees zero credit | decrements liability and transfers only to that same beneficiary; caller cannot redirect funds | zero/duplicate credit, failed transfer restores credit/liability, relayer balance unchanged |
| `withdrawPlatformFee` | configured fee recipient | positive fee credit | zeroes before transfer | decrements liability, transfers fee | wrong caller/empty fee |
| `withdrawPlatformFeeFor` | any relayer/keeper | positive fee credit | zeroes before transfer; duplicate payout sees zero credit | decrements liability and transfers only to the immutable owner/locked fee recipient | empty fee, failed transfer restores fee/liability, relayer balance unchanged |
| `closeTournament` | any caller | settled/refundable and `totalLiability == 0` | terminal state | no value movement | outstanding liability/locked stake |

Automatic payout is a keeper convenience layered over the same pull-credit
ledger. A failed automatic transfer cannot block settlement or another winner;
the untouched beneficiary credit remains available through `withdrawCredit`.

The local cancellation path deliberately exposes `claimRefund` rather than
looping over an unbounded mapping. The production coordinator must enumerate
the canonical entrant IDs from events/views and each wallet claims exactly once.
This keeps liveness permissionless without introducing a keeper-dependent loop.
