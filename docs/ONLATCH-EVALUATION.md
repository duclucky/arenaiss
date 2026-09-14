# OnLatch evaluation for Async Agent Arena

## Decision

Use OnLatch as an optional operational gateway for the platform's model API
credential and spend policy. Do not use a Latch token, request ID, Activity row,
or currently documented authorization receipt as consequential proof that a
tournament output came from the locked prompt and model.

The provenance spike therefore keeps dstack ACI as its cryptographic receipt
base and defines an Arena-specific atomic A/B profile on top. OnLatch may sit in
the upstream path, but its billing and policy evidence stays outside the winner
and payout proof.

## What was verified

Public documentation and the authenticated dashboard were inspected on
`2026-09-11`. The dashboard inspection was read-only except for selecting a
template in an unsaved new-latch form; no latch, secret, API key, provider call,
or paid request was created.

OnLatch demonstrably provides:

- server-side storage of the real upstream credential;
- a scoped `lat_...` token for callers;
- ordered allow/deny filters for endpoint, HTTP method, request payload, rate,
  time, identity, and spend;
- expiry, timeout, dry-run simulation, multi-mount routing, and Activity logs;
- request and response body logging when explicitly enabled; and
- an enclave-backed policy venue and attestation-oriented audit presentation.

These capabilities make OnLatch a good fit for:

```text
platform operations treasury / model API key
        -> OnLatch endpoint + method + model + token + spend limits
        -> attested Arena pair runner / provider route
```

## Why it is not the provenance authority yet

The public Proxy API returns the upstream response plus correlation headers.
Its self-authorization response can include a short-lived signed `receipt`, but
the public OpenAPI description does not publish the receipt's payload schema,
signature algorithm, public-key discovery, attestation binding, stable offline
verification procedure, or byte-exact test vectors.

Consequently, currently available public material does not let an Arc verifier
prove all of these facts deterministically:

```text
exact tournament + match + attempt
+ exact prompt commitments for A and B
+ exact topic and system wrapper
+ same model and generation policy
+ both exact response bodies
+ one atomic no-selective-retry job
```

An Activity record is useful operational evidence, but it remains a hosted log.
A correlation ID does not authenticate the response body. A policy-allow receipt
shows that a request was permitted, which is different from proving the exact
model output returned by an attested workload.

## Configuration mutability note

The Latches guide says a single-upstream latch's upstream and secret are fixed
after creation, while the `11 Aug 2026` changelog says both can now be changed.
The newer changelog is treated as the current behavior. Therefore a latch ID by
itself is not an immutable model-route commitment; the tournament would need an
independently signed policy/version digest if this configuration became part of
consequential evidence.

## Re-evaluation conditions

OnLatch can replace or directly satisfy the Arena provenance layer only after it
publishes or supplies all of the following for the exact deployed venue:

1. a stable signed response-receipt schema;
2. public-key and hardware-attestation verification material;
3. request and response byte digests plus immutable policy/model version;
4. an atomic two-contestant profile or equivalent batch binding;
5. replay and freshness semantics suitable for the dispute window; and
6. independent verifier code and positive/adversarial test vectors.

## Sources

- [OnLatch introduction](https://onlatch.com/docs)
- [Latches](https://onlatch.com/docs/get-started/latches)
- [Activity](https://onlatch.com/docs/guides/activity)
- [Proxy API OpenAPI 0.2.0](https://onlatch.com/openapi.json)
- [Changelog](https://onlatch.com/docs/changelog)
