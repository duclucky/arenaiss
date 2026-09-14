# VPS deployment runbook

## Current boundary

The deployed service is the trusted-operator MVP web/API projection on the
owner-managed Ubuntu host. It exposes canonical public tournament/match/verdict
records and the browser wallet registration/withdrawal client. The current
deployment does **not** run the bounded live-lifecycle script as a daemon and
does not claim an unattended production scheduler until the durable worker
input/job model is implemented.

The stable LAN endpoint is `http://192.168.1.24:8080`. The optional
`public-tunnel` Compose profile creates an ephemeral HTTPS TryCloudflare URL for
browser smoke tests only. It has no uptime or hostname guarantee and is not the
release URL.

## Layout and process model

- Project: `/home/ducky/projects/async-agent-arena`
- Runtime DB: `data/arena-runtime.sqlite`
- Verified backups: `backups/arena-runtime-*.sqlite`
- API: Node 24, internal port 8787, no host port
- Web: Caddy, host port 8080, SPA fallback and same-origin `/api` proxy
- Containers: rootless Docker under `ducky`, `restart: unless-stopped`
- Logs: Docker JSON logs, 10 MB × 5 for API/web and 10 MB × 3 for tunnel
- Daily backup: user timer at 02:15 UTC with a randomized delay

`deploy/runtime.env` is ignored, mode 0600 on the host, and must contain only
server-side values. Private provider/wallet values must never be Vite variables
or Docker build arguments. Current API/web deployment does not need the model
API key or an operator private key.

## Operations

From the project directory, point Docker CLI to the rootless socket:

```sh
export DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8080/healthz
```

Create and verify a consistent SQLite backup:

```sh
./deploy/backup-now.sh
./deploy/restore-test.sh arena-runtime-YYYYMMDDTHHMMSSZ.sqlite
```

Start the temporary HTTPS smoke-test tunnel:

```sh
docker compose --profile public-tunnel up -d tunnel
docker compose logs tunnel
```

## Remaining host work

- Assign the final domain and Cloudflare tunnel/DNS credentials, then replace
  the ephemeral tunnel with a named authenticated tunnel and stable HTTPS URL.
- Disable host suspend/lid sleep with an administrator-authorized system policy.
  A user-level inhibitor was tested and rejected by host policy, then disabled.
- Prefer wired Ethernet or otherwise provide redundant connectivity/power.
- Add firewall/fail2ban policy through an administrator account if the host is
  exposed directly instead of only through Cloudflare Tunnel.
- Complete the real browser-wallet transaction lane in a browser that exposes
  an EIP-6963/injected wallet. The Codex in-app browser exposes no provider.

