import ast
from pathlib import Path

import pytest


CONTRACTS = (
    Path("contracts/ArenaMatchJudge.py"),
    Path("contracts/AgentEvaluationJudge.py"),
)
STUDIO_DEV_RUNNER = "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng"


def _vm_calls(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    calls: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        owner = node.func.value
        if (
            isinstance(owner, ast.Attribute)
            and owner.attr == "vm"
            and isinstance(owner.value, ast.Name)
            and owner.value.id == "gl"
        ):
            calls.append(node.func.attr)
    return calls


@pytest.mark.parametrize("contract_path", CONTRACTS)
def test_studio_dev_contract_uses_v03_custom_validator_api(contract_path: Path):
    source = contract_path.read_text(encoding="utf-8")
    assert source.splitlines()[0] == f'# {{ "Depends": "{STUDIO_DEV_RUNNER}" }}'

    calls = _vm_calls(contract_path)
    assert "run_nondet" in calls
    assert "run_nondet_unsafe" not in calls
