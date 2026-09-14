"""Bounded offline verifier for a threshold EIP-712 finality statement.

This is deliberately not a Solidity contract and does not query GenLayer.  It
tests the exact proof boundary that a later Arc verifier must reproduce.
"""

from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak, to_checksum_address


class VerificationError(ValueError):
    """Raised when an attestation cannot authorize Arc settlement."""


def verify_finality_attestation(*args, **kwargs):
    return _verify_finality_attestation(*args, **kwargs)


_DOMAIN_TYPES = [
    {"name": "name", "type": "string"},
    {"name": "version", "type": "string"},
    {"name": "chainId", "type": "uint256"},
    {"name": "verifyingContract", "type": "address"},
]
_FINALIZED_RANKING_TYPES = [
    {"name": "schemaHash", "type": "bytes32"},
    {"name": "sourceChainId", "type": "uint256"},
    {"name": "sourceJudge", "type": "address"},
    {"name": "sourceTxHash", "type": "bytes32"},
    {"name": "sourceFinalityRef", "type": "bytes32"},
    {"name": "consensusFinalized", "type": "bool"},
    {"name": "executionSucceeded", "type": "bool"},
    {"name": "destinationChainId", "type": "uint256"},
    {"name": "destinationManager", "type": "address"},
    {"name": "tournamentId", "type": "bytes32"},
    {"name": "rosterCommitment", "type": "bytes32"},
    {"name": "bracketCommitment", "type": "bytes32"},
    {"name": "rankingDigest", "type": "bytes32"},
    {"name": "settlementNonce", "type": "uint256"},
    {"name": "notarySetEpoch", "type": "uint256"},
    {"name": "issuedAt", "type": "uint256"},
    {"name": "expiresAt", "type": "uint256"},
]
_CURVE_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
_HALF_CURVE_N = _CURVE_N // 2


def _fail(message):
    raise VerificationError(message)


def _same_address(left, right):
    try:
        return to_checksum_address(left) == to_checksum_address(right)
    except (TypeError, ValueError):
        return False


def _typed_data(vector):
    return {
        "types": {"EIP712Domain": _DOMAIN_TYPES, **vector["types"]},
        "primaryType": vector["primaryType"],
        "domain": vector["domain"],
        "message": vector["message"],
    }


def _verify_finality_attestation(vector, signatures=None, consumed=None, now=None):
    if vector.get("profile") != "FinalizedRankingV1":
        _fail("unsupported finality profile")

    domain = vector["domain"]
    message = vector["message"]
    policy = vector["policy"]
    signatures = vector["notaries"] if signatures is None else signatures
    now = policy["now"] if now is None else now

    if domain.get("name") != "AsyncAgentArenaFinality" or domain.get("version") != "1":
        _fail("wrong EIP-712 domain")
    if domain.get("chainId") != policy["destination_chain_id"]:
        _fail("wrong domain chain")
    if not _same_address(domain.get("verifyingContract"), policy["verifier_address"]):
        _fail("wrong verifier address")
    if vector.get("primaryType") != "FinalizedRanking":
        _fail("wrong primary type")
    if vector.get("types") != {"FinalizedRanking": _FINALIZED_RANKING_TYPES}:
        _fail("wrong FinalizedRanking type schema")

    if message.get("sourceChainId") != policy["source_chain_id"]:
        _fail("wrong source chain")
    if not _same_address(message.get("sourceJudge"), policy["source_judge"]):
        _fail("wrong source judge")
    if message.get("destinationChainId") != policy["destination_chain_id"]:
        _fail("wrong destination chain")
    if not _same_address(message.get("destinationManager"), policy["destination_manager"]):
        _fail("wrong destination manager")
    if message.get("notarySetEpoch") != policy["notary_set_epoch"]:
        _fail("wrong notary epoch")
    locked_fields = {
        "schemaHash": "schema_hash",
        "tournamentId": "tournament_id",
        "rosterCommitment": "roster_commitment",
        "bracketCommitment": "bracket_commitment",
        "rankingDigest": "ranking_digest",
        "settlementNonce": "settlement_nonce",
    }
    for message_field, policy_field in locked_fields.items():
        if message.get(message_field) != policy[policy_field]:
            _fail(f"wrong locked {message_field}")
    if message.get("consensusFinalized") is not True:
        _fail("consensus is not finalized")
    if message.get("executionSucceeded") is not True:
        _fail("source execution did not succeed")
    if message.get("issuedAt") > now + policy["max_future_skew_seconds"]:
        _fail("statement issued in the future")
    if message.get("expiresAt") <= now:
        _fail("statement expired")
    if message.get("expiresAt") <= message.get("issuedAt"):
        _fail("invalid statement lifetime")

    signable = encode_typed_data(full_message=_typed_data(vector))
    digest = "0x" + keccak(b"\x19" + signable.version + signable.header + signable.body).hex()
    active_list = [to_checksum_address(address) for address in policy["active_notaries"]]
    active = set(active_list)
    if len(active_list) != 5 or len(active) != 5 or policy["threshold"] != 3:
        _fail("prototype policy must be an exact 3-of-5 distinct notary set")
    recovered = []
    for item in signatures:
        declared = to_checksum_address(item["address"])
        if declared in recovered:
            _fail("duplicate signer")
        raw = bytes.fromhex(item["signature"].removeprefix("0x"))
        if len(raw) != 65:
            _fail("signature must be 65 bytes")
        s = int.from_bytes(raw[32:64], "big")
        if s == 0 or s > _HALF_CURVE_N:
            _fail("signature is not low-s canonical")
        if raw[64] not in (27, 28):
            _fail("signature v must be 27 or 28")
        try:
            signer = to_checksum_address(Account.recover_message(signable, signature=raw))
        except Exception as exc:
            raise VerificationError("signature recovery failed") from exc
        if signer != declared:
            _fail("signature does not match declared signer")
        if signer not in active:
            _fail("signer is not in active notary set")
        recovered.append(signer)

    if len(recovered) < policy["threshold"]:
        _fail("notary quorum not reached")

    settlement_id = digest.lower()
    if consumed is not None:
        if settlement_id in consumed:
            _fail("settlement proof already consumed")
        consumed.add(settlement_id)

    return {
        "digest": digest,
        "settlement_id": settlement_id,
        "signers": tuple(recovered),
        "ranking_digest": message["rankingDigest"],
    }
