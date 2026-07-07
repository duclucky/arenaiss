# English UI + Anonymous Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or equivalent inline execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Renaiss Arena product UI to English and add anonymous local progress save with the daily credit refill rule.

**Architecture:** Keep game rules in pure `lib/game/*` modules and wire persistence through the existing reducer/provider. UI changes stay in the existing components and feature folders without introducing a new design system.

**Tech Stack:** Next.js App Router, React reducer state, TypeScript, `tsx` Node tests, existing CSS.

## Global Constraints

- Product UI/copy/README/video demo must be English.
- API access remains read-only; do not add secure clients, signers, wallet writes, or on-chain actions.
- `localStorage` may store only game progress; never store API keys, secrets, auth tokens, or sensitive data.
- Credits are virtual game credits and never money or redeemable value.
- Game stats are fictional and must not read like asset valuation or investment advice.

---

### Task 1: Pure Credit and Save Modules

**Files:**
- Create: `lib/game/credit.ts`
- Create: `lib/game/save.ts`
- Create: `tests/credit-save.test.mts`
- Modify: `package.json`

**Interfaces:**
- Produces: `applyDailyCreditRefill(input)`, `serializeSave(stateLike, now)`, `parseSavedArena(raw)`, `STORAGE_KEY`, `SAVE_VERSION`.

- [ ] Write failing tests in `tests/credit-save.test.mts` for midnight refill and save parsing.
- [ ] Run `npx.cmd tsx tests/credit-save.test.mts`; expect module-not-found failure.
- [ ] Implement `lib/game/credit.ts` and `lib/game/save.ts`.
- [ ] Add `"test:unit": "tsx tests/credit-save.test.mts"` to `package.json`.
- [ ] Run `npm.cmd run test:unit`; expect pass.

### Task 2: Reducer Persistence Wiring

**Files:**
- Modify: `app/arena/state.tsx`
- Modify: `components/Hud.tsx`

**Interfaces:**
- Consumes: `applyDailyCreditRefill`, `parseSavedArena`, `serializeSave`, `STORAGE_KEY`.
- Produces: hydrated anonymous state, reset action that clears storage, local-save status in UI.

- [ ] Add reducer actions for hydrated save and first Passport hint dismissal.
- [ ] Hydrate from `localStorage` in `ArenaProvider` on mount and apply daily refill.
- [ ] Persist stable progress after hydration and relevant state changes.
- [ ] Add reset progress button and local-save copy to `Hud`.
- [ ] Run `npm.cmd run typecheck`; fix type errors.

### Task 3: English UI Copy and Slab CTA

**Files:**
- Modify: `components/Slab.tsx`
- Modify: `components/TierLegend.tsx`
- Modify: `features/intro/Intro.tsx`
- Modify: `features/pack-open/PackOpen.tsx`
- Modify: `features/roster/Roster.tsx`
- Modify: `features/deck-builder/DeckBuilder.tsx`
- Modify: `features/battle/Battle.tsx`
- Modify: `features/result/Result.tsx`
- Modify: `features/passport/PassportDrawer.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: English product UI, card hover overlay, persistent info icon, one-time Passport hint.

- [ ] Replace Vietnamese product-facing copy with English safety-compliant copy.
- [ ] Add `.slab-info` and `.slab-passport-overlay` CSS.
- [ ] Render "View Passport ->" overlay and info mark in `Slab`.
- [ ] Add one-time pack hint with `DISMISS_PASSPORT_HINT`.
- [ ] Run `rg -n "[À-ỹ]|MÔ PHỎNG|HƯ CẤU|Bộ sưu tập|Mở gói|Vào trận" app components features lib/game scripts README.md` and inspect intentional internal comments separately.

### Task 4: E2E and Docs Handoff

**Files:**
- Modify: `scripts/e2e.mjs`
- Modify: `README.md`
- Modify: `HANDOFF.md`

**Interfaces:**
- Produces: English e2e selectors and updated handoff.

- [ ] Update Playwright selectors to English UI text.
- [ ] Update README safety/persistence statements to match localStorage support.
- [ ] Run `npm.cmd run typecheck`.
- [ ] Run `npm.cmd run build`.
- [ ] Run `npm.cmd run test:unit`.
- [ ] Scan `.next/static` for forbidden secret/write strings.
- [ ] Update `HANDOFF.md` with completed work, next Google login step, verification evidence, and warnings.
- [ ] Commit with a clear message.
