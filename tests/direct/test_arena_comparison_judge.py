import hashlib
import json

import pytest


CONTRACT = "contracts/ArenaComparisonJudge.py"
RUBRIC = "AgentComparisonV1"
DIMENSIONS = [
    "instruction_adherence",
    "reasoning_quality",
    "action_selection",
    "rule_compliance",
    "task_completion",
    "safety",
]


def digest(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def payload():
    agents_a = "Follow instructions and remain safe."
    agents_b = "Complete tasks carefully."
    scenario = json.dumps({
        "schema": "arena-test-scenario-v1", "scenario_id": "pair-1", "version": "1.0.0",
        "mode": "RESPONSE", "objective": "Explain the result.", "context": "",
        "constraints": ["Be concise"], "available_actions": [], "forbidden_action_ids": [],
        "confirmation_required_action_ids": [], "max_proposed_actions": 0,
    }, separators=(",", ":"))
    response_a = json.dumps({"schema": "arena-evaluation-output-v1", "mode": "RESPONSE", "decision": "RESPOND", "answer": "A", "observable_rationale": "Because A.", "proposed_actions": []}, separators=(",", ":"))
    response_b = json.dumps({"schema": "arena-evaluation-output-v1", "mode": "RESPONSE", "decision": "RESPOND", "answer": "B", "observable_rationale": "Because B.", "proposed_actions": []}, separators=(",", ":"))
    return dict(
        match_id=digest("match"), attempt_id=digest("attempt"),
        agent_version_id_a=digest("version-a"), agent_version_id_b=digest("version-b"), mode="RESPONSE",
        agents_md_a=agents_a, agents_md_b=agents_b, scenario_json=scenario,
        response_json_a=response_a, response_json_b=response_b,
        agents_digest_a=digest(agents_a), agents_digest_b=digest(agents_b), scenario_digest=digest(scenario),
        response_digest_a=digest(response_a), response_digest_b=digest(response_b), rubric_version=RUBRIC,
    )


def judgment(winner="A"):
    rows = []
    for dimension in DIMENSIONS:
        selected = "TIE" if dimension in ("action_selection", "safety") else winner
        rows.append({"dimension_id": dimension, "winner": selected, "reason": "The submitted evidence supports this comparison."})
    return {"dimensions": rows, "safety_class": "NEITHER_UNSAFE", "summary": "Agent A has the material advantage."}


def test_rich_pair_returns_six_dimension_terminal_verdict(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT)
    direct_vm.mock_llm(r".*ARENA_COMPARISON_JUDGE_V1.*", json.dumps(judgment("A")))
    result = contract.submit_comparison(**payload())
    assert result["status"] == "FINAL"
    assert result["result"] == "A_WIN"
    assert [row["dimension_id"] for row in result["dimensions"]] == DIMENSIONS
    assert result["agent_version_id_a"] == payload()["agent_version_id_a"]
    assert contract.get_comparison(payload()["match_id"], payload()["attempt_id"]) == result


def test_byte_identical_structured_responses_are_deterministic_tie(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT)
    values = payload()
    values["response_json_b"] = values["response_json_a"]
    values["response_digest_b"] = values["response_digest_a"]
    result = contract.submit_comparison(**values)
    assert result["result"] == "TIE"
    assert all(row["winner"] == "TIE" for row in result["dimensions"])


def test_exact_evidence_binding_and_immutable_replay(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT)
    direct_vm.mock_llm(r".*ARENA_COMPARISON_JUDGE_V1.*", json.dumps(judgment("A")))
    values = payload()
    first = contract.submit_comparison(**values)
    assert contract.submit_comparison(**values) == first
    changed = dict(values, response_json_a=values["response_json_a"] + " ")
    changed["response_digest_a"] = digest(changed["response_json_a"])
    with pytest.raises(Exception, match="conflicting"):
        contract.submit_comparison(**changed)
    with pytest.raises(Exception, match="digest"):
        contract.submit_comparison(**dict(payload(), scenario_digest=digest("wrong")))


def test_only_operator_can_submit(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT)
    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="operator"):
        contract.submit_comparison(**payload())
