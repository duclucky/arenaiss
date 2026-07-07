# Simple Credentials Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or equivalent inline execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add simple username/password registration and login for local/demo account saves.

**Architecture:** Keep auth logic in server-only pure modules, expose small App Router API routes, and keep client state using existing reducer/local save patterns. Passwords are hashed with Node `crypto.scrypt`; sessions are signed HttpOnly cookies; account saves are stored in gitignored JSON files for local/demo use.

**Tech Stack:** Next.js App Router, TypeScript, Node `crypto`, JSON file store, existing `tsx` tests.

## Global Constraints

- Product UI/copy remains English.
- Do not store plaintext passwords.
- Do not store API keys, secrets, auth cookies, or password data in localStorage.
- Credentials auth is for local/demo use with no rate limiting, captcha, or email verification.
- Server-side account save uses the same daily credit refill pure function as anonymous save.

---

### Task 1: Auth Core and Store

**Files:**
- Create: `lib/auth/credentials.ts`
- Create: `lib/auth/session.ts`
- Create: `lib/auth/store.ts`
- Create: `tests/auth.test.mts`
- Modify: `package.json`

**Interfaces:**
- Produces: `hashPassword(password)`, `verifyPassword(password, storedHash)`, `signSession(payload, secret, now)`, `verifySession(token, secret, now)`, `createUser(username, password)`, `authenticateUser(username, password)`.

- [x] Write failing tests for password hashing, duplicate users, login success/failure, and tampered/expired sessions.
- [x] Run `npx.cmd tsx tests/auth.test.mts`; expected failure: auth modules missing.
- [x] Implement auth core/store.
- [x] Add auth test to `test:unit`.
- [x] Run `npm.cmd run test:unit`.

### Task 2: API Routes and Save Store

**Files:**
- Create: `app/api/auth/register/route.ts`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `app/api/auth/session/route.ts`
- Create: `app/api/account/save/route.ts`
- Create: `lib/auth/account-save.server.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: auth core/store and `ArenaSave`.
- Produces: JSON API for session and account save sync.

- [x] Implement route handlers with JSON errors-as-values and HttpOnly session cookie.
- [x] Store account saves in `data/account-saves.json`; users in `data/users.json`; ignore `data/`.
- [x] Apply `applyDailyCreditRefill()` on `GET /api/account/save`.
- [x] Run `npm.cmd run typecheck`.

### Task 3: Client UI and Sync

**Files:**
- Create: `lib/client/auth.ts`
- Modify: `components/Hud.tsx`
- Modify: `app/arena/state.tsx`
- Modify: `features/intro/Intro.tsx` if needed for sign-in copy.

**Interfaces:**
- Consumes: auth/session/save APIs.
- Produces: register/login/logout UI and account save sync.

- [x] Add account status to state.
- [x] Add login/register panel in HUD with username/password fields.
- [x] After register, switch to login.
- [x] After login, load account save and merge anonymous progress if account has no newer save.
- [x] Persist account progress to server when logged in; keep anonymous local save intact.
- [x] Run e2e and build.

### Task 4: Handoff and Verification

**Files:**
- Modify: `HANDOFF.md`
- Modify: `README.md` if needed.

**Interfaces:**
- Produces: updated next steps and verification record.

- [x] Run `npm.cmd run test:unit`.
- [x] Run `npm.cmd run typecheck`.
- [x] Run `npm.cmd run build`.
- [x] Run `npm.cmd run e2e`.
- [x] Scan `.next/static` for forbidden key/write strings.
- [x] Update `HANDOFF.md`.
- [ ] Commit with `done: simple credentials auth`.
