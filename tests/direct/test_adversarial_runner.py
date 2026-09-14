from pathlib import Path


RUNNER_PATH = Path("scripts/run-studionet-adversarial.ps1")


def _runner_source() -> str:
    return RUNNER_PATH.read_text(encoding="utf-8")


def test_runner_stops_after_unsuccessful_execution():
    source = _runner_source()

    assert "$execution -ne 'SUCCESS'" in source
    assert "execution failed" in source


def test_runner_can_explicitly_skip_a_failed_attempt_without_retrying_it():
    source = _runner_source()

    assert "[string[]]$SkipCaseIds" in source
    assert "$SkipCaseIds -contains $matchId" in source
    assert "SKIP_REQUESTED" in source


def test_runner_splats_a_fixed_size_native_argument_array():
    source = _runner_source()

    assert "$writeArgs = @(" in source
    assert "$writeArgs.Count -ne 12" in source
    assert "& genlayer @writeArgs" in source
