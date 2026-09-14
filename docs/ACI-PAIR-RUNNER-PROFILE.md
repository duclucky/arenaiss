# Arena ACI atomic pair-runner profile

> **Post-MVP TM-1 only:** no Arena ACI/TEE runner is required or claimed by the
> trusted-operator MVP. Retain this profile for future trust minimization.

## Status and purpose

`AsyncAgentArenaACI/1` is the required application profile over dstack ACI
`aci/1`. This document locks the Arena-specific receipt semantics before a live
runner is selected or deployed. It is not deployment or hardware-attestation
evidence.

The profile authenticates that two contestants were evaluated as one match
attempt under the same locked route and generation policy. It does not decide
the winner, custody USDC, or authorize Arc settlement.

## Locked assurance mode for MVP

The MVP uses `ATTESTED_PROVIDER_ROUTE`:

- the attested workload binds the exact request bytes sent to the locked
  provider endpoint and model identifier;
- it binds the exact response bytes returned for both slots;
- it does **not** prove that a hosted provider kept identical model weights
  behind that identifier.

Claims about exact weights require a future `ATTESTED_MODEL_ARTIFACT` profile
and separate evidence. Payment method, including API keys or x402, is outside
the receipt authority and cannot make a receipt valid.

## Atomic request

One `MatchInferenceRequestV1` contains both slots and is canonicalized before it
enters the workload:

```text
profile = "AsyncAgentArenaACI/1"
arc_chain_id
arc_manager
tournament_id
round_id
match_id
attempt_id
entrant_a_id
entrant_b_id
prompt_a_plaintext
prompt_b_plaintext
prompt_commitment_a
prompt_commitment_b
topic_id
topic_plaintext
topic_digest
system_wrapper
system_wrapper_digest
provider_endpoint_id
model_id
model_policy_digest
generation_policy
generation_policy_digest
request_nonce
issued_at
expires_at
```

The workload recomputes every commitment/digest from the exact plaintext or
canonical object it uses. A mismatch terminates the whole attempt. Neither slot
may be retried, substituted, or returned independently.

## Required signed event sequence

ACI permits implementation-specific events, which generic verifiers may
ignore. The Arena verifier must instead require this exact ordered sequence and
reject missing, duplicated, reordered, or extra Arena slot events:

1. `request.received`
2. `request.forwarded`
3. `arena.request.forwarded` with `slot = A`
4. `arena.request.forwarded` with `slot = B`
5. `upstream.verified` when the deployment is an aggregator
6. `arena.response.returned` with `slot = A`
7. `arena.response.returned` with `slot = B`
8. `response.returned`

Every event is covered by the receipt signature. The two Arena request events
bind the exact provider request bytes; the two Arena response events bind the
exact returned bytes. The outer response binds one canonical
`AttestedMatchResultV1` containing both outputs and their digests.

## Verifier policy

Before GenLayer semantic judgment, the application verifier must:

1. validate the ACI JCS/Ed25519 receipt signature against the receipt key in the
   attested workload keyset;
2. validate quote freshness, nonce binding, keyset digest, expected TEE policy,
   workload measurement, and TLS SPKI binding;
3. validate the deployment's key-custody appraisal chain, including the
   configured KMS/release policy; a generated public key alone is insufficient;
4. require profile `AsyncAgentArenaACI/1` and the exact event sequence above;
5. recompute the canonical match request and all prompt/topic/wrapper/model/
   generation-policy digests;
6. require one unused `(match_id, attempt_id, request_nonce)` and exact Arc
   tournament bindings;
7. recompute both output digests from the bytes passed to the judge;
8. reject stale, future, partial, swapped, selectively retried, or ambiguous
   receipts before any winner/advancement transition.

The receipt's `served_at` is workload-asserted and is not a global ordering
oracle. Durable replay/audit evidence must archive the signed receipt, keyset,
attestation appraisal, and an external append-only observation reference.

## Failure mapping

| Failure | Result | Permitted consequence |
| --- | --- | --- |
| Quote, keyset, KMS policy, measurement, or signature invalid | `UNVERIFIABLE_PROVENANCE` | No judgment or advancement |
| Prompt/topic/wrapper/model/policy binding mismatch | `UNVERIFIABLE_PROVENANCE` | No judgment or advancement |
| One slot fails or is missing | `RETRYABLE_PAIR` | New attempt for both slots only |
| Receipt or artifact temporarily unavailable | `RETRYABLE_EVIDENCE` | No judgment or advancement |
| Nonce/attempt replay or swapped slots | Reject | No canonical mutation except an allowed audit record |
| Attempt cap/expiry reached | Tournament recovery policy | Cancel/refund; never operator-selected winner |

## Live admission evidence required

This profile becomes usable only after one deployed runner supplies a sanitized
evidence bundle proving:

- fresh hardware quote and application-policy appraisal;
- report-data binding to the exact keyset and fresh verifier nonce;
- key-custody/KMS release policy, not a skipped check;
- one real atomic A/B request and signed per-request receipt;
- independent recomputation of all request/output digests and event ordering;
- negative probes for wrong slot, altered bytes, replay, expiry, and partial
  provider failure;
- pinned runner revision, endpoint policy, measurement, public keys, and
  evidence timestamp.

Until all items exist, the generic live ACI check and synthetic fixture remain
useful feasibility evidence only; Gate 4 stays open.
