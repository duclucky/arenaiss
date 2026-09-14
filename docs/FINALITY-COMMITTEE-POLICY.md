# GenLayer finality committee policy

> **Post-MVP TM-3 only:** configured-operator settlement replaces this committee
> in the active MVP. No R3 Notary batch or live committee is currently required.

## Status and trust statement

`FinalityCommitteeV1` is the future trust-minimized policy for carrying an already-finalized
GenLayer ranking to Arc. It is a threshold-attested finality mechanism with
permissionless delivery, not a trustless bridge or light client.

Safety assumes at least three of five enrolled operators do not sign a false
statement. Liveness assumes three are available before settlement expiry.

## Committee composition

- exactly five active signers per epoch;
- threshold exactly three distinct canonical EVM signatures;
- five independently controlled organizations or operators;
- tournament operator, model runner, and coordinator together must not control
  quorum;
- no single organization may contribute more than one signer in an epoch;
- operational independence includes separate signing custody and GenLayer RPC
  control planes; using four URLs backed by one operator is not four operators.

Organizational independence is governance evidence, not something ECDSA alone
proves. Enrollment records therefore require review before an epoch can be
activated.

## Public enrollment manifest

Each signer entry contains only non-secret data:

```text
policy = "FinalityCommitteeV1"
epoch
operator_id
operator_legal_or_public_name
signer_address
key_custody_type
key_custody_attestation_ref
genlayer_rpc_policy_digest
runbook_digest
effective_from
effective_until
conflict_disclosure_ref
```

The complete ordered signer set, threshold, and manifest digest are committed
before tournament registration. Private keys, recovery material, credentials,
and internal RPC configuration must never enter the repository or evidence
bundle.

## Independent signing procedure

Every operator independently:

1. reads the pinned GenLayer source chain and exact judge contract;
2. verifies the adjudication transaction is `Finalized` and execution
   succeeded;
3. reads the judge's canonical tournament view at the finalized state;
4. verifies exact tournament, roster, bracket, complete match coverage, ranking
   digest, source judge, and reciprocal Arc destination bindings;
5. checks the settlement nonce has not been signed for another payload;
6. computes and signs the exact `FinalizedRankingV1` EIP-712 digest;
7. publishes only the signature and sanitized observation metadata.

An operator must not sign data supplied solely by the coordinator. Failure to
obtain canonical state is a refusal/retry, not permission to trust a payload.

## Epoch and recovery rules

- the tournament pins one epoch before registration and never follows a later
  mutable default;
- ordinary rotation applies only to future tournaments after a timelock and
  complete new manifest;
- compromised keys trigger pause and future-epoch replacement, but pause cannot
  set a ranking, change payout destinations, or move escrowed value;
- duplicate, wrong-epoch, high-s, expired, future, or non-member signatures do
  not count toward quorum;
- if quorum is unavailable through the locked expiry, the only MVP recovery is
  cancellation and pro-rata/full entry-stake refund according to the value
  matrix; no administrator may choose winners;
- proof delivery is permissionless and idempotent; the caller carries no
  authority beyond the verified signatures.

Equivocation evidence consists of two different valid statements signed by the
same member for the same source tournament and settlement nonce. MVP governance
may remove that member from future epochs. No slashing claim is made until a
separate bonded mechanism and value-destination policy exist.

## Live admission evidence required

Before Gate 4 can pass, the project needs:

- five named, independently controlled operators and their public manifests;
- custody evidence for all five signing keys;
- an approved GenLayer RPC/finality polling runbook per operator;
- a live ceremony that freezes the ordered signer set and epoch digest;
- three or more live signatures over one canonical finalized test statement;
- negative evidence for 2-of-5, duplicate signer, wrong epoch, execution
  failure, stale/future statement, wrong judge/manager, and equivocation;
- Arc verifier receipt/state evidence showing one-time consumption without
  trusting the delivery caller.

The current offline fixture proves the message format and verification logic
only. It does not prove operator independence, canonical polling, live custody,
Solidity parity, or onchain consumption.
