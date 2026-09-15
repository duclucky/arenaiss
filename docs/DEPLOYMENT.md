# VPS deployment runbook

## Current boundary

The deployed service is the trusted-operator MVP web/API projection on the
owner-managed Ubuntu host. It exposes canonical public tournament/match/verdict
records and the browser wallet registration/withdrawal client. The current
deployment does **not** run the bounded live-lifecycle script as a daemon and
does not claim an unattended production scheduler until the durable worker
input/job model is implemented.

The public Evaluations page verifies the two active judge deployments
directly against the canonical Studio Next RPC (`https://studio-next.genlayer.com/api`,
chain `61997`). Its build-time public settings include both active judge addresses and
the Studio Next explorer. These values are public chain identifiers, not secrets.
The active bindings are `AgentEvaluationJudge` at
`0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d` and
`ArenaComparisonJudge` at `0xe5210eCCC4182090A1416f515Dc7001B27274BcB`.
`ArenaMatchJudge` is archived and absent from the active image configuration;
historical verdicts retain their original address and explorer links.

The stable LAN endpoint is `http://192.168.1.24:8080`. The named Cloudflare
Tunnel exposes the stable HTTPS hostnames `arenaiss.xyz` and
`www.arenaiss.xyz` without depending on the host's public IP address.

## Layout and process model

- Service account: dedicated unprivileged user `arenaiss`
- Project: `/home/arenaiss/projects/async-agent-arena`
- Runtime DB: `data/arena-runtime.sqlite`
- Verified backups: `backups/arena-runtime-*.sqlite`
- API: Node 24, internal port 8787, no host port
- Web: Caddy, host port 8080, SPA fallback and same-origin `/api` proxy
- Containers: rootless Docker under `arenaiss`, `restart: unless-stopped`
- Tunnel: named Cloudflare Tunnel `arenaiss-vps`; credential file is ignored,
  read-only in the container, and must be mode 0600 on the host
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

Provision the tunnel credential once at
`deploy/cloudflared-credentials.json`, set mode 0600, then start the stack:

```sh
chmod 600 deploy/cloudflared-credentials.json
docker compose up -d
docker compose logs tunnel
```

## Remaining host work

- Disable host suspend/lid sleep with an administrator-authorized system policy.
  A user-level inhibitor was tested and rejected by host policy, then disabled.
- Prefer wired Ethernet or otherwise provide redundant connectivity/power.
- Add firewall/fail2ban policy through an administrator account if the host is
  exposed directly instead of only through Cloudflare Tunnel.
- Complete the real browser-wallet transaction lane in a browser that exposes
  an EIP-6963/injected wallet. The Codex in-app browser exposes no provider.
