import copy
import json
import unittest
from pathlib import Path

from spikes.phase1.provenance.verifier import (
    VerificationError,
    verify_aci_receipt,
    verify_arena_match,
)


FIXTURES = Path(__file__).with_name("fixtures")


def load(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class AciReceiptTests(unittest.TestCase):
    def test_official_vector_verifies(self):
        vector = load("aci_official_receipt_vector.json")
        result = verify_aci_receipt(
            vector["receipt"],
            vector["request_body"].encode(),
            vector["response_body"].encode(),
            vector["trust_anchor"],
            expected_endpoint="/v1/chat/completions",
            expected_model="demo-model",
        )
        self.assertEqual(result["receipt_id"], "rcpt-0001")

    def test_tampered_wire_response_fails(self):
        vector = load("aci_official_receipt_vector.json")
        with self.assertRaisesRegex(VerificationError, "response body hash"):
            verify_aci_receipt(
                vector["receipt"],
                vector["request_body"].encode(),
                b'{"choices":[{"winner":"A"}]}',
                vector["trust_anchor"],
                expected_endpoint="/v1/chat/completions",
                expected_model="demo-model",
            )


class ArenaProfileTests(unittest.TestCase):
    def test_atomic_pair_vector_verifies(self):
        vector = load("arena_match_vector.json")
        result = verify_arena_match(vector)
        self.assertEqual(result["slots"], ("A", "B"))
        self.assertEqual(result["attempt_id"], vector["request"]["attempt_id"])

    def test_prompt_tampering_fails_commitment(self):
        vector = load("arena_match_vector.json")
        vector["request"]["prompt_a"] += " hidden override"
        with self.assertRaisesRegex(VerificationError, "prompt commitment A"):
            verify_arena_match(vector)

    def test_swapped_outputs_fail_slot_binding(self):
        vector = load("arena_match_vector.json")
        vector["response"]["outputs"]["A"], vector["response"]["outputs"]["B"] = (
            vector["response"]["outputs"]["B"],
            vector["response"]["outputs"]["A"],
        )
        with self.assertRaisesRegex(VerificationError, "output digest A"):
            verify_arena_match(vector)

    def test_missing_second_slot_event_fails_atomicity(self):
        vector = load("arena_match_vector.json")
        vector["receipt"]["event_log"] = [
            event
            for event in vector["receipt"]["event_log"]
            if not (event.get("type") == "arena.response.returned" and event.get("slot") == "B")
        ]
        with self.assertRaisesRegex(VerificationError, "event sequence"):
            verify_arena_match(vector)

    def test_model_policy_mismatch_fails(self):
        vector = load("arena_match_vector.json")
        vector["policy"]["model"] = "other-model"
        with self.assertRaisesRegex(VerificationError, "model"):
            verify_arena_match(vector)

    def test_wrong_topic_fails_digest_binding(self):
        vector = load("arena_match_vector.json")
        vector["request"]["topic"] = "A different topic."
        with self.assertRaisesRegex(VerificationError, "topic digest"):
            verify_arena_match(vector)

    def test_swapped_entrant_binding_fails_prompt_commitment(self):
        vector = load("arena_match_vector.json")
        vector["request"]["entrant_a_id"], vector["request"]["entrant_b_id"] = (
            vector["request"]["entrant_b_id"],
            vector["request"]["entrant_a_id"],
        )
        with self.assertRaisesRegex(VerificationError, "prompt commitment A"):
            verify_arena_match(vector)

    def test_stale_and_future_receipts_fail(self):
        vector = load("arena_match_vector.json")
        vector["policy"]["max_age_seconds"] = 1
        vector["policy"]["now"] = vector["receipt"]["served_at"] + 2
        with self.assertRaisesRegex(VerificationError, "stale"):
            verify_arena_match(vector)

        vector = load("arena_match_vector.json")
        vector["policy"]["now"] = vector["receipt"]["served_at"] - vector["policy"]["max_future_skew_seconds"] - 1
        with self.assertRaisesRegex(VerificationError, "future"):
            verify_arena_match(vector)

    def test_wrong_match_response_fails(self):
        vector = load("arena_match_vector.json")
        vector["response"]["match_id"] = "0x5555555555555555555555555555555555555555555555555555555555555555"
        with self.assertRaisesRegex(VerificationError, "match/attempt"):
            verify_arena_match(vector)

    def test_receipt_outside_request_window_fails(self):
        vector = load("arena_match_vector.json")
        vector["request"]["issued_at"] = vector["receipt"]["served_at"] + 1
        with self.assertRaisesRegex(VerificationError, "request lifetime"):
            verify_arena_match(vector)

    def test_attempt_receipt_is_consumed_once(self):
        vector = load("arena_match_vector.json")
        consumed = set()
        verify_arena_match(vector, consumed_attempts=consumed)
        with self.assertRaisesRegex(VerificationError, "already consumed"):
            verify_arena_match(vector, consumed_attempts=consumed)

    def test_signature_tampering_fails(self):
        vector = load("arena_match_vector.json")
        vector["receipt"]["served_at"] += 1
        with self.assertRaisesRegex(VerificationError, "signature"):
            verify_arena_match(vector)

    def test_quote_and_binding_attestation_flags_are_required(self):
        flags = [
            "quote_verified",
            "report_data_keyset_bound",
            "attestation_nonce_fresh",
            "tls_spki_bound",
        ]
        for flag in flags:
            with self.subTest(flag=flag):
                vector = load("arena_match_vector.json")
                vector["trust_anchor"][flag] = False
                with self.assertRaisesRegex(VerificationError, "attestation policy is not verified"):
                    verify_arena_match(vector)

    def test_workload_measurement_mismatch_fails(self):
        vector = load("arena_match_vector.json")
        vector["trust_anchor"]["workload_measurement"] = "sha256:" + "c" * 64
        with self.assertRaisesRegex(VerificationError, "workload measurement mismatch"):
            verify_arena_match(vector)

    def test_key_custody_verification_is_required(self):
        vector = load("arena_match_vector.json")
        vector["trust_anchor"]["key_custody_verified"] = False
        with self.assertRaisesRegex(VerificationError, "key custody policy is not verified"):
            verify_arena_match(vector)

    def test_key_custody_policy_mismatch_fails(self):
        vector = load("arena_match_vector.json")
        vector["trust_anchor"]["key_custody_policy_digest"] = "sha256:" + "d" * 64
        with self.assertRaisesRegex(VerificationError, "key custody policy mismatch"):
            verify_arena_match(vector)

    def test_duplicate_arena_event_fails(self):
        vector = load("arena_match_vector.json")
        vector["receipt"]["event_log"].insert(3, copy.deepcopy(vector["receipt"]["event_log"][2]))
        with self.assertRaisesRegex(VerificationError, "Arena atomic event sequence"):
            verify_arena_match(vector)

    def test_reordered_arena_events_fail(self):
        vector = load("arena_match_vector.json")
        events = vector["receipt"]["event_log"]
        events[2], events[3] = events[3], events[2]
        with self.assertRaisesRegex(VerificationError, "Arena atomic event sequence"):
            verify_arena_match(vector)

    def test_extra_arena_event_fails(self):
        vector = load("arena_match_vector.json")
        vector["receipt"]["event_log"].insert(-1, {"type": "arena.audit", "slot": "A"})
        with self.assertRaisesRegex(VerificationError, "Arena atomic event sequence"):
            verify_arena_match(vector)

    def test_partial_provider_response_fails_without_pair_result(self):
        vector = load("arena_match_vector.json")
        del vector["provider_responses"]["B"]
        with self.assertRaisesRegex(VerificationError, "provider slots must be exactly A and B"):
            verify_arena_match(vector)

    def test_attestation_digest_formats_are_required(self):
        cases = [
            ("workload_measurement", None, "workload measurement format is invalid"),
            ("expected_workload_measurement", "", "workload measurement format is invalid"),
            ("key_custody_policy_digest", "sha256:xyz", "key custody policy digest format is invalid"),
            ("expected_key_custody_policy_digest", "sha256:" + "g" * 64, "key custody policy digest format is invalid"),
        ]
        for field, invalid_value, error_regex in cases:
            with self.subTest(field=field, invalid_value=invalid_value):
                vector = load("arena_match_vector.json")
                vector["trust_anchor"][field] = invalid_value
                with self.assertRaisesRegex(VerificationError, error_regex):
                    verify_arena_match(vector)

    def test_matching_empty_attestation_digests_are_rejected(self):
        with self.subTest(case="workload_measurement"):
            vector = load("arena_match_vector.json")
            vector["trust_anchor"]["workload_measurement"] = ""
            vector["trust_anchor"]["expected_workload_measurement"] = ""
            with self.assertRaisesRegex(VerificationError, "workload measurement format is invalid"):
                verify_arena_match(vector)

        with self.subTest(case="key_custody_policy_digest"):
            vector = load("arena_match_vector.json")
            vector["trust_anchor"]["key_custody_policy_digest"] = ""
            vector["trust_anchor"]["expected_key_custody_policy_digest"] = ""
            with self.assertRaisesRegex(VerificationError, "key custody policy digest format is invalid"):
                verify_arena_match(vector)


if __name__ == "__main__":
    unittest.main()
