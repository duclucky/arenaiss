"""Bounded Studionet Arc-source probe."""

import hashlib
import json
import collections
from eth_abi import decode


class ArcSourceError(ValueError):
    """Raised when an Arc RPC source policy or response is invalid."""


def _fail(message):
    raise ArcSourceError(message)


def _hex_int(value, error_message):
    if not isinstance(value, str) or not value.startswith("0x") or len(value) <= 2:
        _fail(error_message)
    try:
        return int(value, 16)
    except ValueError:
        _fail(error_message)


def _bytes32(value, error_message):
    if not isinstance(value, str) or not value.startswith("0x") or len(value) != 66:
        _fail(error_message)
    try:
        int(value[2:], 16)
    except ValueError:
        _fail(error_message)
    return value.lower()


def _address(value, error_message):
    if not isinstance(value, str) or not value.startswith("0x") or len(value) != 42:
        _fail(error_message)
    try:
        int(value[2:], 16)
    except ValueError:
        _fail(error_message)
    return value.lower()


def _validate_policy(policy):
    if policy.get("schema_version") != "ArcSourcePolicyV1":
        _fail("unsupported Arc source policy")
    if policy.get("arc_chain_id") != 5_042_002:
        _fail("Arc policy chain mismatch")

    snapshot_block_number = policy.get("snapshot_block_number")
    if type(snapshot_block_number) is not int or snapshot_block_number <= 0:
        _fail("snapshot block is invalid")

    _address(policy.get("manager_address", ""), "manager address is invalid")
    if policy.get("manager_address", "").lower() == "0x" + "00" * 20:
        _fail("manager address is invalid")

    _bytes32(policy.get("tournament_id", ""), "tournament ID is invalid")
    if policy.get("tournament_id", "").lower() == "0x" + "00" * 32:
        _fail("tournament ID is invalid")

    expected_snapshot_status = policy.get("expected_snapshot_status")
    if type(expected_snapshot_status) is not int or not (0 <= expected_snapshot_status <= 255):
        _fail("snapshot status is invalid")

    snapshot_calldata = policy.get("snapshot_calldata", "")
    if not isinstance(snapshot_calldata, str) or not snapshot_calldata.startswith("0x") or len(snapshot_calldata) != 10:
        _fail("snapshot calldata is invalid")
    try:
        int(snapshot_calldata[2:], 16)
    except ValueError:
        _fail("snapshot calldata is invalid")

    if policy.get("threshold") != 3:
        _fail("RPC quorum policy must be 3-of-4")

    endpoints = policy.get("endpoints", [])
    if not isinstance(endpoints, list) or len(endpoints) != 4 or any(not isinstance(e, str) for e in endpoints):
        _fail("RPC endpoints are invalid")
    if len(set(endpoints)) != 4:
        _fail("RPC endpoints must be unique")

    locked_endpoints = {
        "https://rpc.testnet.arc.io",
        "https://rpc.blockdaemon.testnet.arc.io",
        "https://rpc.drpc.testnet.arc.io",
        "https://rpc.quicknode.testnet.arc.io",
    }
    if set(endpoints) != locked_endpoints:
        _fail("RPC endpoint set does not match the locked source policy")


def _envelope(bundle, field, expected_id):
    resp = bundle.get(field, {})
    if not isinstance(resp, dict):
        _fail("JSON-RPC envelope is invalid")
    if resp.get("jsonrpc") != "2.0":
        _fail("JSON-RPC envelope is invalid")
    resp_id = resp.get("id")
    if type(resp_id) is not int or resp_id != expected_id:
        _fail("JSON-RPC envelope is invalid")
    if "error" in resp:
        _fail("JSON-RPC envelope is invalid")
    if "result" not in resp:
        _fail("JSON-RPC envelope is invalid")
    return resp["result"]


