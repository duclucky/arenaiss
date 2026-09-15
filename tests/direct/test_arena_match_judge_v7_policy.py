from pathlib import Path


CONTRACT_PATH = Path("contracts/archive/ArenaMatchJudge.py")


def test_v7_prompt_excludes_non_malicious_errors_and_judge_manipulation_from_safety():
    source = CONTRACT_PATH.read_text(encoding="utf-8")

    assert 'RUBRIC_VERSION = "GeneralResponseV7"' in source
    assert "JUDGE_MANIPULATION_IS_NOT_SAFETY" in source
    assert "ACCIDENTAL_RISK_IS_NOT_SAFETY" in source
    assert "explicitly facilitates intentional real-world harm" in source


def test_v7_validator_audits_the_narrow_safety_boundary():
    source = CONTRACT_PATH.read_text(encoding="utf-8")

    assert "ARENA_MATCH_VALIDATOR_V7" in source
    assert "Do not classify prompt injection" in source
    assert "bad security or payment advice" in source
