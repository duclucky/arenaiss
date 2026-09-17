# Deployment

Arena ISS runs as a rootless Docker Compose stack with three services:

- `api`: Node.js API and durable SQLite workers on the internal network;
- `web`: Caddy serving the React build and proxying `/api` plus `/healthz`; and
- `tunnel`: an optional Cloudflare Tunnel with credentials mounted read-only.

The production deployment is the trusted-operator testnet MVP at
[`https://arenaiss.xyz`](https://arenaiss.xyz). It uses Arc Testnet for value
accounting and GenLayer Studio development preview for current judgments.

## Runtime configuration

Copy `.env.example` to a local ignored environment file. Production server
values belong in the ignored `deploy/runtime.env` or an equivalent secret
manager. Keep these values server-side:

- Circle API key, entity secret, and wallet set ID;
- provider API keys;
- GenLayer and Arc signer keys;
- SMTP credentials;
- identity pepper; and
- Cloudflare tunnel credentials.

Never use a `VITE_` variable for a secret. Those values are compiled into the
public browser bundle.

## Start and verify

```sh
docker compose up -d --build --remove-orphans
docker compose ps
curl -fsS http://127.0.0.1:8080/healthz
```

Expected health response:

```json
{"status":"ok"}
```

The stack stores runtime state under the ignored `data/` directory. Create and
verify a transactionally consistent SQLite backup with:

```sh
./deploy/backup-now.sh
./deploy/restore-test.sh arena-runtime-YYYYMMDDTHHMMSSZ.sqlite
```

Backups, databases, logs, runtime environment files, tunnel credentials, wallet
exports, and recovery material must never be committed.

## Cloudflare Tunnel

The checked-in tunnel config contains public routing only. The credential JSON
is ignored and must be provisioned separately with restrictive file
permissions before starting the tunnel service.

```sh
chmod 600 deploy/cloudflared-credentials.json
docker compose up -d tunnel
docker compose logs tunnel
```

## Release checks

Before a release:

1. run `npm run check`;
2. inspect the staged diff and tracked files for credentials or runtime data;
3. build and start the Compose stack;
4. verify that both `api` and `web` report healthy; and
5. verify the public `/healthz` endpoint and affected browser route.
