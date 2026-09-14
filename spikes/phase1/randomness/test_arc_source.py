import copy
import unittest

from eth_abi import encode

from spikes.phase1.randomness.arc_source import (
    ArcSourceError,
    build_rpc_requests,
    normalize_rpc_bundle,
    verify_arc_source_quorum,
)


CHAIN_ID = 5_042_002
SNAPSHOT_BLOCK = 61_544_328
BLOCK_HASH = "0x4de2a3c8fd65d31d027c3033491a7277a2cb6ed9db6b3aad33b2e26cd6d621e1"
MANAGER = "0x3434343434343434343434343434343434343434"
TOURNAMENT_ID = "0x" + "11" * 32
ROSTER_COMMITMENT = "0x" + "22" * 32
BRACKET_COMMITMENT = "0x" + "33" * 32
SEED_BLOCK = 61_544_318
SEED_HASH = "0x" + "44" * 32
SNAPSHOT_STATUS = 2
SNAPSHOT_CALLDATA = "0x12345678"
ENDPOINTS = (
    "https://rpc.testnet.arc.io",
    "https://rpc.blockdaemon.testnet.arc.io",
    "https://rpc.drpc.testnet.arc.io",
    "https://rpc.quicknode.testnet.arc.io",
)


def make_policy():
    return {
        "schema_version": "ArcSourcePolicyV1",
        "arc_chain_id": CHAIN_ID,
        "snapshot_block_number": SNAPSHOT_BLOCK,
        "manager_address": MANAGER,
        "tournament_id": TOURNAMENT_ID,
        "expected_snapshot_status": SNAPSHOT_STATUS,
        "snapshot_calldata": SNAPSHOT_CALLDATA,
        "threshold": 3,
        "endpoints": list(ENDPOINTS),
    }


def make_call_result(**kwargs):
    values = {
        "tournament_id": TOURNAMENT_ID,
        "roster_commitment": ROSTER_COMMITMENT,
        "bracket_commitment": BRACKET_COMMITMENT,
        "seed_block_number": SEED_BLOCK,
        "seed_block_hash": SEED_HASH,
        "snapshot_status": SNAPSHOT_STATUS,
    }
    values.update(kwargs)

    encoded = encode(
        [
            "bytes32",
            "bytes32",
            "bytes32",
            "uint256",
            "bytes32",
            "uint8",
        ],
        [
            bytes.fromhex(values["tournament_id"][2:]),
            bytes.fromhex(values["roster_commitment"][2:]),
            bytes.fromhex(values["bracket_commitment"][2:]),
            values["seed_block_number"],
            bytes.fromhex(values["seed_block_hash"][2:]),
            values["snapshot_status"],
        ],
    )
    return "0x" + encoded.hex()


def make_bundle(endpoint):
    return {
        "endpoint": endpoint,
        "chain_response": {"jsonrpc": "2.0", "id": 1, "result": hex(CHAIN_ID)},
        "block_response": {
            "jsonrpc": "2.0",
            "id": 2,
            "result": {"number": hex(SNAPSHOT_BLOCK), "hash": BLOCK_HASH},
        },
        "call_response": {"jsonrpc": "2.0", "id": 3, "result": make_call_result()},
    }


def make_bundles():
    return [make_bundle(ep) for ep in ENDPOINTS]


