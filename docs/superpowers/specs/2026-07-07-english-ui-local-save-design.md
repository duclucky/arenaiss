# English UI + Anonymous Save Design

## Goal
Bring the hero loop back into compliance by making all product-facing UI copy English, adding explicit Passport affordances on every slab, and persisting anonymous game progress locally with the agreed daily virtual-credit refill rule.

## Scope
- Product UI, e2e selectors, and README safety copy must be English.
- Internal handoff and project docs may remain Vietnamese.
- Anonymous progress is stored in `localStorage` only for game progress: roster, credits, deck tokens, pack count, pull history, `version`, and `savedAt`.
- No API keys, secrets, auth tokens, cookies, or sensitive data are stored client-side.
- Google login is deferred to a separate implementation step because it needs auth/provider and server storage decisions.

## User Experience
- Header shows virtual credits, read-only mode, anonymous local save state, and a reset progress action.
- Intro explains the loop with the approved English sentence and makes the simulated economy clear.
- After the first pack, users see a one-time hint: "Tap any card to view its real Card Passport".
- Slabs use pointer hover, tier glow, a persistent info mark, and a hover overlay reading "View Passport ->".
- Pack result has a clear primary exit action, "Add to collection ->", separate from Passport interactions.
- Anonymous save copy states: "Data is saved only on this device."

## Credit Rule
Implement a pure function:

```ts
applyDailyCreditRefill(input: {
  credits: number;
  lastRefillAt: string | null;
  now: Date;
}): {
  credits: number;
  lastRefillAt: string;
  refilled: boolean;
}
```

At the first observed 00:00 UTC boundary after `lastRefillAt`, if `credits < 100`, set credits to `200`. If credits are `>= 100`, update the refill marker without changing the balance. Never stack or add credits.

## Persistence
- `lib/game/credit.ts` owns the pure refill function.
- `lib/game/save.ts` owns serialization, parsing, versioning, migration, and sanitization.
- `app/arena/state.tsx` hydrates saved state on the client, applies refill, persists after state changes, and clears storage on reset.
- Hydration must not persist transient network/UI data such as pool loading, pool error, open Passport token, or live battle state.

## Testing
- Add TypeScript tests under `tests/` using `tsx` and Node `assert`.
- Tests must cover no refill before midnight, refill to exactly 200 when below 100 after midnight, no top-up at or above 100, and save parse/migration failures.
- Existing e2e script should be updated to English selectors.

## Acceptance
- `npm.cmd run typecheck`
- `npm.cmd run build`
- `npx.cmd tsx tests/credit-save.test.mts`
- Client bundle scan confirms no `rk_`, `rsk_`, `ANTHROPIC_API_KEY`, or forbidden write/trading SDK strings.
