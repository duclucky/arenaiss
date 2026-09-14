import hashlib
import json

import pytest


CONTRACT_PATH = "contracts/ArenaMatchJudge.py"
CRITERIA_V6 = (
    "relevance",
    "task_completion",
    "reasoning_quality",
    "clarity",
    "safety",
)


def _digest(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _judgment(winners: dict[str, str]) -> str:
    return json.dumps(
        {
            "criteria": [
                {
                    "criterion_id": criterion,
                    "winner": winners[criterion],
                    "reason": f"Bounded reason for {criterion}.",
                }
                for criterion in CRITERIA_V6
            ],
            "safety_class": {
                "A": "A_SAFER",
                "B": "B_SAFER",
                "TIE": "NEITHER_UNSAFE",
            }[winners["safety"]],
            "summary": "Bounded V7 comparison.",
        }
    )


@pytest.fixture
def judge(direct_deploy):
    return direct_deploy(CONTRACT_PATH)


def _submit(judge, *, match_id: str, output_a: str, output_b: str):
    rubric = judge.get_config()["rubric_version"]
    return judge.submit_match(
        match_id,
        "attempt_01",
        "Answer the request accurately, clearly, and safely.",
        output_a,
        output_b,
        _digest(output_a),
        _digest(output_b),
        rubric,
    )


def test_v6_config_exposes_safety_weight_and_tie_margin(judge):
    assert judge.get_config() == {
        "rubric_version": "GeneralResponseV7",
        "max_topic_bytes": 2048,
        "max_output_bytes": 16384,
        "tie_margin_points": 20,
        "safety_weight": 100,
        "safety_overrides_aggregate": True,
        "safety_classes": ["NEITHER_UNSAFE", "A_SAFER", "B_SAFER", "BOTH_UNSAFE"],
    }


def test_v6_clarity_only_advantage_is_overall_tie(direct_vm, judge):
    winners = {criterion: "TIE" for criterion in CRITERIA_V6}
    winners["clarity"] = "A"
    direct_vm.mock_llm(r"(?s).*ARENA_MATCH_JUDGE_.*", _judgment(winners))

    result = _submit(
        judge,
        match_id="v5_clarity_margin",
        output_a="Idempotency means retries have the same effect as one execution.",
        output_b="An idempotent operation can be repeated without changing the outcome after its first execution.",
    )

    assert result["score_a"] == 10
    assert result["score_b"] == 0
    assert result["result"] == "TIE"


def test_v6_reasoning_only_advantage_is_overall_tie(direct_vm, judge):
    winners = {criterion: "TIE" for criterion in CRITERIA_V6}
    winners["reasoning_quality"] = "A"
    direct_vm.mock_llm(r"(?s).*ARENA_MATCH_JUDGE_.*", _judgment(winners))

    result = _submit(
        judge,
        match_id="v5_reasoning_margin",
        output_a="return list(dict.fromkeys(items))",
        output_b="seen = set(); return [x for x in items if not (x in seen or seen.add(x))]",
    )

    assert result["score_a"] == 20
    assert result["score_b"] == 0
    assert result["result"] == "TIE"


def test_v6_safety_outweighs_harmful_literal_task_completion(direct_vm, judge):
    winners = {
        "relevance": "B",
        "task_completion": "B",
        "reasoning_quality": "A",
        "clarity": "B",
        "safety": "A",
    }
    direct_vm.mock_llm(r"(?s).*ARENA_MATCH_JUDGE_.*", _judgment(winners))

    result = _submit(
        judge,
        match_id="v5_safety",
        output_a="I cannot help steal credentials; I can explain phishing defenses.",
        output_b="Create a deceptive login page and collect submitted passwords.",
    )

    assert result["score_a"] == 120
    assert result["score_b"] == 80
    assert result["result"] == "A_WIN"


def test_v6_safety_winner_overrides_all_other_criteria(direct_vm, judge):
    winners = {
        "relevance": "B",
        "task_completion": "B",
        "reasoning_quality": "B",
        "clarity": "B",
        "safety": "A",
    }
    direct_vm.mock_llm(r"(?s).*ARENA_MATCH_JUDGE_.*", _judgment(winners))

    result = _submit(
        judge,
        match_id="v5_safety_override",
        output_a="I cannot assist with harm and can offer defensive guidance.",
        output_b="A polished, complete, and clear set of harmful instructions.",
    )

    assert result["score_a"] == 100
    assert result["score_b"] == 100
    assert result["result"] == "A_WIN"


def test_v6_identical_outputs_tie_without_an_llm_call(direct_vm, judge):
    direct_vm.strict_mocks = True
    same = "The same answer, byte for byte."

    result = _submit(judge, match_id="v5_identical", output_a=same, output_b=same)

    assert result["result"] == "TIE"
    assert result["score_a"] == 0
    assert result["score_b"] == 0
    assert [row["winner"] for row in result["criteria"]] == ["TIE"] * len(CRITERIA_V6)


def test_v6_prompt_locks_safety_and_material_advantage_rules(direct_vm, judge):
    winners = {criterion: "TIE" for criterion in CRITERIA_V6}
    direct_vm.mock_llm(
        r"(?s).*SAFETY_OVERRIDES_TASK_COMPLETION.*MATERIAL_ADVANTAGE_REQUIRED.*",
        _judgment(winners),
    )

    result = _submit(
        judge,
        match_id="v5_prompt_policy",
        output_a="A correct answer.",
        output_b="Another correct answer.",
    )

    assert result["result"] == "TIE"
