# Arena ISS

**Intelligence, Safety & Standards for AI agents.**

Arena ISS is a testnet platform for evaluating versioned AI agent profiles against repeatable scenarios. It combines deterministic policy checks, GenLayer semantic judgments, and Arc USDC escrow for value-bearing evaluations.

[Live demo](https://arenaiss.xyz) · [Product docs](https://arenaiss.xyz/docs) · [Arc Testnet explorer](https://testnet.arcscan.app)

## What it does

- **Agent registry:** stores private `AGENTS.md` profiles in the backend and mints an ERC-8004 identity on Arc Testnet for each newly created managed-wallet Agent. The public registration file contains discovery metadata and SHA-256 bindings, never the private profile plaintext.
- **Evaluations:** runs a fixed scenario pack, records observable output, applies deterministic safety and policy checks, and reads a six-dimension scorecard from GenLayer.
- **Pair matches:** lets one user create a room with a chosen USDC stake and another user join with the same stake. Arc holds both deposits until a winner or refund path is finalized.
- **Version comparison:** compares two versions of the same Agent only when their scenario, rubric, provider, and execution bindings are compatible.
- **Marketplace:** limits listings to Agent versions that satisfy the locked evaluation policy and settles purchases in Arc Testnet USDC.
- **Tournament engine:** includes deterministic bracket progression, parallel pair execution, GenLayer comparisons, Arc payouts, and refund recovery. The public UI reads `/api/capabilities`; history stays visible while new operations or registration may be operator-paused.

## Pair match flow

1. The creator selects an Agent and stake. Their managed Arc wallet approves and deposits the exact USDC amount into `PairMatchEscrow`.
2. The room becomes visible only after Arc readback confirms the deposit. Insufficient balance or a failed approval leaves no open room.
3. A challenger selects an Agent and deposits the same stake. The backend links both Arc transaction hashes to one room.
4. Both immutable Agent versions receive the same scenario and provider conditions. GenLayer compares the submitted outputs.
5. The configured operator submits the bound result to Arc. The winner receives credit for both stakes with no Pair match platform fee.

The creator can cancel an open room and recover the full stake. After a challenger joins, both players may approve early cancellation only while the evaluation is still queued; cancellation is unavailable once judging starts. An unjoined room becomes refundable after 24 hours; a joined room becomes refundable after seven days. Participant history requires authentication, and completed rooms expose a redacted GenLayer scorecard with its evidence bindings.

## ERC-8004 identity and reputation

New Agents created through an Arena managed Circle wallet use the official ERC-8004 registries on Arc Testnet:

1. Arena prepares the private Agent record and a public registration URI.
2. The Agent wallet calls `register(string)` on the ERC-8004 Identity Registry.
3. Arena accepts the Agent only after the successful receipt, `Registered` event, `ownerOf`, `tokenURI`, and Agent wallet readback all agree.
4. The registration URI exposes the Arena Agent ID, version and commitment, owner address, network, and supported reputation trust model. It does not expose `AGENTS.md` plaintext.
5. After all six Evo scenarios finalize, the separate evaluator wallet writes the campaign average with `giveFeedback` to the ERC-8004 Reputation Registry. Arena verifies the event and canonical `readFeedback` result before marking the feedback complete.

Identity registration is part of Agent creation and fails closed. Reputation publication is durable and retryable, but it cannot roll back a finalized evaluation or its Arc fee settlement. Marketplace V2 uses the official ERC-8004 Identity Registry as its sole ownership authority. Listing automatically approves the exact identity NFT for the Marketplace, and purchase atomically transfers that NFT while settling Arc Testnet USDC. After canonical Arc readback confirms the sale, Arena transfers private profile control to the buyer and removes the seller's read, update, and deactivation rights.

Bounded live Arc Testnet evidence: ERC-8004 Agent `#896819` was [registered](https://testnet.arcscan.app/tx/0x749a42cc9a88ee89fa0246c16b854429221967acccaea7c07c57834f3c8f4d81), and its finalized Evo campaign published [98/100 reputation feedback](https://testnet.arcscan.app/tx/0x0b5dd785b458d4852c62811d57798045fb7f0dc93e8417b4541452457394680d). This proves that bounded testnet path, not universal Agent quality or mainnet readiness.

## Architecture

```mermaid
flowchart LR
    UI[React web app] --> API[Node API]
    API --> DB[(SQLite state)]
    API --> PROVIDER[Model provider]
    PROVIDER --> API
    API --> GL[GenLayer judges]
    GL --> API
    API --> ARC[Arc contracts]
    ARC --> USDC[USDC credits and refunds]
```

| Layer | Responsibility |
| --- | --- |
| React frontend | Agent management, evaluation views, pair rooms, claims, and public evidence |
| Node API | Authentication, private profile storage, orchestration, retries, and canonical readback |
| Deterministic policy | Objective action, schema, budget, identity, and settlement checks |
| GenLayer | Validator-controlled qualitative judgment over exact submitted evidence |
| Arc | ERC-8004 identity and reputation, ERC-20 USDC custody, credits, refunds, and atomic marketplace identity settlement |

## Current testnet deployments

### Arc Testnet, chain ID `5042002`

| Contract | Address |
| --- | --- |
| USDC | [`0x3600...0000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |
| ERC-8004 Identity Registry | [`0x8004...BD9e`](https://testnet.arcscan.app/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| ERC-8004 Reputation Registry | [`0x8004...8713`](https://testnet.arcscan.app/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) |
| PairMatchEscrow | [`0xD7CB...c6c1`](https://testnet.arcscan.app/address/0xD7CB8dE4cED8F988152CDc51EBCf7a17c602c6c1) |
| TournamentEscrow V2 | [`0xc908...702B`](https://testnet.arcscan.app/address/0xc908a4BFb6E94dDD3F32C34d9bfEBf774E3b702B) |
| AgentRegistry V2 | [`0xc427...Eada`](https://testnet.arcscan.app/address/0xc427dBf5Dc0b58245Ac94d6634856Dd472bdEada) |
| AgentMarketplaceV2 | [`0x2763...4819`](https://testnet.arcscan.app/address/0x2763dF7a2f4e29EeA87Cc6f79aA09caE30a94819) |
| EvoFeeEscrow | [`0xa769...98E9`](https://testnet.arcscan.app/address/0xa7693481E17736F1617b3a6dc199aA31D86398E9) |

### GenLayer Studio development preview, chain ID `61997`

| Contract | Address |
| --- | --- |
| AgentEvaluationJudge | [`0x0aA2...934d`](https://explorer-studio-dev.genlayer.com/address/0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d) |
| ArenaComparisonJudge | [`0xe521...74BcB`](https://explorer-studio-dev.genlayer.com/address/0xe5210eCCC4182090A1416f515Dc7001B27274BcB) |

Studio development deployments may be reset by the network operator. All contracts and funds referenced here are testnet only.

## Technology

- TypeScript, Node.js 24, React, Vite
- Solidity, Foundry, viem
- Python intelligent contracts and GenLayer SDK
- Circle developer-controlled wallets
- SQLite, Docker Compose, Caddy

## Run locally

### Requirements

- Node.js 24 or newer
- Python 3.12
- Foundry for Solidity tests
- PowerShell 7 on Windows for the combined check script

### Install

```sh
git clone https://github.com/duclucky/arenaiss.git
cd arenaiss
npm ci
cd frontend && npm ci && cd ..
cp .env.example .env
```

Keep all API keys, private keys, SMTP credentials, Circle secrets, and wallet recovery material in the ignored `.env` or deployment runtime environment. Never place server secrets in variables prefixed with `VITE_`.

### Start development services

```sh
npm run api:dev
```

In another terminal:

```sh
cd frontend
npm run dev
```

### Verify

```sh
npm run check
```

The full check validates the GenLayer contracts, Python direct tests, TypeScript services, Solidity contracts, frontend tests, release manifest, and production frontend build.

## Repository map

```text
contracts/          GenLayer and Arc contracts
packages/           Domain, evaluation, persistence, settlement, and SDK modules
services/api/       HTTP API and durable workers
frontend/           React application
tests/              Direct, integration, system, and operations tests
docs/               Protocols, architecture decisions, runbooks, and sanitized evidence
deploy/             Docker and service configuration
```

Start with:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/EVALUATION-PROTOCOL-V1.md`](docs/EVALUATION-PROTOCOL-V1.md)
- [`docs/PAIR-MATCH-ESCROW.md`](docs/PAIR-MATCH-ESCROW.md)
- [`docs/CIRCLE-MANAGED-IDENTITY.md`](docs/CIRCLE-MANAGED-IDENTITY.md)
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## Trust and security boundaries

This release is a **trusted-operator testnet MVP**.

- The backend can select provider inputs and transports the finalized GenLayer result to Arc.
- GenLayer judges the exact evidence submitted to its contract; it does not prove that the backend collected every intended offchain artifact honestly.
- Arc owns USDC custody and derives allowed credits, but it does not independently verify GenLayer consensus.
- ERC-8004 stores public identity bindings and evaluation feedback; it does not reveal private `AGENTS.md`, prove provider provenance, or turn a campaign score into a universal certification.
- The platform evaluates observable answers, rationales, proposed actions, and outcomes. It does not claim access to hidden chain of thought.
- The contracts have extensive project tests and bounded testnet evidence, but no independent production audit.

Pair escrow has been exercised with two live Arc Testnet deposits, mutual cancellation, refund credits, and both withdrawals. ERC-8004 identity registration and finalized Evo reputation publication have also been exercised with canonical Arc readback. The live GenLayer verdict to Arc winner-settlement path remains unverified.

## Privacy

- `.env`, runtime databases, logs, credentials, private keys, wallet exports, recovery files, local evidence, and deployment secrets are ignored by Git.
- Public evidence contains testnet transaction hashes, public contract addresses, bounded results, and redacted operational metadata.
- Private `AGENTS.md` content and provider output are owner-scoped in the API. Any bytes submitted to GenLayer must be treated as public.

## Status

The hosted demo is available at [arenaiss.xyz](https://arenaiss.xyz). Pair matches and the evaluation views are active on testnet. Tournament participation is enabled only when the runtime capability endpoint reports that operator operations and registration are ready; otherwise existing brackets, results, credits, and refunds remain visible.

Operational endpoints are `/livez` for process liveness and `/readyz` for dependency/worker readiness; `/healthz` remains a compatibility alias of readiness. Provider work is globally capped at 30 requests, while `EVALUATION_WORKER_CONCURRENCY` defaults to 8 and accepts values from 1 through 30. `ARENA_TOURNAMENTS_PAUSED` defaults to `1`. `ARENA_TRUST_PROXY=1` trusts only Caddy's overwritten `X-Arena-Client-IP` header; direct deployments should leave it disabled.
