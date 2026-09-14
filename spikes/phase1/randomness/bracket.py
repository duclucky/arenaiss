"""Arc-blockhash randomness and deterministic bracket prototype.

This spike treats a finalized Arc block hash as the entropy authority. The
future contract must prove the same block hash through its Arc environment;
this offline module does not query a chain.
"""

import hashlib
import json

from eth_abi import encode
from eth_hash.auto import keccak


class BracketError(ValueError):
    """Raised when a draw or bracket is invalid."""


def derive_seed(*args, **kwargs):
    vector = args[0] if args else kwargs["vector"]
    return _derive_seed(vector, consumed_commitments=kwargs.get("consumed_commitments"))


def build_bracket(*args, **kwargs):
    case = args[0] if args else kwargs["case"]
    return _build_bracket(case)


def verify_bracket_fixture(*args, **kwargs):
    case = args[0] if args else kwargs["case"]
    return _verify_bracket_fixture(case)


def verify_rpc_quorum(*args, **kwargs):
    observation = args[0] if args else kwargs["observation"]
    return _verify_rpc_quorum(observation)


_SEED_DOMAIN = keccak(b"AsyncAgentArenaBlockhashRandomnessV1")
_MATCH_DOMAIN = keccak(b"AsyncAgentArenaMatchIdV1")
_ARC_TESTNET_CHAIN_ID = 5_042_002
_ARC_RPC_ENDPOINTS = {
    "https://rpc.testnet.arc.io",
    "https://rpc.blockdaemon.testnet.arc.io",
    "https://rpc.drpc.testnet.arc.io",
    "https://rpc.quicknode.testnet.arc.io",
}


def _fail(message):
    raise BracketError(message)