class ArcSourcePrototypeTests(unittest.TestCase):
    def test_requests_use_exact_block_and_never_latest(self):
        result = build_rpc_requests(make_policy())
        self.assertIsNotNone(result)
        self.assertEqual(len(result), 4)
        for i, entry in enumerate(result):
            self.assertEqual(entry["endpoint"], ENDPOINTS[i])
            self.assertEqual(len(entry["requests"]), 3)

            req1, req2, req3 = entry["requests"]
            self.assertEqual(req1["id"], 1)
            self.assertEqual(req1["method"], "eth_chainId")

            self.assertEqual(req2["id"], 2)
            self.assertEqual(req2["method"], "eth_getBlockByNumber")
            self.assertEqual(req2["params"], [hex(SNAPSHOT_BLOCK), False])

            self.assertEqual(req3["id"], 3)
            self.assertEqual(req3["method"], "eth_call")
            self.assertEqual(
                req3["params"],
                [{"to": MANAGER, "data": SNAPSHOT_CALLDATA}, hex(SNAPSHOT_BLOCK)],
            )

        self.assertNotIn("latest", repr(result))

    def test_four_of_four_snapshot_quorum_normalizes(self):
        result = verify_arc_source_quorum(make_policy(), make_bundles())
        self.assertIsNotNone(result)
        self.assertEqual(result["matching"], 4)
        self.assertEqual(result["failed"], 0)

        self.assertEqual(result["arc_chain_id"], CHAIN_ID)
        self.assertEqual(result["snapshot_block_number"], SNAPSHOT_BLOCK)
        self.assertEqual(result["snapshot_block_hash"], BLOCK_HASH.lower())
        self.assertEqual(result["manager_address"], MANAGER.lower())
        self.assertEqual(result["tournament_id"], TOURNAMENT_ID.lower())
        self.assertEqual(result["roster_commitment"], ROSTER_COMMITMENT.lower())
        self.assertEqual(result["bracket_commitment"], BRACKET_COMMITMENT.lower())
        self.assertEqual(result["seed_block_number"], SEED_BLOCK)
        self.assertEqual(result["seed_block_hash"], SEED_HASH.lower())
        self.assertEqual(result["snapshot_status"], SNAPSHOT_STATUS)

        digest = result["normalized_digest"]
        self.assertTrue(digest.startswith("sha256:"))
        self.assertEqual(len(digest), 71)

    def test_response_order_does_not_change_normalized_digest(self):
        result1 = verify_arc_source_quorum(make_policy(), make_bundles())
        self.assertIsNotNone(result1)

        bundles_reversed = list(reversed(make_bundles()))
        result2 = verify_arc_source_quorum(make_policy(), bundles_reversed)
        self.assertIsNotNone(result2)

        self.assertEqual(result1["normalized_digest"], result2["normalized_digest"])

    def test_one_malformed_source_still_allows_three_of_four(self):
        bundles = make_bundles()
        bundles[0]["call_response"]["result"] = "0x1234"
        result = verify_arc_source_quorum(make_policy(), bundles)
        self.assertIsNotNone(result)
        self.assertEqual(result["matching"], 3)
        self.assertEqual(result["failed"], 1)

    def test_two_malformed_sources_fail_quorum(self):
        bundles = make_bundles()
        bundles[0]["call_response"]["result"] = "0x1234"
        bundles[1]["call_response"]["result"] = "0x1234"
        with self.assertRaisesRegex(ArcSourceError, "Arc source quorum is insufficient"):
            verify_arc_source_quorum(make_policy(), bundles)

    def test_duplicate_endpoint_is_rejected(self):
        bundles = make_bundles()
        bundles[1]["endpoint"] = bundles[0]["endpoint"]
        with self.assertRaisesRegex(ArcSourceError, "RPC endpoints must be unique"):
            verify_arc_source_quorum(make_policy(), bundles)

    def test_endpoint_alias_is_rejected(self):
        bundles = make_bundles()
        bundles[0]["endpoint"] = "https://example.invalid/arc"
        with self.assertRaisesRegex(ArcSourceError, "RPC endpoint set does not match"):
            verify_arc_source_quorum(make_policy(), bundles)

    def test_two_wrong_chain_sources_fail_quorum(self):
        bundles = make_bundles()
        bundles[0]["chain_response"]["result"] = hex(1)
        bundles[1]["chain_response"]["result"] = hex(1)
        with self.assertRaisesRegex(ArcSourceError, "Arc source quorum is insufficient"):
            verify_arc_source_quorum(make_policy(), bundles)

    def test_two_wrong_block_sources_fail_quorum(self):
        bundles = make_bundles()
        bundles[0]["block_response"]["result"]["number"] = hex(SNAPSHOT_BLOCK - 1)
        bundles[1]["block_response"]["result"]["number"] = hex(SNAPSHOT_BLOCK - 1)
        with self.assertRaisesRegex(ArcSourceError, "Arc source quorum is insufficient"):
            verify_arc_source_quorum(make_policy(), bundles)

    def test_two_by_two_snapshot_split_fails_quorum(self):
        bundles = make_bundles()
        alt_call_result = make_call_result(roster_commitment="0x" + "55" * 32)
        bundles[0]["call_response"]["result"] = alt_call_result
        bundles[1]["call_response"]["result"] = alt_call_result
        with self.assertRaisesRegex(ArcSourceError, "Arc source quorum is insufficient"):
            verify_arc_source_quorum(make_policy(), bundles)

    def test_normalizer_rejects_wrong_snapshot_meaning(self):
        policy = make_policy()

        with self.subTest(case="wrong tournament"):
            bundle = make_bundle(ENDPOINTS[0])
            bundle["call_response"]["result"] = make_call_result(tournament_id="0x" + "ff" * 32)
            with self.assertRaisesRegex(ArcSourceError, "tournament binding mismatch"):
                normalize_rpc_bundle(policy, bundle)

        with self.subTest(case="status 3"):
            bundle = make_bundle(ENDPOINTS[0])
            bundle["call_response"]["result"] = make_call_result(snapshot_status=3)
            with self.assertRaisesRegex(ArcSourceError, "snapshot status mismatch"):
                normalize_rpc_bundle(policy, bundle)

        with self.subTest(case="seed block equal to snapshot_block"):
            bundle = make_bundle(ENDPOINTS[0])
            bundle["call_response"]["result"] = make_call_result(seed_block_number=SNAPSHOT_BLOCK)
            with self.assertRaisesRegex(ArcSourceError, "seed block is invalid"):
                normalize_rpc_bundle(policy, bundle)

        with self.subTest(case="zero seed hash"):
            bundle = make_bundle(ENDPOINTS[0])
            bundle["call_response"]["result"] = make_call_result(seed_block_hash="0x" + "00" * 32)
            with self.assertRaisesRegex(ArcSourceError, "seed block hash is unavailable"):
                normalize_rpc_bundle(policy, bundle)

    def test_normalizer_rejects_malformed_rpc_envelopes_and_call_size(self):
        policy = make_policy()

        with self.subTest(case="error code and missing result"):
            bundle = make_bundle(ENDPOINTS[0])
            del bundle["chain_response"]["result"]
            bundle["chain_response"]["error"] = {"code": -1}
            with self.assertRaisesRegex(ArcSourceError, "JSON-RPC envelope is invalid"):
                normalize_rpc_bundle(policy, bundle)

        with self.subTest(case="wrong ID"):
            bundle = make_bundle(ENDPOINTS[0])
            bundle["block_response"]["id"] = 99
            with self.assertRaisesRegex(ArcSourceError, "JSON-RPC envelope is invalid"):
                normalize_rpc_bundle(policy, bundle)

        with self.subTest(case="append 00 to valid call result"):
            bundle = make_bundle(ENDPOINTS[0])
            bundle["call_response"]["result"] += "00"
            with self.assertRaisesRegex(ArcSourceError, "snapshot call result format is invalid"):
                normalize_rpc_bundle(policy, bundle)

    def test_policy_integer_fields_reject_bool_and_zero_block(self):
        with self.subTest(case="snapshot_block_number=True"):
            policy = make_policy()
            policy["snapshot_block_number"] = True
            with self.assertRaisesRegex(ArcSourceError, "snapshot block is invalid"):
                build_rpc_requests(policy)

        with self.subTest(case="snapshot_block_number=0"):
            policy = make_policy()
            policy["snapshot_block_number"] = 0
            with self.assertRaisesRegex(ArcSourceError, "snapshot block is invalid"):
                build_rpc_requests(policy)

        with self.subTest(case="expected_snapshot_status=True, decoded=1"):
            policy = make_policy()
            policy["expected_snapshot_status"] = True
            bundle = make_bundle(ENDPOINTS[0])
            bundle["call_response"]["result"] = make_call_result(snapshot_status=1)
            with self.assertRaisesRegex(ArcSourceError, "snapshot status is invalid"):
                normalize_rpc_bundle(policy, bundle)

    def test_json_rpc_id_rejects_boolean_alias(self):
        policy = make_policy()
        bundle = make_bundle(ENDPOINTS[0])
        bundle["chain_response"]["id"] = True
        with self.assertRaisesRegex(ArcSourceError, "JSON-RPC envelope is invalid"):
            normalize_rpc_bundle(policy, bundle)

    def test_quorum_maps_non_dict_bundle_to_domain_error(self):
        bundles = make_bundles()
        bundles[0] = "not-a-bundle"
        try:
            verify_arc_source_quorum(make_policy(), bundles)
        except Exception as exc:
            self.assertIsInstance(exc, ArcSourceError)
            self.assertRegex(str(exc), "RPC bundle is invalid")
        else:
            self.fail("ArcSourceError not raised")

    def test_policy_maps_non_string_endpoint_to_domain_error(self):
        policy = make_policy()
        policy["endpoints"][0] = []
        try:
            build_rpc_requests(policy)
        except Exception as exc:
            self.assertIsInstance(exc, ArcSourceError)
            self.assertRegex(str(exc), "RPC endpoints are invalid")
        else:
            self.fail("ArcSourceError not raised")

    def test_policy_rejects_zero_manager_and_tournament(self):
        with self.subTest(case="zero manager address"):
            policy = make_policy()
            policy["manager_address"] = "0x" + "00" * 20
            with self.assertRaisesRegex(ArcSourceError, "manager address is invalid"):
                build_rpc_requests(policy)

        with self.subTest(case="zero tournament bytes32"):
            policy = make_policy()
            policy["tournament_id"] = "0x" + "00" * 32
            with self.assertRaisesRegex(ArcSourceError, "tournament ID is invalid"):
                build_rpc_requests(policy)

    def test_normalizer_rejects_zero_commitments_and_seed_block(self):
        policy = make_policy()

        with self.subTest(case="zero roster commitment"):
            bundle = make_bundle(ENDPOINTS[0])
            bundle["call_response"]["result"] = make_call_result(roster_commitment="0x" + "00" * 32)
            with self.assertRaisesRegex(ArcSourceError, "roster commitment is unavailable"):
                normalize_rpc_bundle(policy, bundle)

        with self.subTest(case="zero bracket commitment"):
            bundle = make_bundle(ENDPOINTS[0])
            bundle["call_response"]["result"] = make_call_result(bracket_commitment="0x" + "00" * 32)
            with self.assertRaisesRegex(ArcSourceError, "bracket commitment is unavailable"):
                normalize_rpc_bundle(policy, bundle)

        with self.subTest(case="seed_block_number=0"):
            bundle = make_bundle(ENDPOINTS[0])
            bundle["call_response"]["result"] = make_call_result(seed_block_number=0)
            with self.assertRaisesRegex(ArcSourceError, "seed block is invalid"):
                normalize_rpc_bundle(policy, bundle)

if __name__ == "__main__":
    unittest.main()
