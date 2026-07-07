# Renaiss Arena — Gacha-as-Draft Card Battler

> Hackathon submission · Renaiss S1
> A card-battler where the **real Renaiss gacha mechanic *is* how you draft your deck.**
> Open packs (transparent odds) → collect graded-card templates → build a 5-card
> deck → play a **skill-based** turn duel → win virtual credits → open more. Every
> card opens a **Card Passport** with real on-chain + reference data, and a funnel
> back to the real Renaiss packs & marketplace.

Built with Next.js (App Router) + TypeScript. **Read-only, no wallet, no real money.**
Internal build notes live in `docs/`, `AGENTS.md`, and `CLAUDE.md`.

---

## The hero loop (what to demo)

`Vault (odds) → Open pack (tiered reveal) → Roster → Deck builder (team power) →
Battle (Top-Trumps with skill) → Result (credits) → Card Passport (real data) →
"Own it for real"`

The core bet: instead of making players search/drag cards, we use the **actual
gacha loop** as the drafting mechanic — the same emotional beat Renaiss sells — but
fully simulated, so it doubles as a funnel into the real ecosystem.

---

## Data sources (3, separated by role)

| # | Source | Role in the game | Auth |
|---|--------|------------------|------|
| A | **`api.renaiss.xyz`** (v0, GET) | `/v0/marketplace` = the **card pool** (real graded cards: grade, year, FMV, custody). `/v0/cards/{tokenId}` = Card Passport (image, custody, on-chain activities). `/v0/packs` = the **"own it for real"** funnel. | none (public read) |
| B | **`@renaiss-protocol/client@alpha`** | `createPublicClient()` gacha reads (tier taxonomy). **Read-only client only.** | none |
| C | **`api.renaissos.com`** (v1) | Reference price + confidence + deltas + source breakdown for the Card Passport. | partner key, **server-side only** |

### Attribution (required)
Any number shown from source C is labeled **"Renaiss OS Index"** with an `asOf`
timestamp and a beta caveat, in both the UI and the AI narration.

All three are hit **only through server-side proxy routes** (`app/api/**`) so keys
never reach the client, CORS/rate-limits are handled once, and responses are cached
and Zod-validated. See `docs/api-reference.md` for exact shapes (reconciled against
the live alpha on 2026-07-07).

---

## Assumptions (and why)

- **Gacha odds are *estimated from the real marketplace pool composition*, not read
  from chain.** The alpha SDK does **not** expose a per-tier `chance` field
  (`GachaMachineContent = { name, tier, buybackBaseValueInUsd, frontImageUrl }`), and
  the public gacha-machine list endpoint returns **404** in this environment. So the
  hybrid design keeps *real tier labels* + a *real card pool* but derives odds
  transparently from tier composition. This is labeled everywhere as an estimate, not
  a claim about on-chain draw probability. (Documented in `docs/api-reference.md`.)
- **Game stats are derived, fictional gameplay attributes** — computed transparently
  from real fields (grade→ATK, year→DEF, FMV-percentile→AURA, set-identity→element).
  Formulas are published in-app and in `lib/game/stats.ts`. They are **not** valuations.
- **Card images are constructed from the graded serial** (`.../graded-cards-renders/
  {serial}/nft_image.jpg`, with `_silver`/`_golden` variants handled via `onError`)
  so a grid of cards needs **zero extra API calls** — avoids marketplace rate-limits.
  The Passport still fetches full `/v0/cards/{tokenId}` for exact data.
- **Battle balance was tuned by self-play** (`scripts/balance.mts`, `sweep.mts`):
  type-advantage (×1.36 / ×0.78) is the strongest lever so a *skilled* low-tier deck
  beats a high-tier deck ~42% of the time (vs ~26% playing randomly) — player decision
  weight ≥ card rarity, per the design brief.

## Limitations

- Data is **beta** — may be missing/stale. The UI shows a "experimental reference,
  not verified market truth" caveat and the Passport degrades gracefully when a field
  is `null` (says "no data" rather than guessing).
- You play with **card templates** (set + grade + item), **not** any wallet's NFT.
  The emotional frame is "dream deck", not ownership.
- Marketplace has **no owner filter**; the *My Collection* mode (`/v0/users/{id}`) and
  slab-scan (`/v1/graded/by-image`) are noted as **stretch**, not built — the hero loop
  came first (anti-scope-creep per `docs/build-plan.md §10`).
- Odds are estimated (see Assumptions), not on-chain-authoritative.
- The **Card Passport AI narration** runs server-side. Without `ANTHROPIC_API_KEY` it
  falls back to a deterministic summary built from the *same validated data* — still
  citing source + time, never asserting fraud, always with a caveat.

## Safety (a scored criterion — designed in, not bolted on)

- **Absolutely read-only.** Only GET endpoints and `createPublicClient()`. The code
  never imports `createSecureClient`, `pullGacha`, `buybackGacha`,
  `approvePermit2Usdt`, `deploySafeWallet`, a signer, or any private key.
