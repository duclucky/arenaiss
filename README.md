# Arenaiss

Arenaiss is a game-only simulation built for Renaiss Tech Hackathon S1.
It turns Renaiss-style pack discovery into a playable draft-and-battle loop:
open simulated packs, build a lineup from real graded-card metadata, battle with
fictional game stats, and inspect each card through a real-data Card Passport.

Live demo: [https://arena-card.xyz](https://arena-card.xyz)

This is not an official website or product of `renaiss.xyz`. Cards opened in
Arenaiss are fictional in-app game items. They do not represent ownership,
claim, redemption rights, investment value, or real-world assets.

## Why It Exists

Renaiss is built around collectible discovery, custody, pricing references, and
Card Passport data. Arenaiss makes those concepts understandable through play.

Instead of explaining the platform with a static page, the project lets a user:

1. Choose a simulated pack.
2. Reveal a card using Renaiss marketplace-derived pool data.
3. Build a 5-card lineup.
4. Battle for virtual credits.
5. Open the Card Passport to see real reference data and provenance.
6. Follow clear links back to real Renaiss pages when they want to inspect the
   actual marketplace context.

The result is both a demo game and an onboarding funnel for the Renaiss
ecosystem.

## Official Product Direction

The hackathon version is intentionally a safe simulation: users log in with a
demo account, open simulated packs, and battle with fictional in-app cards.

The production direction is different. Arenaiss is designed to evolve into a
wallet-native arena where users sign in with a real wallet and use the real
graded-card assets held in that wallet to enter battles. In that version, the
lineup would be built from verified wallet inventory, the Card Passport would
act as the source of truth for each playable card, and the arena would become a
new utility layer for real Renaiss collectibles rather than only a simulated
onboarding game.

This README describes the current hackathon implementation first, then frames
that implementation as a prototype for the wallet-based official version.

## Core Loop

```text
Gacha -> Roster -> Lineup -> Arena Battle -> Result -> Card Passport -> Gacha
```

### 1. Gacha

Users select one of the simulated pack types and inspect its estimated odds
before opening.

- Welcome Pack: free once for new accounts, opens 5 cards.
- OMEGA Pack: Pokemon pool, opens 1 card, costs 300 virtual credits.
- RenaCrypt Pack: mixed Pokemon and One Piece pool, opens 1 card, costs 500
  virtual credits.
- Eden Pack: One Piece pool, opens 1 card, costs 800 virtual credits.

Pack opening is login-gated so progress can be saved on the server. The pack
reveal is purely simulated: no wallet, no signing, no USDT, and no on-chain
transaction.

### 2. Roster

The roster shows the user's fictional in-game cards. Cards are based on real
graded-card metadata from the Renaiss marketplace pool, but the user does not
own the real cards.

Roster filters let users quickly view:

- All cards
- Pokemon only
- One Piece only
- Tier: Top, S, A, B, C, D

Each card can open its Card Passport for more context.

### 3. Lineup

The user builds a 5-card lineup before entering the arena.

Lineup mode supports separate arenas:

- Pokemon arena: only Pokemon cards are shown.
- One Piece arena: only One Piece cards are shown.

The same fast filters are available here so users can assemble a lineup without
scrolling through unrelated cards.

### 4. Arena Battle

Arena battles use fictional game stats derived from real card metadata.

Each round compares one action:

- ATK
- DEF
- AURA

The visible score is adjusted by the type matchup. Green means boosted, red
means reduced, and white means unchanged. If both sides would win with multiple
actions, the best margin matters because it affects initiative for later rounds.

The battle log explains what happened each round, while the rules panel explains
the scoring model and virtual stake.

### 5. Virtual Economy

New accounts start with 10,000 virtual credits.

Arena matches use a virtual stake:

- Both players put up 100 credits.
- The winner receives 199 credits.
- The loser does not receive the stake back.

Credits are in-game only. They are not money, cannot be withdrawn, and have no
cash value.

### 6. Card Passport

Every card links to a Card Passport view that connects the game card back to real
Renaiss reference data.

The Passport can show:

- Real graded-card identity and image.
- Custody context.
- On-chain provenance events when available.
- Reference price data from Renaiss OS Index.
- Confidence, observation count, and recent movement when available.
- AI-assisted collector insight, generated server-side and cached to avoid
  wasting quota.
- A direct link to check the exact card or relevant Renaiss marketplace context.

The Passport always treats data as experimental reference data, not verified
market truth and not financial advice.

## Standout Features

### Gacha as Draft

The pack-opening mechanic is not just decoration. It is the drafting system.
Users build their lineup from what they reveal, turning Renaiss-style discovery
into the start of the game loop.

### Real Data, Fictional Gameplay

Arenaiss uses real marketplace/card metadata as the source material, but turns it
into fictional game stats. This keeps the experience grounded in the Renaiss
ecosystem while avoiding claims of ownership or valuation.

### Skill-Based Battle Layer

The battle system is designed so card rarity is not the only thing that matters.
Type matchup, action choice, and initiative give players meaningful decisions
during combat.

### Server-Synced Demo Accounts

Users can register with a simple username and password. Progress is saved on the
server so they can log in from another device and continue with the same roster,
credits, and lineup.

### Safe Renaiss Integration

The app is read-only. It does not use private keys, wallet signing, secure
clients, purchase flows, or write endpoints. All external data access is routed
through server-side API routes.

## Data Sources

Arenaiss uses these data sources for simulation and reference display:

| Source | Used For | Access Pattern |
| --- | --- | --- |
| `api.renaiss.xyz` | Marketplace pool, card metadata, packs, Card Passport context | Server-side read-only proxy |
| `@renaiss-protocol/client` | Public Renaiss client reads where needed | Public client only |
| `api.renaissos.com` | Reference pricing, confidence, observations, movement | Server-side only with API credentials |

All API keys and provider credentials must stay server-side. Do not expose them
with `NEXT_PUBLIC_`.

## Safety Rules

Arenaiss is intentionally constrained:

- No wallet connection.
- No private key.
- No on-chain transaction.
- No real-money pack opening.
- No real ownership claim for opened cards.
- No financial or investment advice.
- No API secrets in the client bundle.
- No AI provider key in the client bundle.

The UI repeatedly labels the experience as a simulation and separates virtual
credits from real Renaiss marketplace activity.

## How to Use the Demo

1. Register a demo account.
2. Open the Welcome Pack to receive 5 starter cards.
3. Open additional simulated packs if you have enough virtual credits.
4. Go to Roster to inspect your cards and use filters.
5. Go to Lineup and choose Pokemon or One Piece.
6. Select 5 cards for the arena.
7. Start a battle and choose ATK, DEF, or AURA each round.
8. Review the battle log and result.
9. Open a Card Passport to inspect the real-data context behind a card.

## Local Setup

Requirements:

- Node.js 20+ for CI compatibility.
- Node.js 22+ recommended for local development with the current Next.js stack.

Install dependencies:

```bash
npm install
```

Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Required for stable server-side sessions:

```bash
AUTH_SECRET=replace_with_a_random_32_byte_secret
```

Generate a local secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Optional Renaiss OS Index credentials:

```bash
RENAISS_INDEX_API_KEY=rk_your_key_here
RENAISS_INDEX_API_SECRET=rsk_your_secret_here
```

Optional OpenAI-compatible Passport AI provider:

```bash
PASSPORT_AI_BASE_URL=https://.........../v1
PASSPORT_AI_MODEL=.............
PASSPORT_AI_API_KEY=your_provider_key_here
```

Run locally:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Scripts

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript check
npm run build      # Production build
npm run test:unit  # Unit tests
npm run e2e        # End-to-end smoke flow
```

## Project Structure

```text
app/api/             Server-side API routes and proxies
app/arena/           Main app state and orchestration
components/          Shared UI components
features/            Gacha, roster, lineup, battle, result, passport
lib/auth/            Demo account auth and server-side account saves
lib/client/          Browser-side API clients
lib/game/            Pure game engines: gacha, stats, battle, RNG
lib/passport/        Passport AI prompt, validation, fallback narration
lib/renaiss/         Server-side Renaiss data access and schemas
scripts/             Local verification and demo scripts
tests/               Unit tests for core behavior
```

## Judging Summary

- Ecosystem relevance: turns Renaiss pack discovery, Card Passport data, and
  marketplace context into a playable onboarding flow.
- Innovation: uses simulated gacha as the draft mechanic, not just a reward
  animation.
- Usability: clear filters, account sync, lineup builder, explainable battle log,
  and direct Passport inspection.
- Safety: read-only architecture, virtual economy, fictional stats, and
  server-side secrets only.
- Product direction: the same loop can graduate from simulated cards to
  wallet-verified real Renaiss cards in the official arena.
- Technical execution: Next.js App Router, TypeScript, Zod validation, pure game
  engines, server-side proxies, and automated CI/CD deployment.
