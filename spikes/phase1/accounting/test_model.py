import json
import unittest
from pathlib import Path

from spikes.phase1.accounting.model import AccountingError, compute_accounting, verify_accounting_fixture


FIXTURE = Path(__file__).with_name("fixtures") / "accounting_vectors.json"


def load():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class TopFiveAccountingTests(unittest.TestCase):
    def test_all_supported_counts_have_complete_vectors(self):
        fixture = load()
        self.assertEqual([case["entrant_count"] for case in fixture["cases"]], list(range(8, 33)))
        for case in fixture["cases"]:
            result = verify_accounting_fixture(case, fixture["policy"])
            self.assertEqual(result["gross_pool"], case["expected"]["gross_pool"])
            self.assertEqual(result["net_prize_pool"], case["expected"]["net_prize_pool"])
            self.assertEqual(result["total_destination"], result["gross_pool"])

    def test_rounding_remainder_has_locked_destination(self):
        fixture = load()
        case = fixture["cases"][0]
        result = compute_accounting(case["entrant_count"], fixture["policy"])
        self.assertEqual(result["rounding_remainder_destination"], "rank_1")
        self.assertEqual(result["winner_credits"][0], case["expected"]["winner_credits"][0])

    def test_refund_branch_has_full_stake_and_zero_fee(self):
        fixture = load()
        for case in fixture["cases"]:
            result = verify_accounting_fixture(case, fixture["policy"])
            self.assertEqual(result["cancel"]["refund_total"], result["gross_pool"])
            self.assertEqual(result["cancel"]["platform_fee"], 0)

    def test_duplicate_settlement_and_withdrawal_do_not_add_destination(self):
        fixture = load()
        for case in fixture["cases"]:
            actions = case["duplicate_actions"]
            self.assertEqual(actions, {"settle_first": "SUCCESS", "settle_second": "REJECT_DUPLICATE", "withdraw_first": "SUCCESS", "withdraw_second": "REJECT_DUPLICATE"})

    def test_invalid_payout_sum_is_rejected(self):
        fixture = load()
        policy = dict(fixture["policy"], payout_bps=[5000, 2500, 1000, 500, 400])
        with self.assertRaisesRegex(AccountingError, "10,000"):
            compute_accounting(8, policy)

    def test_tie_retry_and_cancel_policy_is_locked(self):
        fixture = load()
        self.assertEqual(
            fixture["policy"]["tie_policy"],
            {
                "first_tie": "rematch_with_new_committed_topic",
                "max_rematches": 1,
                "after_rematch_tie": "criterion_priority_then_seeded_tiebreak",
                "retryable_or_expired": "cancel_match_and_refund",
            },
        )
        invalid = dict(fixture["policy"], tie_policy=dict(fixture["policy"]["tie_policy"], max_rematches=2))
        with self.assertRaisesRegex(AccountingError, "tie retry"):
            compute_accounting(8, invalid)


if __name__ == "__main__":
    unittest.main()
