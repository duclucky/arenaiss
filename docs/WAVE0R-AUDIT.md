# Wave 0R primary-agent audit log

## R1 ACI local — audit 1

- Date: `2026-09-11`
- Coding Agent scope: exactly three authorized provenance files
- Reported RED: valid; four new policy tests reached their assertions and failed
  because `VerificationError` was not raised
- Independent focused run: `20/20 PASS`
- Independent full run: `64/64 PASS`
- Compile check: `PASS`
- Scope/content inspection: requested fixture fields, tests, helper, call order,
  exact-`True` checks, and failure messages are present
- Prompt count discrepancy: primary-agent packet incorrectly expected 21 focused
  tests; the correct count after eight additions is 20. Coding Agent reported
  the mismatch correctly. This is not a Coding Agent defect.

### Independent adversarial tripwires

| Case | Expected | Observed |
| --- | --- | --- |
| `quote_verified = 1` | Reject | Reject |
| `quote_verified = "true"` | Reject | Reject |
| missing `key_custody_verified` | Reject | Reject |
| observed and expected workload measurement both empty | Reject | **Accept** |
| observed and expected custody-policy digest both empty | Reject | **Accept** |

### Verdict

`REWORK-1` — equality alone is insufficient. Both observed and expected values
must first be structurally valid `sha256:<64 lowercase-or-uppercase hex>`
digests. No live-attestation or gate claim is affected; R2 remains closed.

Corrective packet: ignored local file
`.handoffs/CODING-AGENT-R1-ACI-REWORK-1.md`.

## R1 ACI local — audit 2

- Date: `2026-09-11`
- Corrective scope: exactly `verifier.py` and `test_verifier.py`
- Reported RED: valid; both new tests reached the intended format assertions
- Independent focused run: `22/22 PASS`
- Independent full run: `66/66 PASS`
- Compile check: `PASS`

Independent tripwires confirmed rejection of matching empty digests, matching
non-hex measurements, and numeric truthy flags. A correctly formed uppercase
hex digest remains accepted, as allowed by the locked format.

### Verdict

`ACCEPTED` — R1 local feasibility behavior is closed. This proves only the
synthetic policy/verifier boundary; live quote parsing, KMS custody appraisal,
and an Arena pair-runner receipt remain BR-1 live evidence. R2 may start.

## R2 Arc source local — preflight 1

- Coding Agent verdict: `BLOCKED: R2 baseline mismatch`; no file changed
- Primary independent SHA-256:
  `f18260fbb1dd64498e101477c40ad725b233f7f18e4f06c9b8e6bcfb5698084d`
- Current byte length: `9801`
- Focused existing randomness baseline: `12/12 PASS`
- Full existing baseline: `66/66 PASS`
- Intended R2 output files remain absent

### Verdict

`PACKET CORRECTED` — the Coding Agent followed the stop rule correctly. The
expected hash in the primary-agent packet was inaccurate; because this
repository is not yet tracked, no historical Git blob can independently
reconstruct that stale value. The current file is internally verified by its
focused/full tests, and the R2 packet now pins its observed hash plus byte
length. This is not a Coding Agent defect and does not consume an implementation
attempt.

## R2 Arc source local — audit 1

- Coding Agent scope: exactly two new offline Python files
- Reported RED: valid importable-stub behavior failures
- Independent focused run: `12/12 PASS`
- Independent full run: `78/78 PASS`
- Compile check: `PASS`
- Network/contract surface: none

### Independent adversarial tripwires

| Case | Expected | Observed |
| --- | --- | --- |
| `snapshot_block_number = True` | Controlled reject | **Accept** |
| `expected_snapshot_status = True`, decoded status `1` | Controlled reject | **Accept** |
| JSON-RPC request ID `True` for expected ID `1` | Controlled reject | **Accept** |
| Non-dict member in four-bundle list | `ArcSourceError` | **Uncaught `AttributeError`** |
| Inputs remain unchanged | Accept/no mutation | Pass |
| Three matching plus one valid dissenting tuple | Accept 3-of-4 | Pass |

### Verdict

`REWORK-1` — Python boolean/integer aliasing and malformed container types must
fail closed with domain errors. The corrective packet also adds nonzero checks
for all identity/commitment/seed fields whose zero value cannot represent an
authenticated Arena snapshot. R3 remains closed.

## R2 Arc source local — audit 2

- Coding Agent result: `.handoffs/results/001-R2-ARC-SOURCE-REWORK-1-RESULT.md`
- Scope: exactly `arc_source.py` and `test_arc_source.py` plus the ignored result
- Independent focused run: `18/18 PASS`
- Independent full spike run: `84/84 PASS`
- Independent compile check: `PASS`
- Required bool-as-int, zero block/identity/commitment, non-string endpoint,
  JSON-RPC ID and quorum non-dict cases: `PASS`
- Independent extra tripwires: floating-point block and negative status reject

Direct use of `normalize_rpc_bundle(policy, [])` still raises `AttributeError`
instead of `ArcSourceError`; the required quorum entrypoint validates members
before calling the helper. Record this as future parser hardening, not a hidden
pass claim.

### Verdict

`ACCEPTED AGAINST R2 REWORK-1 PACKET`. After the owner-approved architecture
simplification, Arc-source authentication is a post-MVP trust-minimization
artifact. It does not gate the trusted MVP and does not establish a deployed
GenLayer probe or trustless randomness. R3 Notary is retired from the MVP path.
