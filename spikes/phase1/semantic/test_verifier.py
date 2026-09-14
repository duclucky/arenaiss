import json
import unittest
from pathlib import Path

from spikes.phase1.semantic.verifier import VerdictError, agreement_rate, compare_consensus, normalize_verdict


FIXTURE = Path(__file__).with_name("fixtures") / "corpus.json"


def load():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class SemanticStabilityTests(unittest.TestCase):
    def test_corpus_expected_consensus_fields(self):
        corpus = load()
        outcomes = {}
        for case in corpus["cases"]:
            binding = case.get("binding", corpus["binding"])
            result = normalize_verdict(case["leader_output"], binding, corpus["rubric"])
            outcomes[case["id"]] = result
            self.assertEqual(result["result"], case["expected_result"], case["id"])
            self.assertEqual(result["criterion_winners"], case["expected_criterion_winners"], case["id"])
        self.assertEqual(len(outcomes), corpus["case_count"])

    def test_paraphrases_are_equivalent_on_consensus_fields(self):
        corpus = load()
        left = next(case for case in corpus["cases"] if case["id"] == "clear_a")
        right = next(case for case in corpus["cases"] if case["id"] == "clear_a_paraphrase")
        a = normalize_verdict(left["leader_output"], left.get("binding", corpus["binding"]), corpus["rubric"])
        b = normalize_verdict(right["leader_output"], right.get("binding", corpus["binding"]), corpus["rubric"])
        self.assertTrue(compare_consensus(a, b))

    def test_injection_and_hostile_rationale_cannot_change_result(self):
        corpus = load()
        for case_id in ("prompt_injection", "hostile_rationale"):
            case = next(case for case in corpus["cases"] if case["id"] == case_id)
            result = normalize_verdict(case["leader_output"], case.get("binding", corpus["binding"]), corpus["rubric"])
            self.assertEqual(result["result"], case["expected_result"])

    def test_missing_extra_duplicate_and_swapped_bindings_are_retryable(self):
        corpus = load()
        for case in corpus["cases"]:
            if case["id"] in {"missing_criterion", "extra_criterion", "duplicate_criterion", "swapped_labels", "malformed_json"}:
                result = normalize_verdict(case["leader_output"], case.get("binding", corpus["binding"]), corpus["rubric"])
                self.assertEqual(result["result"], "RETRYABLE", case["id"])

    def test_incomplete_binding_configuration_is_retryable(self):
        corpus = load()
        case = next(case for case in corpus["cases"] if case["id"] == "clear_a")
        incomplete = dict(corpus["binding"])
        incomplete.pop("match_id")
        result = normalize_verdict(case["leader_output"], incomplete, corpus["rubric"])
        self.assertEqual(result["result"], "RETRYABLE")

    def test_malicious_payout_fields_are_rejected(self):
        corpus = load()
        case = next(case for case in corpus["cases"] if case["id"] == "hostile_rationale")
        with self.assertRaisesRegex(VerdictError, "consequential field"):
            normalize_verdict(
                dict(case["leader_output"], payout_wallet="0x0000000000000000000000000000000000000001"),
                case.get("binding", corpus["binding"]),
                corpus["rubric"],
            )

    def test_validator_disagreement_is_not_silently_collapsed(self):
        corpus = load()
        case = next(case for case in corpus["cases"] if case["id"] == "validator_disagreement")
        a = normalize_verdict(case["validator_outputs"][0], case.get("binding", corpus["binding"]), corpus["rubric"])
        b = normalize_verdict(case["validator_outputs"][1], case.get("binding", corpus["binding"]), corpus["rubric"])
        self.assertFalse(compare_consensus(a, b))

    def test_agreement_is_measured_on_locked_fields(self):
        corpus = load()
        self.assertEqual(corpus["agreement_policy"]["minimum_pair_agreement"], 0.90)
        self.assertEqual(corpus["tie_policy"]["max_rematches"], 1)
        self.assertEqual(corpus["tie_policy"]["retryable_or_expired"], "cancel_match_and_refund")
        clear_a = next(case for case in corpus["cases"] if case["id"] == "clear_a")
        paraphrase = next(case for case in corpus["cases"] if case["id"] == "clear_a_paraphrase")
        clear_b = next(case for case in corpus["cases"] if case["id"] == "clear_b")
        a = normalize_verdict(clear_a["leader_output"], corpus["binding"], corpus["rubric"])
        p = normalize_verdict(paraphrase["leader_output"], corpus["binding"], corpus["rubric"])
        b = normalize_verdict(clear_b["leader_output"], corpus["binding"], corpus["rubric"])
        self.assertEqual(agreement_rate([(a, p), (a, b)]), 0.5)


if __name__ == "__main__":
    unittest.main()
