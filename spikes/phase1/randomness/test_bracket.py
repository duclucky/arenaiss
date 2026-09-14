import json
import unittest
from pathlib import Path
from unittest.mock import patch

from spikes.phase1.randomness.bracket import (
    BracketError,
    _draw,
    build_bracket,
    derive_seed,
    verify_bracket_fixture,
    verify_rpc_quorum,
)


FIXTURE = Path(__file__).with_name("fixtures") / "bracket_vectors.json"
LIVE_OBSERVATION = Path(__file__).parents[3] / "docs" / "evidence" / "arc-testnet" / "live-rpc-usdc-randomness-2026-09-11.json"


def load():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class RandomnessAndBracketTests(unittest.TestCase):
    def test_seed_vector_is_deterministic_and_domain_bound(self):
        vector = load()["seed_vector"]
        seed = derive_seed(vector)
        self.assertEqual(seed, vector["expected_seed"])
        changed = dict(vector, tournament_id="0x" + "22" * 32)
        changed.pop("seed_commitment", None)
        self.assertNotEqual(derive_seed(changed), seed)

    def test_future_seed_block_is_not_usable(self):
        vector = load()["seed_vector"]
        with self.assertRaisesRegex(BracketError, "not mined"):
            derive_seed(dict(vector, observed_block_number=vector["seed_block"] - 1))

    def test_expired_blockhash_is_not_usable(self):
        vector = load()["seed_vector"]
        with self.assertRaisesRegex(BracketError, "expired"):
            derive_seed(dict(vector, observed_block_number=vector["seed_block"] + 256))

    def test_all_golden_brackets_8_to_32_verify(self):
        vector = load()
        self.assertEqual([case["entrant_count"] for case in vector["cases"]], list(range(8, 33)))
        for case in vector["cases"]:
            result = verify_bracket_fixture(case)
            self.assertEqual(result["bracket_digest"], case["expected_bracket_digest"])

    def test_operator_cannot_choose_byes_or_reroll(self):
        vector = load()
        self.assertEqual(vector["policy"]["duplicate_topic_policy"], "allowed_by_draw")
        case = vector["cases"][5]
        tampered = json.loads(json.dumps(case))
        tampered["expected_byes"] = list(reversed(tampered["expected_byes"]))
        with self.assertRaisesRegex(BracketError, "bye vector"):
            verify_bracket_fixture(tampered)

    def test_rejection_sampler_rejects_boundary_candidate_before_modulo(self):
        upper_bound = 3
        limit = 2**256 - (2**256 % upper_bound)
        with patch(
            "spikes.phase1.randomness.bracket.keccak",
            side_effect=[limit.to_bytes(32, "big"), bytes(32)],
        ) as mocked:
            self.assertEqual(_draw("0x" + "11" * 32, upper_bound, "golden"), 0)
        self.assertEqual(mocked.call_count, 2)

    def test_duplicate_entrant_and_empty_topic_deck_are_rejected(self):
        case = json.loads(json.dumps(load()["cases"][1]))
        case["entrant_ids"][1] = case["entrant_ids"][0]
        with self.assertRaisesRegex(BracketError, "unique"):
            build_bracket(case)
        case = json.loads(json.dumps(load()["cases"][1]))
        case["topic_count"] = 0
        with self.assertRaisesRegex(BracketError, "non-empty"):
            build_bracket(case)

    def test_replayed_seed_commitment_is_rejected(self):
        vector = load()["seed_vector"]
        consumed = set()
        derive_seed(vector, consumed_commitments=consumed)
        with self.assertRaisesRegex(BracketError, "already consumed"):
            derive_seed(vector, consumed_commitments=consumed)

    def test_live_arc_rpc_observation_has_matching_quorum(self):
        observation = json.loads(LIVE_OBSERVATION.read_text(encoding="utf-8"))
        result = verify_rpc_quorum(observation)
        self.assertEqual(result["matching"], 4)
        self.assertEqual(result["required"], 3)
        self.assertEqual(result["block_hash"], observation["randomness_observation"]["seed_block_hash"])

    def test_rpc_quorum_rejects_duplicate_endpoint(self):
        observation = json.loads(LIVE_OBSERVATION.read_text(encoding="utf-8"))
        responses = observation["randomness_observation"]["rpc_quorum"]["responses"]
        responses[1]["endpoint"] = responses[0]["endpoint"]
        with self.assertRaisesRegex(BracketError, "unique"):
            verify_rpc_quorum(observation)

    def test_rpc_quorum_rejects_wrong_chain_or_block(self):
        observation = json.loads(LIVE_OBSERVATION.read_text(encoding="utf-8"))
        observation["randomness_observation"]["rpc_quorum"]["responses"][0]["chain_id"] = 1
        with self.assertRaisesRegex(BracketError, "chain"):
            verify_rpc_quorum(observation)

        observation = json.loads(LIVE_OBSERVATION.read_text(encoding="utf-8"))
        observation["randomness_observation"]["rpc_quorum"]["responses"][0]["block_number"] -= 1
        with self.assertRaisesRegex(BracketError, "block number"):
            verify_rpc_quorum(observation)

    def test_rpc_quorum_rejects_insufficient_matching_hashes(self):
        observation = json.loads(LIVE_OBSERVATION.read_text(encoding="utf-8"))
        responses = observation["randomness_observation"]["rpc_quorum"]["responses"]
        responses[0]["block_hash"] = "0x" + "11" * 32
        responses[1]["block_hash"] = "0x" + "22" * 32
        with self.assertRaisesRegex(BracketError, "quorum"):
            verify_rpc_quorum(observation)


if __name__ == "__main__":
    unittest.main()
