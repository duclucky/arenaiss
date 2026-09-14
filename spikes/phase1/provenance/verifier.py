"""Bounded ACI receipt and atomic Arena match-profile verifier.

The verifier proves fixture/schema feasibility only.  It does not validate a
live hardware quote or establish that the synthetic Arena workload exists.
"""

import hashlib
import json

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from eth_abi import encode
from eth_hash.auto import keccak


class VerificationError(ValueError):
    """Raised when a receipt cannot authorize a consequential transition."""


def verify_aci_receipt(*args, **kwargs):
    return _verify_aci_receipt(*args, **kwargs)


def verify_arena_match(*args, **kwargs):
    return _verify_arena_match(*args, **kwargs)


_PROMPT_DOMAIN = keccak(b"AsyncAgentArenaPromptCommitmentV1")


def _fail(message):
    raise VerificationError(message)


def _jcs(value):
    def reject_floats(node):
        if isinstance(node, float):
            _fail("floating-point values are outside this bounded JCS profile")
        if isinstance(node, dict):
            for key, child in node.items():
                if not isinstance(key, str) or not key.isascii():
                    _fail("JCS object keys must be ASCII strings")
                reject_floats(child)
        elif isinstance(node, list):
            for child in node:
                reject_floats(child)

    reject_floats(value)
    try:
        return json.dumps(
            value,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("ascii")
    except (TypeError, UnicodeEncodeError) as exc:
        raise VerificationError("value is outside this bounded JCS profile") from exc


def _sha256(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _keccak_hex(data):
    return "0x" + keccak(data).hex()


def _event(receipt, event_type):
    found = [(index, item) for index, item in enumerate(receipt["event_log"]) if item.get("type") == event_type]
    if len(found) != 1:
        _fail(f"receipt must contain exactly one {event_type} event")
    return found[0]


def _verify_aci_receipt(
    receipt,
    request_body,
    response_body,
    trust_anchor,
    *,
    expected_endpoint,
    expected_model,
    expected_forwarded_body=None,
    now=None,
    max_age_seconds=None,
    max_future_skew_seconds=0,
):
    if receipt.get("api_version") != "aci/1":
        _fail("unsupported ACI version")
    if receipt.get("method") != "POST":
        _fail("receipt method must be POST")
    if receipt.get("endpoint") != expected_endpoint:
        _fail("receipt endpoint mismatch")
    if receipt.get("model") != expected_model:
        _fail("receipt model mismatch")
    if receipt.get("key_id") != trust_anchor["key_id"]:
        _fail("receipt key id mismatch")
    if receipt.get("workload_keyset_digest") != trust_anchor["workload_keyset_digest"]:
        _fail("workload keyset digest mismatch")

    received_index, received = _event(receipt, "request.received")
    forwarded_index, forwarded = _event(receipt, "request.forwarded")
    upstream_index, upstream = _event(receipt, "upstream.verified")
    returned_index, returned = _event(receipt, "response.returned")
    if not (received_index < forwarded_index < upstream_index < returned_index):
        _fail("ACI event sequence is invalid")
    if received.get("body_hash") != _sha256(request_body):
        _fail("request body hash mismatch")
    if expected_forwarded_body is not None and forwarded.get("body_hash") != _sha256(expected_forwarded_body):
        _fail("forwarded request body hash mismatch")
    if returned.get("body_hash") != _sha256(response_body):
        _fail("response body hash mismatch")
    if (
        upstream.get("result") != "verified"
        or upstream.get("required") is not True
        or upstream.get("session_id") != trust_anchor["session_id"]
        or upstream.get("model_id") != expected_model
    ):
        _fail("verified upstream session/model binding mismatch")

    if now is not None:
        served_at = receipt.get("served_at")
        if not isinstance(served_at, int):
            _fail("served_at must be an integer")
        if served_at > now + max_future_skew_seconds:
            _fail("receipt served_at is in the future")
        if max_age_seconds is not None and served_at < now - max_age_seconds:
            _fail("receipt is stale")

    unsigned = dict(receipt)
    signature_hex = unsigned.pop("signature", None)
    try:
        signature = bytes.fromhex(signature_hex)
        public_key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(trust_anchor["public_key_hex"]))
        public_key.verify(signature, _jcs(unsigned))
    except (TypeError, ValueError, InvalidSignature) as exc:
        raise VerificationError("receipt signature is invalid") from exc

    return {
        "receipt_id": receipt["receipt_id"],
        "served_at": receipt["served_at"],
        "workload_keyset_digest": receipt["workload_keyset_digest"],
    }


def _prompt_commitment(request, slot):
    slot_lower = slot.lower()
    prompt_digest = keccak(request[f"prompt_{slot_lower}"].encode("utf-8"))
    encoded = encode(
        ["bytes32", "uint256", "address", "bytes32", "bytes32", "uint256", "bytes32"],
        [
            _PROMPT_DOMAIN,
            request["arc_chain_id"],
            request["arc_manager"],
            bytes.fromhex(request["tournament_id"][2:]),
            bytes.fromhex(request[f"entrant_{slot_lower}_id"][2:]),
            request[f"prompt_version_{slot_lower}"],
            prompt_digest,
        ],
    )
    return _keccak_hex(encoded)


def _expected_provider_request(request, slot):
    prompt = request[f"prompt_{slot.lower()}"]
    generation = request["generation_policy"]
    if generation["temperature_milli"] % 1000:
        _fail("prototype supports whole-number provider temperature only")
    return {
        "max_tokens": generation["max_tokens"],
        "messages": [
            {"content": request["system_wrapper"], "role": "system"},
            {"content": f"{prompt}\n\nTOPIC: {request['topic']}", "role": "user"},
        ],
        "model": request["model"],
        "temperature": generation["temperature_milli"] // 1000,
    }


def _arena_profile_events(receipt):
    expected = [
        ("request.received", None),
        ("request.forwarded", None),
        ("arena.request.forwarded", "A"),
        ("arena.request.forwarded", "B"),
        ("upstream.verified", None),
        ("arena.response.returned", "A"),
        ("arena.response.returned", "B"),
        ("response.returned", None),
    ]
    actual = [(event.get("type"), event.get("slot")) for event in receipt.get("event_log", [])]
    if actual != expected:
        _fail("Arena atomic event sequence is invalid")


def _require_sha256_digest(value, error_message):
    if not isinstance(value, str):
        _fail(error_message)
    if not value.startswith("sha256:"):
        _fail(error_message)
    if len(value) != 71:
        _fail(error_message)
    try:
        decoded = bytes.fromhex(value[7:])
    except ValueError:
        _fail(error_message)
    else:
        if len(decoded) != 32:
            _fail(error_message)


def _verify_attestation_policy(trust_anchor):
    for key in (
        "quote_verified",
        "report_data_keyset_bound",
        "attestation_nonce_fresh",
        "tls_spki_bound",
    ):
        if trust_anchor.get(key) is not True:
            _fail("attestation policy is not verified")
    workload_measurement = trust_anchor.get("workload_measurement")
    expected_workload_measurement = trust_anchor.get("expected_workload_measurement")
    _require_sha256_digest(workload_measurement, "workload measurement format is invalid")
    _require_sha256_digest(expected_workload_measurement, "workload measurement format is invalid")
    if (
        workload_measurement is None
        or expected_workload_measurement is None
        or workload_measurement != expected_workload_measurement
    ):
        _fail("workload measurement mismatch")
    if trust_anchor.get("key_custody_verified") is not True:
        _fail("key custody policy is not verified")
    key_custody_policy_digest = trust_anchor.get("key_custody_policy_digest")
    expected_key_custody_policy_digest = trust_anchor.get("expected_key_custody_policy_digest")
    _require_sha256_digest(key_custody_policy_digest, "key custody policy digest format is invalid")
    _require_sha256_digest(expected_key_custody_policy_digest, "key custody policy digest format is invalid")
    if (
        key_custody_policy_digest is None
        or expected_key_custody_policy_digest is None
        or key_custody_policy_digest != expected_key_custody_policy_digest
    ):
        _fail("key custody policy mismatch")


def _verify_arena_match(vector, consumed_attempts=None):
    if vector.get("profile") != "AsyncAgentArenaACI/1":
        _fail("unsupported Arena ACI profile")
    request = vector["request"]
    response = vector["response"]
    policy = vector["policy"]
    receipt = vector["receipt"]
    trust_anchor = vector["trust_anchor"]

    _verify_attestation_policy(trust_anchor)

    if request.get("schema_version") != "MatchInferenceRequestV1":
        _fail("wrong request schema")
    if response.get("schema_version") != "MatchInferenceResponseV1":
        _fail("wrong response schema")
    if request["arc_chain_id"] != policy["arc_chain_id"]:
        _fail("Arc chain binding mismatch")
    if request["arc_manager"].lower() != policy["arc_manager"].lower():
        _fail("Arc manager binding mismatch")
    if request["model"] != policy["model"] or receipt.get("model") != policy["model"]:
        _fail("model binding mismatch")
    if request["entrant_a_id"] == request["entrant_b_id"]:
        _fail("contestants must be distinct")
    if request["issued_at"] > policy["now"] + policy["max_future_skew_seconds"]:
        _fail("request was issued in the future")
    if request["expires_at"] <= policy["now"]:
        _fail("request expired")
    if not request["issued_at"] <= receipt.get("served_at", -1) < request["expires_at"]:
        _fail("receipt falls outside request lifetime")

    for slot in ("A", "B"):
        expected = _prompt_commitment(request, slot)
        if request[f"prompt_commitment_{slot.lower()}"] != expected:
            _fail(f"prompt commitment {slot} mismatch")
    if request["topic_digest"] != _keccak_hex(request["topic"].encode("utf-8")):
        _fail("topic digest mismatch")
    if request["system_wrapper_digest"] != _keccak_hex(request["system_wrapper"].encode("utf-8")):
        _fail("system wrapper digest mismatch")
    if request["model_policy_digest"] != _keccak_hex(_jcs({"assurance_mode": "ATTESTED_PROVIDER_ROUTE", "model": request["model"]})):
        _fail("model policy digest mismatch")
    if request["generation_policy_digest"] != _keccak_hex(_jcs(request["generation_policy"])):
        _fail("generation policy digest mismatch")
    if request["model_policy_digest"] != policy["model_policy_digest"]:
        _fail("locked model policy mismatch")
    if request["generation_policy_digest"] != policy["generation_policy_digest"]:
        _fail("locked generation policy mismatch")

    if set(vector["provider_requests"]) != {"A", "B"} or set(vector["provider_responses"]) != {"A", "B"}:
        _fail("provider slots must be exactly A and B")
    if set(response.get("outputs", {})) != {"A", "B"}:
        _fail("response slots must be exactly A and B")
    if response["match_id"] != request["match_id"] or response["attempt_id"] != request["attempt_id"]:
        _fail("response match/attempt binding mismatch")
    if response["model"] != request["model"]:
        _fail("response model mismatch")

    for slot in ("A", "B"):
        provider_request = vector["provider_requests"][slot]
        if provider_request != _expected_provider_request(request, slot):
            _fail(f"provider request {slot} mismatch")
        provider_response = vector["provider_responses"][slot]
        try:
            provider_text = provider_response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise VerificationError(f"provider response {slot} shape invalid") from exc
        output = response["outputs"][slot]
        if output["text"] != provider_text or output["digest"] != _keccak_hex(provider_text.encode("utf-8")):
            _fail(f"output digest {slot} mismatch")

    _arena_profile_events(receipt)
    forward_plan = {"A": vector["provider_requests"]["A"], "B": vector["provider_requests"]["B"]}
    events = receipt["event_log"]
    for offset, slot in ((2, "A"), (3, "B")):
        if events[offset].get("body_hash") != _sha256(_jcs(vector["provider_requests"][slot])):
            _fail(f"provider request event {slot} mismatch")
    for offset, slot in ((5, "A"), (6, "B")):
        expected_hash = _sha256(_jcs(vector["provider_responses"][slot]))
        expected_digest = response["outputs"][slot]["digest"]
        if events[offset].get("body_hash") != expected_hash or events[offset].get("output_digest") != expected_digest:
            _fail(f"provider response event {slot} mismatch")

    verify_aci_receipt(
        receipt,
        _jcs(request),
        _jcs(response),
        trust_anchor,
        expected_endpoint=policy["endpoint"],
        expected_model=policy["model"],
        expected_forwarded_body=_jcs(forward_plan),
        now=policy["now"],
        max_age_seconds=policy["max_age_seconds"],
        max_future_skew_seconds=policy["max_future_skew_seconds"],
    )

    attempt_id = request["attempt_id"].lower()
    if consumed_attempts is not None:
        if attempt_id in consumed_attempts:
            _fail("attempt receipt already consumed")
        consumed_attempts.add(attempt_id)

    return {
        "attempt_id": request["attempt_id"],
        "match_id": request["match_id"],
        "output_digests": (response["outputs"]["A"]["digest"], response["outputs"]["B"]["digest"]),
        "slots": ("A", "B"),
    }
