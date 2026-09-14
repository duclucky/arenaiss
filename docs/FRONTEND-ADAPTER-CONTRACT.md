# Frontend Adapter Contract

The Arena frontend is fully decoupled from protocol dependencies via typed TypeScript interfaces located in `frontend/src/adapters/interfaces.ts`. It acts solely as an independent viewer of semantic verdicts and state; it must never invent verdicts.

## Typed Adapter Interfaces

The core interfaces are:
- `ArenaReadAdapter` — provides read-only listing and lookup of Tournaments and Matches.
- `ArenaWriteAdapter` — exposes authorized write operations (e.g. `registerAgent`, `enterTournament`).
- `GenLayerReadAdapter` — retrieves semantic `MatchVerdict` responses directly from the GenLayer verifiable outcome history.
- `ArcWalletAdapter` — abstracts EIP-6963 compatible browser injected provider discovery (`getProviders`), connection (`connect`), chain lifecycle (`switchChain`), balances (`getBalance`), and escrow logic (`submitEscrow`). Methods must return `Promise<string>` for USDC base-unit amounts and take an `ArcNetworkConfig` containing valid optional token addresses.

## Runtime Network Configuration

The network configuration is managed at runtime via `loadRuntimeConfig(env)` in `frontend/src/context.tsx`. It strictly requires:
- `VITE_ARC_CHAIN_ID` (must be ASCII digits)
- `VITE_ARC_RPC_URL` (must be absolute HTTP/HTTPS)
- `VITE_ARC_NETWORK_NAME`

Optional token and escrow fields:
- `VITE_ARC_USDC_ADDRESS`
- `VITE_ARC_ESCROW_ADDRESS`

The frontend displays a `NOT_CONFIGURED` state and disables live writes if any mandatory field is missing or invalid. Fallbacks are absent.

## Lifecycle States and Preview Honesty Rules

- Transactions report statuses mapped to the `LifecycleState` enum: `PENDING`, `SUBMITTED`, `ACCEPTED`, `FINALIZED`, `FAILED`, `RETRYABLE`, `UNKNOWN`, or `NOT_CONFIGURED`.
- Preview data is explicitly non-canonical. The UI consistently displays "Preview data — not canonical" and headers like "Preview Verdict". Never call preview reasons or links canonical.
- GenLayer Explorer links are sourced from the adapter-supplied `MatchVerdict` via the optional `explorerUrl` property, never from the Arc network configuration. It is rendered only if it is a validated non-empty absolute URL.
- Browser discovery checks injected environments without automatically selecting a default or fabricating success data. Balance queries use `eth_call` only when a valid token address is configured; otherwise, they explicitly throw typed errors rather than fabricating `'0'`.
