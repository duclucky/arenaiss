# Official tooling references

## Purpose and boundary

This project keeps shallow checkouts of selected upstream repositories in the ignored local directory `.tools/`. They let coding agents read current official instructions, inspect APIs, and compare boilerplate without copying vendor repositories into public project history.

The checkouts are references, not application dependencies. Released packages must be added explicitly to a reviewed manifest only after the candidate passes its idea gates and implementation is authorized.

## Captured upstream revisions

| Local checkout | Official upstream | Captured revision | License | Intended use |
| --- | --- | --- | --- | --- |
| `.tools/circle-skills` | [circlefin/skills](https://github.com/circlefin/skills) | `26dc09ea0746a038c969c6f197feee1267f834b5` | Apache-2.0 | Arc, USDC, wallet, and Circle CLI operating guidance |
| `.tools/genlayer-skills` | [genlayerlabs/skills](https://github.com/genlayerlabs/skills) | `195deb417c2ac4a90dd23429a0c3940bde80389a` | MIT | Intelligent Contract authoring, lint, tests, and CLI guidance |
| `.tools/genlayer-js` | [genlayerlabs/genlayer-js](https://github.com/genlayerlabs/genlayer-js) | `1b7f50a3a3f2963ea857941b0fb386081dd5c326` | MIT | SDK source/API and released-package version reference |
| `.tools/genlayer-project-boilerplate` | [genlayerlabs/genlayer-project-boilerplate](https://github.com/genlayerlabs/genlayer-project-boilerplate) | `e685f1f12c4c357787d48390692a654baf576f03` | MIT | Selective project scaffold reference |
| `.tools/genlayer-studio-bridge-boilerplate` | [genlayer-foundation/genlayer-studio-bridge-boilerplate](https://github.com/genlayer-foundation/genlayer-studio-bridge-boilerplate) | `85fe384c78957bb668271eb8d87f06ae153619bc` | MIT | Authenticated/idempotent transport design reference; not payout authority |
| `.tools/private-ai-gateway` | [Dstack-TEE/private-ai-gateway](https://github.com/Dstack-TEE/private-ai-gateway) | `19daf2b7152eeaf1f8be3fd66d261b8c1ce8eac5` | Apache-2.0 | ACI `aci/1` specification, verifier behavior, and official byte-exact receipt vectors |

Each checkout was created with a shallow, blob-filtered clone. A captured revision is reproducibility metadata, not a claim that the revision is secure, current forever, or compatible with this product. ACI `aci/1` is a draft/developer-preview protocol; the checkout is not production attestation evidence.

## Selected local tools

The workstation already provides these command-line tools, so no binary or package-manager cache is copied into the repository:

| Tool | Observed version | Use policy |
| --- | --- | --- |
| Circle CLI | `1.0.0` | Read the Circle CLI skill and scoped `--help`; writes require explicit authorization |
| GenLayer CLI | stable `0.39.2`; Studio Dev `0.40.0-rc.3` via exact `npx` version | Read the GenLayer CLI skill; use the coherent network release family and never expose validator-private output |
| GenLayer JS | project dependency `2.0.0-rc.1` | Exact v0.6-compatible RC providing the `studioDevnet` chain definition for Studio `v0.123.0-rc.6` |
| Node.js | `24.11.1` | Tooling runtime; application version must be locked when implementation begins |
| npm | `11.18.0` | Dependency installation only after authorization and manifest review |
| uv | `0.11.23` | Python environment management when GenLayer implementation begins |

The default system Python observed during discovery was `3.13.14`. GenLayer work must instead use the project Python 3.12 environment required by the parent workspace rules.

## Deliberate exclusions

- Circle App Kit is not installed for the initial design. Direct Arc USDC escrow does not currently require bridge, swap, or unified-balance UI features, and App Kit does not authenticate a GenLayer verdict for Arc settlement.
- No dependency tree, `node_modules`, `.venv`, wallet, credentials, or `.env` was copied from another local project.
- No contract, frontend, deployment, or network transaction was created as part of tooling discovery.
- Boilerplate sample applications are not copied. Any later extraction must be minimal, attributed, version-reviewed, and stripped of unrelated sample behavior.

## Refresh procedure

Before refreshing, confirm the checkout is clean and inspect upstream changes. Fetching a new revision must be intentional; never let an automated agent silently move the tool baseline.

```powershell
git -C .tools/circle-skills status --short
git -C .tools/circle-skills fetch --depth 1 origin master
git -C .tools/circle-skills merge --ff-only origin/master

git -C .tools/genlayer-skills status --short
git -C .tools/genlayer-skills fetch --depth 1 origin main
git -C .tools/genlayer-skills merge --ff-only origin/main
```

Apply the same clean-check, fetch, and fast-forward pattern to the three GenLayer source references. After any refresh:

1. record the new `git rev-parse HEAD` value in this file;
2. re-read every changed applicable `SKILL.md`;
3. re-check license and package compatibility;
4. verify `.tools/` remains ignored; and
5. do not infer authorization to install, deploy, fund, transact, or publish.
