"""Bounded verdict parser and consensus-field equivalence prototype.

The module intentionally does not call an LLM. It validates the normalized
shape that a later GenLayer contract must receive and derives the advancing
result from locked criterion weights. Rationale is non-authoritative text.
"""

import json


class VerdictError(ValueError):
    """Raised for malformed or unsafe validator output."""


def normalize_verdict(*args, **kwargs):
    return _normalize_verdict(*args, **kwargs)


def compare_consensus(*args, **kwargs):
    return _compare_consensus(*args, **kwargs)


def _retry(reason):
    return {
        "schema_version": "MatchVerdictV1",
        "result": "RETRYABLE",
        "reason": reason,
        "criterion_winners": [],
        "coverage_complete": False,
    }


def _normalize_verdict(raw, binding, rubric):
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return _retry("malformed_json")
    if not isinstance(raw, dict):
        return _retry("not_an_object")

    forbidden = {"payout_wallet", "payout_amount", "winner_wallet", "advance_id", "rank"}
    present_forbidden = sorted(forbidden.intersection(raw))
    if present_forbidden:
        raise VerdictError(f"consequential field supplied: {present_forbidden[0]}")
    if raw.get("schema_version") != "MatchVerdictV1":
        return _retry("schema_version")
    binding_fields = ("tournament_id", "round_id", "match_id", "topic_id", "entrant_a_id", "entrant_b_id")
    if not isinstance(binding, dict) or any(field not in binding for field in binding_fields):
        return _retry("binding_config")
    if any(raw.get(field) != binding.get(field) for field in binding_fields):
        return _retry("binding")
    if raw.get("coverage_complete") is not True:
        return _retry("coverage")
    criterion_ids = list(rubric["criterion_ids"])
    rows = raw.get("criterion_winners")
    if not isinstance(rows, list) or len(rows) != len(criterion_ids):
        return _retry("criterion_coverage")
    by_id = {}
    for row in rows:
        if not isinstance(row, dict):
            return _retry("criterion_shape")
        if set(row) - {"criterion_id", "winner", "rationale"}:
            return _retry("criterion_extra_field")
        criterion_id = row.get("criterion_id")
        if criterion_id in by_id:
            return _retry("criterion_duplicate")
        if criterion_id not in criterion_ids:
            return _retry("criterion_extra")
        if row.get("winner") not in rubric["winner_values"]:
            return _retry("criterion_enum")
        rationale = row.get("rationale", "")
        if not isinstance(rationale, str) or len(rationale) > rubric["max_rationale_chars"]:
            return _retry("rationale_bounds")
        by_id[criterion_id] = row["winner"]
    if set(by_id) != set(criterion_ids):
        return _retry("criterion_missing")

    normalized_rows = [{"criterion_id": criterion_id, "winner": by_id[criterion_id]} for criterion_id in criterion_ids]
    score_a = sum(rubric["weights"][criterion_id] for criterion_id, winner in by_id.items() if winner == "A")
    score_b = sum(rubric["weights"][criterion_id] for criterion_id, winner in by_id.items() if winner == "B")
    difference = score_a - score_b
    if difference >= 2:
        result = "A_WIN"
    elif difference <= -2:
        result = "B_WIN"
    else:
        result = "TIE"
    return {
        "schema_version": "MatchVerdictV1",
        "binding": {field: binding[field] for field in binding_fields},
        "criterion_winners": normalized_rows,
        "coverage_complete": True,
        "result": result,
    }


def _compare_consensus(left, right):
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    fields = ("schema_version", "binding", "criterion_winners", "coverage_complete", "result")
    return all(left.get(field) == right.get(field) for field in fields)


def agreement_rate(pairs):
    """Return agreement over consensus-critical normalized fields."""
    if not pairs:
        return 0.0
    return sum(1 for left, right in pairs if _compare_consensus(left, right)) / len(pairs)
