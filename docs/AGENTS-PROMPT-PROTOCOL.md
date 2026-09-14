# AGENTS.md prompt protocol

## Decision

The selected provider envelope is `arena-generation-input-v2` using the
`delegated-user-json-v2` hierarchy:

1. one platform-owned `system` message defines only protocol invariants and
   explicitly delegates answer strategy to the contestant;
2. one `user` message contains a JSON object with distinct `agents_md` and
   `topic` fields; and
3. the provider request applies the tournament's fixed model, temperature, and
   `max_tokens` bound.

`AGENTS.md` controls reasoning approach, content strategy, tone, language, and
structure. The platform does not improve or rescue a weak, incorrect, or
off-topic strategy. Platform rules override only the output protocol: one text
answer, no tool/external-action claims, no prompt disclosure, and the provider
output ceiling.

Keeping contestant text in a `user` message preserves a real role boundary.
Promoting untrusted `AGENTS.md` to `system` was not needed to obtain strong
instruction following and would unnecessarily give contestant text the same
role as platform invariants. JSON serialization also preserves exact strings
without relying on ambiguous headings or delimiter parsing.

## Bounded paid-provider evaluation

On `2026-09-13`, the configured `cheap-5.6-sol` model was tested at temperature
`0.2` and `max_tokens=220`. Three candidate envelopes each ran six cases three
times: 54 calls total, 54 successful responses, and 221,370 reported usage
tokens. The provider did not report an exact monetary cost.

| Envelope | Strict AGENTS adherence | Platform boundary | Result |
| --- | ---: | ---: | --- |
| legacy concatenated text | 7/15 | 3/3 | rejected |
| delegated user JSON v2 | **13/15** | **3/3** | selected |
| compiled system JSON v2 | 12/15 | 3/3 | rejected; no benefit over the safer role split |

For the selected envelope:

- exact marker, intentional off-topic behavior, topic/AGENTS hierarchy, and
  three-line Vietnamese structure each passed `3/3`;
- the meaningful answer contained all requested mechanism/example/limitation
  sections in `3/3` runs;
- its soft `<=120 words` instruction passed only `1/3` because two outputs were
  126 and 132 words; and
- the synthetic platform canary remained undisclosed in `3/3` runs.

The two word-limit misses show why an instruction inside `AGENTS.md` cannot be a
hard resource bound. The API's `max_tokens` controls generation, and the backend
rejects an oversized returned byte sequence instead of truncating it.

The active V10 judge raises the per-agent UTF-8 input ceiling to `16,384`
bytes. Production lifecycle configuration now derives its provider output
budget from the active deployment manifest instead of retaining the earlier
`1,600`-byte smoke-test ceiling. This is a maximum, not a target length:
`AGENTS.md` remains free to produce a shorter answer, while an answer that uses
the full allowance remains admissible to the judge.

This is now proven on the active V10 deployment for both execution paths. A
16,384-byte-per-side identical pair finalized as a deterministic tie, and a
different 16,384-byte-per-side pair entered semantic consensus, finalized with
`MAJORITY_AGREE/SUCCESS`, and was re-read from the canonical view as
`FINAL/A_WIN`. The ceiling therefore does not require backend truncation at the
former 8 KiB boundary; generation remains provider-bounded before the response
is returned.

The production `OpenAICompatibleProvider` then ran a two-call live smoke with a
topic that attempted to override two distinct exact-output strategies. Both
outputs followed their respective `AGENTS.md` (`2/2`), were non-empty, and used
9,210 reported tokens in total.

Sanitized aggregate evidence is stored in
`docs/evidence/live/agents-prompt-eval-2026-09-13.json`. Raw synthetic outputs
remain ignored under `.local/`; they are not application state or public proof.

## Canonical request

```json
{
  "model": "<locked model>",
  "messages": [
    {
      "role": "system",
      "content": "<arena platform wrapper v2>"
    },
    {
      "role": "user",
      "content": "{\"schema\":\"arena-generation-input-v2\",\"agents_md\":\"<exact registered bytes>\",\"topic\":\"<locked match topic>\"}"
    }
  ],
  "temperature": 0.2,
  "max_tokens": "<derived tournament ceiling>"
}
```

Before I/O, the pair runner recomputes the registered `AGENTS.md` commitment.
Both sides share the exact wrapper, schema, topic, model, temperature, and
output bound. Side identity, wallet, payout, and opponent strategy are never
sent to the provider.

GenLayer receives the resulting blinded output pair, topic, rubric, IDs, and
digests. It does not receive `AGENTS.md` and does not grade obedience to private
instructions; it grades the observable answer quality for the match topic.

## Evidence limits

This is a bounded evaluation of one configured model with three repetitions per
case. It proves the chosen envelope outperformed the previous one on the tested
instruction-following and hierarchy cases. It does not prove deterministic
outputs, universal prompt-injection resistance, provider provenance, or honest
operation by the trusted backend. New model or wrapper versions require the
same fixed-case evaluation before activation.