def _jcs(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("ascii")


def _bytes32(value):
    if not isinstance(value, str) or not value.startswith("0x") or len(value) != 66:
        _fail("bytes32 field is malformed")
    try:
        return bytes.fromhex(value[2:])
    except ValueError as exc:
        raise BracketError("bytes32 field is not hexadecimal") from exc


def _verify_rpc_quorum(observation):
    if observation.get("schema_version") != "AsyncAgentArenaLiveArcObservationV1":
        _fail("unsupported Arc observation schema")
    network = observation.get("network", {})
    if network.get("chain_id") != _ARC_TESTNET_CHAIN_ID:
        _fail("Arc observation chain mismatch")
    randomness = observation.get("randomness_observation", {})
    seed_block = randomness.get("seed_block")
    canonical_hash = randomness.get("seed_block_hash")
    if not isinstance(seed_block, int) or seed_block < 0:
        _fail("seed block number is invalid")
    _bytes32(canonical_hash)

    quorum = randomness.get("rpc_quorum", {})
    required = quorum.get("required")
    responses = quorum.get("responses")
    if required != 3 or not isinstance(responses, list) or len(responses) != 4:
        _fail("RPC quorum policy must be 3-of-4")

    endpoints = [response.get("endpoint") for response in responses]
    if len(set(endpoints)) != len(endpoints):
        _fail("RPC endpoints must be unique")
    if set(endpoints) != _ARC_RPC_ENDPOINTS:
        _fail("RPC endpoint set does not match the locked source policy")

    matching = 0
    for response in responses:
        if response.get("chain_id") != _ARC_TESTNET_CHAIN_ID:
            _fail("RPC response chain mismatch")
        if response.get("block_number") != seed_block:
            _fail("RPC response block number mismatch")
        response_hash = response.get("block_hash")
        _bytes32(response_hash)
        if response_hash.lower() == canonical_hash.lower():
            matching += 1
    if matching < required:
        _fail("RPC block-hash quorum is insufficient")
    if quorum.get("matching") != matching:
        _fail("recorded RPC matching count is incorrect")
    return {
        "required": required,
        "matching": matching,
        "block_number": seed_block,
        "block_hash": canonical_hash,
    }


def _commitment(vector):
    return "0x" + keccak(
        encode(
            ["bytes32", "uint256", "address", "bytes32", "bytes32", "bytes32", "uint256", "uint256"],
            [
                _SEED_DOMAIN,
                vector["chain_id"],
                vector["escrow_address"],
                _bytes32(vector["tournament_id"]),
                _bytes32(vector["roster_commitment"]),
                _bytes32(vector["topic_deck_commitment"]),
                vector["bracket_revision"],
                vector["seed_block"],
            ],
        )
    ).hex()


def _derive_seed(vector, consumed_commitments=None):
    if vector.get("schema_version") != "ArcBlockhashRandomnessV1":
        _fail("unsupported randomness schema")
    if not isinstance(vector.get("seed_block"), int) or not isinstance(vector.get("observed_block_number"), int):
        _fail("block numbers must be integers")
    if vector["observed_block_number"] < vector["seed_block"]:
        _fail("seed block is not mined")
    if vector["observed_block_number"] >= vector["seed_block"] + 256:
        _fail("seed blockhash is expired")
    block_hash = _bytes32(vector["block_hash"])
    if block_hash == bytes(32):
        _fail("zero block hash is unavailable")
    commitment = _commitment(vector)
    if vector.get("seed_commitment") is not None and vector["seed_commitment"].lower() != commitment.lower():
        _fail("seed commitment mismatch")
    if consumed_commitments is not None:
        if commitment in consumed_commitments:
            _fail("seed commitment already consumed")
        consumed_commitments.add(commitment)
    return "0x" + keccak(encode(["bytes32", "bytes32", "bytes32"], [_SEED_DOMAIN, bytes.fromhex(commitment[2:]), block_hash])).hex()


def _draw(seed_hex, upper_bound, context):
    if not isinstance(upper_bound, int) or upper_bound <= 0 or upper_bound > 2**256:
        _fail("draw upper bound is invalid")
    seed = _bytes32(seed_hex)
    limit = 2**256 - (2**256 % upper_bound)
    for counter in range(256):
        candidate = int.from_bytes(keccak(seed + context.encode("ascii") + counter.to_bytes(4, "big")), "big")
        if candidate < limit:
            return candidate % upper_bound
    _fail("rejection sampler exhausted")


def _match_id(tournament_id, revision, round_number, match_index):
    return "0x" + keccak(
        encode(
            ["bytes32", "bytes32", "uint256", "uint256", "uint256"],
            [_MATCH_DOMAIN, _bytes32(tournament_id), revision, round_number, match_index],
        )
    ).hex()


def _build_bracket(case):
    entrants = list(case["entrant_ids"])
    n = len(entrants)
    if n < 8 or n > 32:
        _fail("entrant count is outside the locked 8-32 range")
    if len(set(entrants)) != n:
        _fail("entrant IDs must be unique")
    if case["topic_count"] <= 0:
        _fail("topic deck must be non-empty")
    seed = case["seed_hex"]
    ordered = entrants[:]
    for index in range(n - 1, 0, -1):
        swap = _draw(seed, index + 1, f"perm:{case['bracket_revision']}:{index}")
        ordered[index], ordered[swap] = ordered[swap], ordered[index]

    base = 1 << (n.bit_length() - 1)
    preliminary_count = n - base
    preliminary_entrant_count = preliminary_count * 2
    preliminary = []
    for index in range(preliminary_count):
        a = ordered[index * 2]
        b = ordered[index * 2 + 1]
        match_id = _match_id(case["tournament_id"], case["bracket_revision"], 0, index)
        preliminary.append(
            {
                "round": 0,
                "match_index": index,
                "match_id": match_id,
                "slot_a": a,
                "slot_b": b,
                "topic_index": _draw(seed, case["topic_count"], f"topic:{match_id}"),
            }
        )

    byes = ordered[preliminary_entrant_count:]
    main_slots = [f"WINNER:r0:m{index}" for index in range(preliminary_count)] + byes
    main_matches = []
    slots = main_slots
    round_number = 1
    while len(slots) > 1:
        next_slots = []
        for index in range(len(slots) // 2):
            match_id = _match_id(case["tournament_id"], case["bracket_revision"], round_number, index)
            main_matches.append(
                {
                    "round": round_number,
                    "match_index": index,
                    "match_id": match_id,
                    "slot_a": slots[index * 2],
                    "slot_b": slots[index * 2 + 1],
                    "topic_index": _draw(seed, case["topic_count"], f"topic:{match_id}"),
                }
            )
            next_slots.append(f"WINNER:r{round_number}:m{index}")
        slots = next_slots
        round_number += 1

    bracket = {
        "schema_version": "BracketRandomnessV1",
        "tournament_id": case["tournament_id"],
        "bracket_revision": case["bracket_revision"],
        "entrant_order": ordered,
        "preliminary": preliminary,
        "byes": byes,
        "main": main_matches,
    }
    bracket["bracket_digest"] = "0x" + keccak(_jcs(bracket)).hex()
    return bracket


def _verify_bracket_fixture(case):
    bracket = _build_bracket(case)
    if bracket["bracket_digest"].lower() != case["expected_bracket_digest"].lower():
        _fail("bracket digest mismatch")
    if bracket["byes"] != case["expected_byes"]:
        _fail("bye vector mismatch")
    if bracket["preliminary"] != case["expected_preliminary"]:
        _fail("preliminary vector mismatch")
    if bracket["main"] != case["expected_main"]:
        _fail("main bracket vector mismatch")
    if len(bracket["preliminary"]) != case["expected_preliminary_match_count"]:
        _fail("preliminary match count mismatch")
    if len(bracket["byes"]) != case["expected_bye_count"]:
        _fail("bye count mismatch")
    return {
        "bracket_digest": bracket["bracket_digest"],
        "preliminary_match_count": len(bracket["preliminary"]),
        "bye_count": len(bracket["byes"]),
        "main_match_count": len(bracket["main"]),
    }
