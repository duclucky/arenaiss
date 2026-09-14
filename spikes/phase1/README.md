# Phase 1 bounded verifier prototypes

These offline prototypes answer six narrow feasibility questions. They are not
production services, Arc contracts, GenLayer contracts, bridge proofs, deployed
TEE evidence, or authorization to settle USDC.

## Run

From the repository root:

```powershell
python -m unittest discover -s spikes/phase1 -p "test_*.py" -v
```

Regenerate the synthetic bracket/accounting tables with:

```powershell
python -m spikes.phase1.generate_vectors
python -m spikes.phase1.semantic.generate_corpus
```

The generators are deterministic and offline. They never query a chain, wallet,
model provider, OnLatch, or GenLayer.

The workstation versions used for the recorded run were Python `3.13.14`,
`cryptography 50.0.0`, `eth-account 0.14.0`, `eth-keys 0.8.0`,
`eth-abi 6.0.0`, and `eth-hash 0.8.0`. No project dependency manifest was
added because this remains a feasibility spike.

## Provenance prototype

`provenance/verifier.py` verifies:

- the official `aci/1` Ed25519 receipt vector from dstack ACI revision
  `19daf2b7152eeaf1f8be3fd66d261b8c1ce8eac5`;
- exact wire request and response SHA-256 bindings;
- the pinned workload-keyset digest, key ID, verified upstream session, model,
  endpoint, event order, and receipt freshness;
- an Arena-specific synthetic profile in which one signed receipt covers both
  contestants under one model and attempt;
- EVM-friendly prompt commitments and topic, wrapper, model-policy,
  generation-policy, per-slot request, response, output, match, and attempt
  bindings; and
- exact-positive attestation appraisal flags, pinned workload measurement,
  key-custody policy binding, and structurally valid SHA-256 digests; and
- one-time attempt consumption.

The Arena profile uses ACI extension events. A later workload must implement
that profile inside the attested boundary; an ordinary proxy cannot manufacture
equivalent evidence after the model calls.

## Finality prototype

`finality/verifier.py` verifies a `FinalizedRankingV1` EIP-712 statement with:

- exact GenLayer source and Arc destination bindings;
- exact schema, tournament, roster, bracket, ranking, nonce, and notary epoch;
- both consensus-finalized and execution-succeeded flags;
- expiry and future-skew checks;
- canonical low-s secp256k1 signatures from distinct active notaries;
- a 3-of-5 threshold; and
- one-time settlement-proof consumption.

The fixture keys are deterministic test-only identities and contain no funded
wallet or operational credential.

## Randomness and bracket prototype

`randomness/bracket.py` implements the bounded `ArcBlockhashRandomnessV1`
profile. It validates a mined, non-expired blockhash and a single-use seed
commitment, then uses domain-separated rejection sampling and Fisher–Yates to
derive a roster permutation. Every preliminary/main match topic is derived from
its match ID. The vectors cover entrant counts 8 through 32, including byes and
all main-bracket matches.

This is not proof that a production contract can authenticate an Arc blockhash,
recover from withheld entropy, or prevent a deployed coordinator from censoring
an otherwise valid draw.

A read-only Arc Testnet observation on 2026-09-11 used the previous mined block
as the seed and reproduced the bounded derivation for an 8-entrant sample. All
four no-key endpoints listed by the current Arc documentation returned the same
exact block hash. The local verifier requires the locked 3-of-4 policy and
rejects duplicate endpoints, wrong chain/block, and insufficient matching
hashes. The observation is
recorded in [`docs/evidence/arc-testnet/live-rpc-usdc-randomness-2026-09-11.json`](../../docs/evidence/arc-testnet/live-rpc-usdc-randomness-2026-09-11.json).
The tournament/escrow bindings in that sample are synthetic because the Arena
contract is not deployed; no onchain randomness-consumption proof is claimed.

## Semantic stability prototype

`semantic/verifier.py` normalizes `MatchVerdictV1` output against a five-criterion
weighted rubric. It requires exact tournament/round/match/topic/entrant bindings,
complete criterion coverage, and a bounded rationale. It rejects extra,
duplicate, missing, invalid, swapped, malformed, or payout-bearing output and
derives `A_WIN`, `B_WIN`, `TIE`, or `RETRYABLE` in deterministic code. The 17-case
corpus includes clear outcomes, ties, close cases, paraphrases, prompt
injection, hostile rationale, malformed vectors, and validator disagreement.

No LLM or validator network call is represented; this is parser and equivalence
feasibility only.

## Top-five accounting prototype

`accounting/model.py` models integer micro-USDC destinations for entrant counts
8 through 32. It locks a 1,000 BPS fee, applies `[4000, 2500, 1500, 1200, 800]`
to the 90% net pool, sends any division remainder to rank 1, and returns the
full gross pool with no fee on cancellation. Duplicate settlement and
withdrawal actions are explicit rejects. The fixture also locks one rematch on a
new committed topic, a deterministic criterion/seeded fallback, and cancellation
with refund for retryable or expired work. Model/API and GenLayer GEN expenses
remain external platform-operations costs rather than escrow debits.

This is not a Solidity property test or live USDC transfer/withdrawal evidence.
The canonical Arc Testnet USDC contract was read-only checked for non-empty code,
symbol `USDC`, and 6 decimals in the same evidence file. No wallet or transfer
was used, so escrow credit/withdrawal evidence remains a later deployment gate.

## What the tests prove

The fixtures and executable checks prove that the proposed message formats,
bracket derivation, semantic normalization, and accounting destinations are
deterministic bounded prototypes and that the recorded adversarial mutations
fail closed. This is sufficient to carry the selected profiles into the
admission artifacts, not to authorize contract work.

They do not prove:

- a deployed Arena pair-runner with a fresh hardware attestation;
- correct private-key custody in a TEE;
- exact provider model weights in `ATTESTED_PROVIDER_ROUTE` mode;
- five independent organizations operating finality notaries;
- that a notary actually queried finalized GenLayer state; or
- byte-for-byte parity with the future Solidity verifier.

Those items remain mandatory before production-security, decentralization, or
live settlement claims.
