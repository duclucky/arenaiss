import copy
import json
import unittest
from pathlib import Path

from spikes.phase1.finality.verifier import VerificationError, verify_finality_attestation


FIXTURE = Path(__file__).with_name("fixtures") / "finalized_ranking_v1.json"


def load():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class FinalityVerifierTests(unittest.TestCase):
    def test_three_of_five_verifies_exact_digest(self):
        vector = load()
        result = verify_finality_attestation(vector, signatures=vector["notaries"][:3])
        self.assertEqual(result["digest"], vector["expected_digest"])
        self.assertEqual(len(result["signers"]), 3)

    def test_two_of_five_fails(self):
        vector = load()
        with self.assertRaisesRegex(VerificationError, "quorum"):
            verify_finality_attestation(vector, signatures=vector["notaries"][:2])

    def test_duplicate_signer_does_not_increase_quorum(self):
        vector = load()
        signatures = [vector["notaries"][0], vector["notaries"][0], vector["notaries"][1]]
        with self.assertRaisesRegex(VerificationError, "duplicate signer"):
            verify_finality_attestation(vector, signatures=signatures)

    def test_outsider_signature_fails_allowlist(self):
        vector = load()
        outsider = copy.deepcopy(vector["notaries"][2])
        outsider["address"] = "0x0000000000000000000000000000000000000001"
        with self.assertRaisesRegex(VerificationError, "declared signer"):
            verify_finality_attestation(vector, signatures=[vector["notaries"][0], vector["notaries"][1], outsider])

    def test_wrong_source_binding_fails(self):
        vector = load()
        vector["policy"]["source_chain_id"] += 1
        with self.assertRaisesRegex(VerificationError, "source chain"):
            verify_finality_attestation(vector, signatures=vector["notaries"][:3])

    def test_wrong_destination_binding_fails(self):
        vector = load()
        vector["policy"]["destination_manager"] = "0x1313131313131313131313131313131313131313"
        with self.assertRaisesRegex(VerificationError, "destination manager"):
            verify_finality_attestation(vector, signatures=vector["notaries"][:3])

    def test_finalized_but_execution_failed_is_rejected(self):
        vector = load()
        vector["message"]["executionSucceeded"] = False
        with self.assertRaisesRegex(VerificationError, "execution"):
            verify_finality_attestation(vector, signatures=vector["notaries"][:3])

    def test_unfinalized_consensus_is_rejected(self):
        vector = load()
        vector["message"]["consensusFinalized"] = False
        with self.assertRaisesRegex(VerificationError, "not finalized"):
            verify_finality_attestation(vector, signatures=vector["notaries"][:3])

    def test_tampered_ranking_binding_is_rejected_before_signatures(self):
        vector = load()
        vector["message"]["rankingDigest"] = "0x" + "cd" * 32
        with self.assertRaisesRegex(VerificationError, "rankingDigest"):
            verify_finality_attestation(vector, signatures=vector["notaries"][:3])

    def test_wrong_domain_verifier_is_rejected(self):
        vector = load()
        vector["domain"]["verifyingContract"] = "0x4545454545454545454545454545454545454545"
        with self.assertRaisesRegex(VerificationError, "verifier address"):
            verify_finality_attestation(vector, signatures=vector["notaries"][:3])

    def test_expired_and_future_statements_fail(self):
        vector = load()
        vector["policy"]["now"] = vector["message"]["expiresAt"]
        with self.assertRaisesRegex(VerificationError, "expired"):
            verify_finality_attestation(vector, signatures=vector["notaries"][:3])

        vector = load()
        vector["message"]["issuedAt"] = vector["policy"]["now"] + 31
        with self.assertRaisesRegex(VerificationError, "future"):
            verify_finality_attestation(vector, signatures=vector["notaries"][:3])

    def test_wrong_epoch_fails(self):
        vector = load()
        vector["policy"]["notary_set_epoch"] += 1
        with self.assertRaisesRegex(VerificationError, "epoch"):
            verify_finality_attestation(vector, signatures=vector["notaries"][:3])

    def test_type_schema_mutation_fails(self):
        vector = load()
        vector["types"]["FinalizedRanking"][0]["type"] = "bytes"
        with self.assertRaisesRegex(VerificationError, "type schema"):
            verify_finality_attestation(vector, signatures=vector["notaries"][:3])

    def test_malformed_signature_length_fails(self):
        vector = load()
        malformed = copy.deepcopy(vector["notaries"][:3])
        malformed[0]["signature"] = "0x1234"
        with self.assertRaisesRegex(VerificationError, "65 bytes"):
            verify_finality_attestation(vector, signatures=malformed)

    def test_replay_is_rejected(self):
        vector = load()
        consumed = set()
        verify_finality_attestation(vector, signatures=vector["notaries"][:3], consumed=consumed)
        with self.assertRaisesRegex(VerificationError, "already consumed"):
            verify_finality_attestation(vector, signatures=vector["notaries"][:3], consumed=consumed)

    def test_malleable_high_s_signature_fails(self):
        vector = load()
        forged = copy.deepcopy(vector["notaries"][:3])
        raw = bytearray.fromhex(forged[0]["signature"][2:])
        curve_n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
        s = int.from_bytes(raw[32:64], "big")
        raw[32:64] = (curve_n - s).to_bytes(32, "big")
        raw[64] = 27 if raw[64] == 28 else 28
        forged[0]["signature"] = "0x" + raw.hex()
        with self.assertRaisesRegex(VerificationError, "low-s"):
            verify_finality_attestation(vector, signatures=forged)


if __name__ == "__main__":
    unittest.main()
