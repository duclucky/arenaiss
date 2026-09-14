# Circle-managed identity and wallet boundary

Status: locally implemented, disabled until server-only Circle and SMTP
configuration is supplied. No production Circle wallet has been created by this
change.

## Decision

Arena ISS authenticates a person with either:

- a signed challenge from an external EVM wallet; or
- a six-digit email code sent by the Arena server.

The authentication credential is an identity proof only. It is not the wallet
that Arena uses as the user's managed account. After successful authentication,
the server creates or resumes exactly one Circle developer-controlled EOA on
`ARC-TESTNET` and associates it with a pseudonymous Arena user ID.

This intentionally selects Circle developer-controlled wallets. Circle's
user-controlled email/social authentication is not used because that product
requires the end user to retain transaction approval, while the requested Arena
model makes the server the wallet custodian.

## Persisted data

- Wallet login: normalized external address, Arena user ID and principal.
- Email login: HMAC-SHA-256 identity key, Arena user ID and principal. The raw
  email address is not persisted.
- Circle wallet: user ID, wallet ID, public address, `EOA`, `ARC-TESTNET`, state,
  update time and the UUID v4 idempotency key.

The OTP digest is held only in memory, expires after ten minutes, permits at
most five attempts and is deleted after successful use. A restart invalidates
outstanding OTPs and HTTP sessions.

## Provisioning guarantees

The server persists a UUID v4 before calling Circle. Concurrent attempts in one
server process share a promise. A failed call or server restart retries with the
same persisted idempotency key, so it does not intentionally create a second
paid/custodial wallet operation. Circle response data is accepted only when it
contains exactly one wallet with a wallet ID and valid EVM address.

## API

- `GET /api/auth/capabilities`: advertise whether email and managed-wallet
  authentication are enabled by a complete server configuration.
- `POST /api/auth/challenge` and `POST /api/auth/verify`: wallet sign-in.
- `POST /api/auth/email/challenge`: send email code.
- `POST /api/auth/email/verify`: verify email code.
- `POST /api/auth/logout`: invalidate the server session.
- `GET /api/account`: return safe identity kind and managed wallet metadata.

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
provides wallet/email sign-in controls in the web UI. It does not yet authorize
Circle contract execution, fund the wallet, or migrate the existing
browser-signed Tournament registration/claim path. The UI blocks those actions
for managed accounts and never falls back to the sign-in wallet. Those are
separate value-bearing operations and require policy, explicit confirmation,
transaction status reconciliation and action-time authorization before a live
call. Until that migration is implemented, do not claim that managed users can
enter or claim a Tournament.
