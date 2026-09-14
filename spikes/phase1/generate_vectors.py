"""Regenerate the public, deterministic Phase 1 bracket/accounting fixtures.

This script only writes synthetic offline vectors under ``spikes/phase1``.
It never queries a chain, wallet, model provider, or GenLayer runtime.
"""

import json
from pathlib import Path

from spikes.phase1.accounting.model import compute_accounting
from spikes.phase1.randomness.bracket import _commitment, build_bracket, derive_seed


ROOT = Path(__file__).parent


def _write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def generate_bracket_vectors():
    seed_vector = {
        "schema_version": "ArcBlockhashRandomnessV1",
        "chain_id": 5042002,
        "escrow_address": "0x" + "34" * 20,
        "tournament_id": "0x" + "11" * 32,
        "roster_commitment": "0x" + "88" * 32,
        "topic_deck_commitment": "0x" + "99" * 32,
        "bracket_revision": 1,
        "seed_block": 100,
        "observed_block_number": 101,
        "block_hash": "0x" + "aa" * 32,
    }
    seed_vector["expected_seed"] = derive_seed(seed_vector)
    seed_vector["seed_commitment"] = _commitment(seed_vector)

    cases = []
    for entrant_count in range(8, 33):
        case = {
            "entrant_count": entrant_count,
            "entrant_ids": ["0x" + value.to_bytes(32, "big").hex() for value in range(1, entrant_count + 1)],
            "tournament_id": seed_vector["tournament_id"],
            "bracket_revision": seed_vector["bracket_revision"],
            "topic_count": 17,
            "seed_hex": seed_vector["expected_seed"],
        }
        bracket = build_bracket(case)
        case.update(
            {
                "expected_bracket_digest": bracket["bracket_digest"],
                "expected_byes": bracket["byes"],
                "expected_preliminary": bracket["preliminary"],
                "expected_main": bracket["main"],
                "expected_preliminary_match_count": len(bracket["preliminary"]),
                "expected_bye_count": len(bracket["byes"]),
            }
        )
        cases.append(case)

    _write(
        ROOT / "randomness" / "fixtures" / "bracket_vectors.json",
        {
            "schema_version": "BracketRandomnessV1",
            "policy": {
                "min_entrants": 8,
                "max_entrants": 32,
                "topic_count": 17,
                "duplicate_topic_policy": "allowed_by_draw",
            },
            "seed_vector": seed_vector,
            "cases": cases,
        },
    )


def generate_accounting_vectors():
    policy = {
        "min_entrants": 8,
        "max_entrants": 32,
        "entry_stake_micro_usdc": 1_000_001,
        "platform_fee_bps": 1_000,
        "payout_bps": [4_000, 2_500, 1_500, 1_200, 800],
        "rounding_remainder_destination": "rank_1",
        "tie_policy": {
            "first_tie": "rematch_with_new_committed_topic",
            "max_rematches": 1,
            "after_rematch_tie": "criterion_priority_then_seeded_tiebreak",
            "retryable_or_expired": "cancel_match_and_refund",
        },
    }
    cases = []
    duplicate_actions = {
        "settle_first": "SUCCESS",
        "settle_second": "REJECT_DUPLICATE",
        "withdraw_first": "SUCCESS",
        "withdraw_second": "REJECT_DUPLICATE",
    }
    expected_fields = (
        "gross_pool",
        "platform_fee",
        "net_prize_pool",
        "winner_credits",
        "rounding_remainder",
        "rounding_remainder_destination",
        "total_destination",
        "bracket",
        "cancel",
    )
    for entrant_count in range(8, 33):
        result = compute_accounting(entrant_count, policy)
        cases.append(
            {
                "entrant_count": entrant_count,
                "expected": {field: result[field] for field in expected_fields},
                "duplicate_actions": duplicate_actions,
            }
        )
    _write(ROOT / "accounting" / "fixtures" / "accounting_vectors.json", {"schema_version": "TopFiveAccountingV1", "policy": policy, "cases": cases})


if __name__ == "__main__":
    generate_bracket_vectors()
    generate_accounting_vectors()
    print("generated bracket and accounting vectors")
