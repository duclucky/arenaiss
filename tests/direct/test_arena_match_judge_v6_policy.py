import hashlib
import json
from pathlib import Path

import pytest


CONTRACT_PATH = "contracts/ArenaMatchJudge.py"
CRITERIA = ("relevance", "task_completion", "reasoning_quality", "clarity", "safety")


def _digest(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _judgment(winners: dict[str, str], safety_class: str) -> str:
    return json.dumps(
        {
            "criteria": [
                {
                    "criterion_id": criterion,
                    "winner": winners[criterion],
                    "reason": f"Bounded reason for {criterion}.",
                }
                for criterion in CRITERIA
            ],
            "safety_class": safety_class,
            "summary": "Bounded V7 comparison.",
        }
    )


def _audit(winners: dict[str, str], safety_class: str) -> str:
    return json.dumps(
        {
            "criteria": [
                {
                    "criterion_id": criterion,
                    "winner": winners[criterion],
                    "reason_supported": True,
                }
                for criterion in CRITERIA
            ],
            "safety_class": safety_class,
            "safety_class_supported": True,
            "summary_supported": True,
        }
    )


@pytest.fixture
def judge(direct_deploy):
    return direct_deploy(CONTRACT_PATH)


def _submit(judge, match_id: str = "v6_policy"):
    output_a = "A useful answer."
    output_b = "Another useful answer."
    return judge.submit_match(
        match_id,
        "attempt_01",
        "Give a useful answer.",
        output_a,
        output_b,
        _digest(output_a),
        _digest(output_b),
        judge.get_config()["rubric_version"],
    )


def test_v6_config_exposes_closed_safety_classes(judge):
    config = judge.get_config()
    assert config["rubric_version"] == "GeneralResponseV7"
    assert config["safety_classes"] == [
        "NEITHER_UNSAFE",
        "A_SAFER",
        "B_SAFER",
        "BOTH_UNSAFE",
    ]


def test_v6_neither_unsafe_requires_safety_tie(direct_vm, judge):
    winners = {criterion: "TIE" for criterion in CRITERIA}
    winners["safety"] = "A"
    direct_vm.mock_llm(r"(?s).*ARENA_MATCH_JUDGE_.*", _judgment(winners, "NEITHER_UNSAFE"))

    with pytest.raises(Exception, match="safety class"):
        _submit(judge, "v6_benign_false_positive")


def test_v6_both_unsafe_forces_tie(direct_vm, judge):
    winners = {criterion: "A" for criterion in CRITERIA}
    winners["safety"] = "TIE"
    direct_vm.mock_llm(r"(?s).*ARENA_MATCH_JUDGE_.*", _judgment(winners, "BOTH_UNSAFE"))

    result = _submit(judge, "v6_both_unsafe")

    assert result["safety_class"] == "BOTH_UNSAFE"
    assert result["result"] == "TIE"


def test_v6_validator_rejects_safety_class_mismatch(direct_vm, judge):
    winners = {criterion: "TIE" for criterion in CRITERIA}
    direct_vm.mock_llm(r"(?s).*ARENA_MATCH_JUDGE_.*", _judgment(winners, "NEITHER_UNSAFE"))
    _submit(judge, "v6_class_consensus")
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r"(?s).*ARENA_MATCH_VALIDATOR_.*", _audit(winners, "BOTH_UNSAFE"))

    assert direct_vm.run_validator() is False


def test_v6_prompt_has_no_stale_numeric_margin():
    source = Path(CONTRACT_PATH).read_text(encoding="utf-8")
    assert "10 points or less" not in source
    assert "SAFETY_CLASS_REQUIRED" in source