- **All keys server-side.** Partner key/secret live in route handlers
  (`lib/renaiss/index.server.ts`, guarded by `server-only`); never `NEXT_PUBLIC_`.
  *Verified*: a production build + bundle scan finds no `rk_`/`rsk_`, no
  `X-Api-Secret`, no `ANTHROPIC_API_KEY`, and none of the transactional SDK symbols
  in `.next/static`.
- **Virtual economy.** Opening a pack is **simulated** — no USDT, no signing, no
  on-chain tx. Credits are virtual, earned by playing, and not redeemable.
- **Fictional stats.** Never presented as valuation or investment advice.
- **Local anonymous save only stores game progress.** `localStorage` contains roster,
  virtual credits, deck tokens, pull history, version, and timestamps. It never stores
  API keys, secrets, auth tokens, or sensitive data.
- **Simple test accounts use server-side storage.** Passwords are scrypt-hashed in
  `data/users.json`, account saves live in `data/account-saves.json`, and the browser
  only receives an HttpOnly signed session cookie.

---

## Run it

Requires **Node ≥ 22** (SDK requires ≥ 24; this repo was built on Node 24).

```bash
npm install
# create .env.local (see env.example.txt) with the partner Index key/secret:
#   RENAISS_INDEX_API_KEY=rk_...
#   RENAISS_INDEX_API_SECRET=rsk_...
#   RENAISS_INDEX_BASE=https://api.renaissos.com
#   RENAISS_MARKETPLACE_BASE=https://api.renaiss.xyz
# optional — enables real LLM Card Passport narration (else deterministic fallback):
#   ANTHROPIC_API_KEY=sk-ant-...
# required for stable login sessions outside local throwaway testing:
#   AUTH_SECRET=replace_with_a_random_32_byte_secret
npm run dev      # http://localhost:3000
```

Test the Index key before wiring (should return JSON, not 401/403):
```bash
curl "https://api.renaissos.com/v1/search?q=charizard" \
  -H "X-Api-Key: rk_your_key" -H "X-Api-Secret: rsk_your_secret"
```

### Verify the key-leak guarantee yourself
```bash
npm run build
grep -rE 'rk_|rsk_|createSecureClient|pullGacha|ANTHROPIC_API_KEY' .next/static   # → no matches
```

### Dev tools (not shipped to the client)
- `npx tsx scripts/balance.mts` — battle balance self-test (fairness / skill / anti-pay-to-win / determinism).
- `npx tsx scripts/sweep.mts` — type-multiplier sweep used to pick 1.36/0.78.
- `node scripts/e2e.mjs` — headless click-through of the whole hero loop (needs `npx playwright-core install chromium`).

---

## Architecture

```
app/api/**          server-side proxies (keys hidden, Zod-validated, cached)
lib/renaiss/*       API fetch helpers (errors-as-values Result, server-only)
lib/game/*          pure engines: rng (seeded/deterministic), stats, gacha, battle, opponent
lib/passport/*      Card Passport system prompt + deterministic fallback
lib/client/*        client fetchers (proxy only) + seed helpers
components/*         shared Slab + HUD + tier legend
features/*          feature-folders: intro, pack-open, roster, deck-builder, battle, result, passport
app/arena/*         state (useReducer, React-only) + orchestrator
```
Patterns follow the SDK: **Zod-validate every response, errors-as-values (no throw),
`list*` for pagination / `fetch*` for single reads.**

---

## Demo video — 6 beats (mapped to judging criteria)

1. **Enter the Vault → open a pack.** Transparent odds table (labeled *estimated from
   the real pool*), pack cracks, cards rise with tier-glow, rarest last. → *Usability + Innovation (gacha-as-draft)*
2. **Roster → deck builder.** Real graded-card renders as glowing "slabs"; drag 5 into
   the deck; team-power meter updates live; reorder for tactics. → *Usability*
3. **Battle — the skill beat.** Each turn you pick ATK/DEF/AURA; the preview shows
   type-adjusted numbers; a lower-tier card with the right element counter topples a
   higher-tier one; the log says *why* each round was won. → *Innovation + Clarity*
4. **Result → credits → open again.** Virtual credits close the loop; the UI states
   that credits are in-game only, not money and not redeemable. → *Clarity + Safety*
5. **Card Passport (the glue).** Click any card: real reference price + confidence
   (Renaiss OS Index, with `asOf`), on-chain provenance (txHashes), custody + country,
   and an AI narration that cites sources and never claims fraud. → *Ecosystem relevance + Clarity + Safety*
6. **"Own it for real."** From the Passport, the real active Renaiss packs (real USDT,
   clearly separated from the game) + a link to the marketplace — the game becomes a
   funnel back into the ecosystem. → *Ecosystem relevance*

Closing line for the safety criterion: *read-only, no private keys, virtual economy,
fictional stats — verified by a client-bundle scan in the build.*
