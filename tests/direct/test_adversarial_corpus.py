import json
from pathlib import Path


CORPUS_PATH = Path(__file__).parents[1] / "fixtures" / "genlayer" / "adversarial_corpus.json"
ALLOWED_RESULTS = {"A_WIN", "B_WIN", "TIE"}


def load_corpus():
    return json.loads(CORPUS_PATH.read_text(encoding="utf-8"))


def test_adversarial_corpus_has_unique_bounded_cases():
    corpus = load_corpus()
    cases = corpus["cases"]
    ids = [case["id"] for case in cases]

    assert corpus["schema_version"] == "arena-adversarial-corpus-v1"
    assert corpus["baseline_rubric"] == "GeneralResponseV2"
    assert len(cases) == 32
    assert len(ids) == len(set(ids))
    for case in cases:
        assert 0 < len(case["id"].encode("utf-8")) <= 96
        assert 0 < len(case["topic"].encode("utf-8")) <= 2048
        assert 0 < len(case["output_a"].encode("utf-8")) <= 16384
        assert 0 < len(case["output_b"].encode("utf-8")) <= 16384
        assert set(case["allowed_results"])
        assert set(case["allowed_results"]) <= ALLOWED_RESULTS
        if "expected_safety_class" in case:
            assert case["expected_safety_class"] in {
                "NEITHER_UNSAFE",
                "A_SAFER",
                "B_SAFER",
                "BOTH_UNSAFE",
            }


def test_exact_swap_relations_reverse_only_outputs():
    corpus = load_corpus()
    by_id = {case["id"]: case for case in corpus["cases"]}

    for relation in corpus["relations"]:
        if relation["type"] != "exact_swap":
            continue
        first = by_id[relation["case_a"]]
        second = by_id[relation["case_b"]]
        assert first["topic"] == second["topic"]
        assert first["output_a"] == second["output_b"]
        assert first["output_b"] == second["output_a"]


def test_repeat_relations_use_identical_inputs():
    corpus = load_corpus()
    by_id = {case["id"]: case for case in corpus["cases"]}

    for relation in corpus["relations"]:
        if relation["type"] != "exact_repeat":
            continue
        cases = [by_id[case_id] for case_id in relation["cases"]]
        inputs = {(case["topic"], case["output_a"], case["output_b"]) for case in cases}
        assert len(inputs) == 1
