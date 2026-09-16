# Circle-managed identity and wallet boundary

Status: the SCA account flow is published on the owner VPS. Restart-safe CCTP
operation recovery is implemented and tested locally in the current change, but
has not yet been published or exercised through a live Circle/Arc Testnet write.

## Decision

Arena ISS authenticates a person with either:

- a signed challenge from an external EVM wallet; or
- a six-digit email code sent by the Arena server.

The authentication credential is an identity proof only. It is not the wallet
that Arena uses as the user's managed account. After successful authentication,
the server creates or resumes exactly one active Circle developer-controlled SCA on
`ARC-TESTNET` and associates it with a pseudonymous Arena user ID.

SCA is an ERC-4337 smart-contract account controlled by Arena's developer
credentials. Circle Gas Station automatically sponsors its transaction gas on
supported testnets when the account's default network policy is active and
within its limits. This is not an MSCA/passkey wallet and it does not eliminate
the requirement for source-chain USDC and the CCTP transfer/forwarding fee.

This intentionally selects Circle developer-controlled wallets. Circle's
user-controlled email/social authentication is not used because that product
requires the end user to retain transaction approval, while the requested Arena
model makes the server the wallet custodian.

## Persisted data

- Wallet login: normalized external address, Arena user ID and principal.
- Email login: HMAC-SHA-256 identity key, Arena user ID and principal. The raw
  email address is not persisted.
- Active Circle wallet: user ID, wallet ID, public address, `SCA`, `ARC-TESTNET`, state,
  update time and the UUID v4 idempotency key.
- Legacy EOA metadata, if present, is retained under a separate local record.
  The new SCA receives a fresh creation idempotency key and address; no testnet
  funds are moved and the legacy EOA is not used for new account actions.
- CCTP transfer operation: owner user ID, managed wallet/address, source chain,
  six-decimal USDC amount, lifecycle state and separate UUID v4 keys for approval
  and burn. Neither key is returned by the public API.

The OTP digest is held only in memory, expires after ten minutes, permits at
most five attempts and is deleted after successful use. A restart invalidates
outstanding OTPs and HTTP sessions.

## Provisioning guarantees

The server persists a UUID v4 before calling Circle. Concurrent attempts in one
server process share a promise. A failed call or server restart retries with the
same persisted idempotency key, so it does not intentionally create a second
paid/custodial wallet operation. Circle response data is accepted only when it
contains exactly one wallet with a wallet ID and valid EVM address.
Existing authenticated sessions trigger SCA provisioning on `GET /api/account`;
new logins do so during sign-in. Until the SCA is ready, legacy EOA writes fail
closed. Legacy on-chain Agent ownership is still tied to the old EOA address;
this migration does not transfer or deactivate those Agents.

## CCTP recovery guarantees

The server persists separate approval and burn idempotency keys before either
Circle mutation. On startup it resumes `PENDING`, `APPROVING` and `BURNING`
operations with those same keys. Concurrent recovery within one server process
shares one active call, and callback replay cannot move the stored lifecycle
backward. A legacy `BURNING` record without a persisted burn key becomes
`RECOVERY_REQUIRED`; the server never guesses a new key or risks a duplicate burn.
An uncertain upstream failure also becomes `RECOVERY_REQUIRED` with a safe
public message. It does not invite another transfer until the source transaction
has been reconciled. `SUBMITTED` means the source burn has a transaction hash;
it does not prove that the destination mint on Arc has completed.

## API

- `GET /api/auth/capabilities`: advertise whether email and managed-wallet
  authentication are enabled by a complete server configuration.
- `POST /api/auth/challenge` and `POST /api/auth/verify`: wallet sign-in.
- `POST /api/auth/email/challenge`: send email code.
- `POST /api/auth/email/verify`: verify email code.
- `POST /api/auth/logout`: invalidate the server session.
- `GET /api/account`: return safe identity kind and managed wallet metadata.
- `GET /api/account/usdc-balances`: return available Circle-issued USDC balances.
- `POST /api/account/usdc-transfers`: submit an Arc Testnet USDC withdrawal.
- `POST /api/account/cctp-transfers`: persist and start a CCTP transfer to Arc.
- `GET /api/account/cctp-transfers`: return up to 20 recent operations belonging
  to the authenticated owner, newest first, without replay keys.
- `GET /api/account/cctp-transfers/:operationId`: return the authenticated
  owner's redacted CCTP lifecycle state.

All sessions use an opaque `HttpOnly; Secure; SameSite=Strict` cookie. API
responses never include the Circle API key, entity secret, operation key, SMTP
password or raw email address.

## Server-only configuration

All fields below are required together. The server fails closed for a partial
configuration:

```text
CIRCLE_API_KEY
CIRCLE_ENTITY_SECRET
CIRCLE_WALLET_SET_ID
ARC_AGENT_REGISTRY_ADDRESS
ARENA_IDENTITY_PEPPER
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
SMTP_FROM
```

`ARENA_IDENTITY_PEPPER` must be at least 32 bytes. The Circle entity secret is a
32-byte value created and registered by the operator. Its recovery file must be
stored outside this repository. Generated recovery files, keys and `.env` files
are ignored by Git.

## Current limitation

This slice provisions the managed wallet, makes it the account address, and
provides wallet/email sign-in controls in the web UI. Agent registration and
deactivation are implemented as Circle contract-execution calls to the
configured Arc `AgentRegistry`; both require an Arc transaction hash before the
backend changes active Agent state. Production testnet configuration uses the
exact-match verified Arc registry at
`0x4c0b1787Ae48bE1A34E7dE7e767BA25016609E25`; deployment and zero-state
readback evidence is recorded under `docs/evidence/arc-testnet/`. No user Agent
registration or deactivation transaction is implied by deployment evidence.

Tournament registration/claim migration remains separate. The UI blocks those
value-bearing actions for managed accounts and never falls back to the sign-in
wallet. Do not claim that managed users can enter or claim a Tournament until
that migration has live evidence.