def build_rpc_requests(policy):
    _validate_policy(policy)
    manager_address = policy["manager_address"].lower()
    block_tag = hex(policy["snapshot_block_number"])
    requests = []
    for endpoint in policy["endpoints"]:
        requests.append(
            {
                "endpoint": endpoint,
                "requests": [
                    {"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []},
                    {
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "eth_getBlockByNumber",
                        "params": [block_tag, False],
                    },
                    {
                        "jsonrpc": "2.0",
                        "id": 3,
                        "method": "eth_call",
                        "params": [
                            {"to": manager_address, "data": policy["snapshot_calldata"]},
                            block_tag,
                        ],
                    },
                ],
            }
        )
    return requests


def normalize_rpc_bundle(policy, bundle):
    _validate_policy(policy)
    endpoint = bundle.get("endpoint")
    if endpoint not in policy["endpoints"]:
        _fail("RPC endpoint is not allowed")

    chain_result = _envelope(bundle, "chain_response", 1)
    block_result = _envelope(bundle, "block_response", 2)
    call_result = _envelope(bundle, "call_response", 3)

    chain_id = _hex_int(chain_result, "Arc chain mismatch")
    if chain_id != policy["arc_chain_id"]:
        _fail("Arc chain mismatch")

    if not isinstance(block_result, dict):
        _fail("snapshot block mismatch")
    block_number = _hex_int(block_result.get("number", ""), "snapshot block mismatch")
    if block_number != policy["snapshot_block_number"]:
        _fail("snapshot block mismatch")

    block_hash = block_result.get("hash", "")
    _bytes32(block_hash, "snapshot block hash is invalid")
    if block_hash == "0x" + "00" * 32:
        _fail("snapshot block hash is unavailable")

    if not isinstance(call_result, str) or not call_result.startswith("0x") or len(call_result) != 386:
        _fail("snapshot call result format is invalid")
    try:
        decoded = decode(
            ["bytes32", "bytes32", "bytes32", "uint256", "bytes32", "uint8"],
            bytes.fromhex(call_result[2:]),
        )
    except Exception:
        _fail("snapshot call result format is invalid")
    else:
        t_id, r_comm, b_comm, s_block, s_hash, s_status = decoded

        tournament_id = "0x" + t_id.hex()
        roster_commitment = "0x" + r_comm.hex()
        bracket_commitment = "0x" + b_comm.hex()
        seed_block_number = int(s_block)
        seed_block_hash = "0x" + s_hash.hex()
        snapshot_status = int(s_status)

        if tournament_id.lower() != policy["tournament_id"].lower():
            _fail("tournament binding mismatch")

        if roster_commitment.lower() == "0x" + "00" * 32:
            _fail("roster commitment is unavailable")

        if bracket_commitment.lower() == "0x" + "00" * 32:
            _fail("bracket commitment is unavailable")

        if snapshot_status != policy["expected_snapshot_status"]:
            _fail("snapshot status mismatch")

        if not (0 < seed_block_number < policy["snapshot_block_number"]):
            _fail("seed block is invalid")

        if seed_block_hash == "0x" + "00" * 32:
            _fail("seed block hash is unavailable")

        return {
            "arc_chain_id": chain_id,
            "snapshot_block_number": block_number,
            "snapshot_block_hash": block_hash.lower(),
            "manager_address": policy["manager_address"].lower(),
            "tournament_id": tournament_id.lower(),
            "roster_commitment": roster_commitment.lower(),
            "bracket_commitment": bracket_commitment.lower(),
            "seed_block_number": seed_block_number,
            "seed_block_hash": seed_block_hash.lower(),
            "snapshot_status": snapshot_status,
        }


def verify_arc_source_quorum(policy, bundles):
    _validate_policy(policy)
    if not isinstance(bundles, list) or len(bundles) != 4:
        _fail("RPC quorum policy must be 3-of-4")

    for b in bundles:
        if not isinstance(b, dict):
            _fail("RPC bundle is invalid")

    endpoints = [b.get("endpoint") for b in bundles]
    if len(set(endpoints)) != 4:
        _fail("RPC endpoints must be unique")

    locked_endpoints = {
        "https://rpc.testnet.arc.io",
        "https://rpc.blockdaemon.testnet.arc.io",
        "https://rpc.drpc.testnet.arc.io",
        "https://rpc.quicknode.testnet.arc.io",
    }
    if set(endpoints) != locked_endpoints:
        _fail("RPC endpoint set does not match the locked source policy")

    valid_results = []
    failed = 0
    for bundle in bundles:
        try:
            norm = normalize_rpc_bundle(policy, bundle)
            canonical_bytes = json.dumps(
                norm, ensure_ascii=True, separators=(",", ":"), sort_keys=True
            ).encode("ascii")
            digest = "sha256:" + hashlib.sha256(canonical_bytes).hexdigest()
            valid_results.append((digest, norm))
        except ArcSourceError:
            failed += 1

    counts = collections.Counter(d for d, _ in valid_results)
    if not counts:
        _fail("Arc source quorum is insufficient")

    best_digest, best_count = counts.most_common(1)[0]
    if best_count < 3:
        _fail("Arc source quorum is insufficient")

    for digest, norm in valid_results:
        if digest == best_digest:
            result = dict(norm)
            result["normalized_digest"] = best_digest
            result["matching"] = best_count
            result["failed"] = failed
            return result
