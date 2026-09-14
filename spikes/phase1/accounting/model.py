"""Integer-only top-five USDC destination and conservation prototype."""


class AccountingError(ValueError):
    """Raised when a value destination or conservation invariant is invalid."""


def compute_accounting(*args, **kwargs):
    return _compute_accounting(*args, **kwargs)


def verify_accounting_fixture(*args, **kwargs):
    return _verify_accounting_fixture(*args, **kwargs)


def _fail(message):
    raise AccountingError(message)


def _compute_accounting(entrant_count, policy):
    if not isinstance(entrant_count, int):
        _fail("entrant count must be an integer")
    if entrant_count < policy["min_entrants"] or entrant_count > policy["max_entrants"]:
        _fail("entrant count is outside the locked range")
    if policy.get("platform_fee_bps") != 1000:
        _fail("platform fee must be immutable 1,000 BPS")
    stake = policy.get("entry_stake_micro_usdc")
    if not isinstance(stake, int) or stake <= 0:
        _fail("entry stake must be positive integer micro-USDC")
    payout_bps = policy.get("payout_bps")
    if not isinstance(payout_bps, list) or len(payout_bps) != 5:
        _fail("top-five payout BPS must contain exactly five entries")
    if any(not isinstance(value, int) or value < 0 for value in payout_bps):
        _fail("payout BPS must be non-negative integers")
    if sum(payout_bps) != 10000:
        _fail("top-five payout BPS must sum to 10,000")
    if policy.get("rounding_remainder_destination") != "rank_1":
        _fail("rounding remainder destination must be locked to rank_1")
    if policy.get("tie_policy") != {
        "first_tie": "rematch_with_new_committed_topic",
        "max_rematches": 1,
        "after_rematch_tie": "criterion_priority_then_seeded_tiebreak",
        "retryable_or_expired": "cancel_match_and_refund",
    }:
        _fail("tie retry/fallback policy is not locked")

    gross = entrant_count * stake
    fee = gross * policy["platform_fee_bps"] // 10000
    net = gross - fee
    credits = [net * basis_points // 10000 for basis_points in payout_bps]
    remainder = net - sum(credits)
    credits[0] += remainder
    if fee + sum(credits) != gross:
        _fail("USDC conservation invariant failed")

    power = 1 << (entrant_count.bit_length() - 1)
    preliminary = entrant_count - power
    byes = 2 * power - entrant_count
    main_matches = power - 1
    placement_matches = 4
    return {
        "entrant_count": entrant_count,
        "entry_stake_micro_usdc": stake,
        "gross_pool": gross,
        "platform_fee": fee,
        "net_prize_pool": net,
        "winner_credits": credits,
        "rounding_remainder": remainder,
        "rounding_remainder_destination": "rank_1",
        "total_destination": fee + sum(credits),
        "cancel": {
            "refund_total": gross,
            "platform_fee": 0,
            "winner_credits": [0, 0, 0, 0, 0],
            "total_destination": gross,
        },
        "bracket": {
            "preliminary_matches": preliminary,
            "bye_count": byes,
            "main_matches": main_matches,
            "placement_matches": placement_matches,
            "total_matches": preliminary + main_matches + placement_matches,
            "paid_ranks": min(5, entrant_count),
        },
    }


def _verify_accounting_fixture(case, policy):
    result = _compute_accounting(case["entrant_count"], policy)
    expected = case["expected"]
    for field in (
        "gross_pool",
        "platform_fee",
        "net_prize_pool",
        "winner_credits",
        "rounding_remainder",
        "rounding_remainder_destination",
        "total_destination",
        "bracket",
        "cancel",
    ):
        if result[field] != expected[field]:
            _fail(f"accounting fixture mismatch in {field}")
    if case.get("duplicate_actions") != {
        "settle_first": "SUCCESS",
        "settle_second": "REJECT_DUPLICATE",
        "withdraw_first": "SUCCESS",
        "withdraw_second": "REJECT_DUPLICATE",
    }:
        _fail("duplicate-action policy mismatch")
    return result
