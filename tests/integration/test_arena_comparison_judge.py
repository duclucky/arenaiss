import hashlib
import json

import pytest
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.clients import get_gl_client
from gltest.fees import fee_profile_enabled, get_fee_profile_collector


FEE_OPTIONS = {
    "leaderTimeunitsAllocation": 240,
    "validatorTimeunitsAllocation": 480,
    "rotations": [1],
}


def digest(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def fee_preset():
    quote = get_gl_client().estimate_transaction_fees(FEE_OPTIONS)
    return {"distribution": quote["distribution"], "feeValue": quote["feeValue"]}


def payload():
    agents_a = "Follow instructions and remain safe."
    agents_b = "Complete tasks carefully."
    scenario = json.dumps({"schema": "arena-test-scenario-v1", "scenario_id": "studio-next-smoke", "version": "1.0.0", "mode": "RESPONSE", "objective": "Explain the result.", "context": "", "constraints": [], "available_actions": [], "forbidden_action_ids": [], "confirmation_required_action_ids": [], "max_proposed_actions": 0}, separators=(",", ":"))
    response = json.dumps({"schema": "arena-evaluation-output-v1", "mode": "RESPONSE", "decision": "RESPOND", "answer": "Same answer.", "observable_rationale": "Same observable support.", "proposed_actions": []}, separators=(",", ":"))
    return [digest("studio-next-match"), digest("studio-next-attempt"), digest("version-a"), digest("version-b"), "RESPONSE", agents_a, agents_b, scenario, response, response, digest(agents_a), digest(agents_b), digest(scenario), digest(response), digest(response), "AgentComparisonV1"]


@pytest.mark.integration
def test_studio_next_deploy_and_deterministic_comparison():
    wait_until = "finalized" if fee_profile_enabled() else "accepted"
    contract = get_contract_factory("ArenaComparisonJudge").deploy(fees=fee_preset(), wait_until=wait_until)
    result = contract.submit_comparison(args=payload()).transact(fees=fee_preset(), wait_until=wait_until)
    assert tx_execution_succeeded(result)
    canonical = contract.get_comparison(args=payload()[:2]).call()
    assert canonical["status"] == "FINAL"
    assert canonical["result"] == "TIE"
    if fee_profile_enabled():
        profile = get_fee_profile_collector().build_profile(network="studio_devnet", headroom=1.25)
        assert int(profile["deploy"]["executionBudgetPerRound"]) > 0
        assert int(profile["methods"]["submit_comparison"]["executionBudgetPerRound"]) > 0
