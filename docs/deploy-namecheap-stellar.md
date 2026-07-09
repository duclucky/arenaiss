# Deploy Arenaiss on Namecheap Stellar

This project is a server-rendered Next.js app with API routes and server-side JSON
account storage. Do not deploy it as a static site.

## GitHub

- Repository visibility: private.
- Recommended repository name: `arenaiss`.
- Do not commit `.env.local`, `data/`, `.next/`, or `node_modules/`.

## Namecheap Stellar / cPanel Node.js app

Use cPanel's Node.js application feature if it is available on the Stellar plan.

Required runtime:

- Node.js 22+ preferred; Node.js 24 is known to work locally.
- If cPanel only offers an older Node.js version, this Next.js 16 app may not run
  correctly. In that case, use another Node host or upgrade the hosting runtime.

Suggested cPanel app settings:

- Application mode: `Production`
- Application root: a folder outside `public_html`, for example `arenaiss`
- Application URL: `arena-card.xyz`
- Application startup file: `server.js`
- Environment:
  - `NODE_ENV=production`
  - `AUTH_SECRET=<random 32-byte secret>`
  - `RENAISS_INDEX_API_KEY=<server-side key>`
  - `RENAISS_INDEX_API_SECRET=<server-side secret>`
  - `RENAISS_MARKETPLACE_BASE=https://api.renaiss.xyz`
  - `RENAISS_INDEX_BASE=https://api.renaissos.com`
  - `PASSPORT_AI_BASE_URL=https://v98store.com/v1`
  - `PASSPORT_AI_MODEL=deepseek-v4-flash`
  - `PASSPORT_AI_API_KEY=<optional server-side provider key>`

Install/build commands in the app directory:

```bash
npm ci
npm run build
```

Then restart the Node.js app from cPanel.

## Private GitHub repo deployment

For private repos, cPanel needs GitHub access:

1. Create or use an SSH key in cPanel.
2. Add the public key to the GitHub private repo as a deploy key.
3. Clone/pull the repo into the app root.
4. Run `npm ci` and `npm run build`.
5. Restart the Node.js app.

If cPanel Git cannot pull private repos cleanly and Terminal is unavailable, use
the GitHub Actions FTP deploy workflow added in `.github/workflows/deploy.yml`.

Create these GitHub repository secrets:

- `FTP_SERVER` — cPanel FTP server, for example `ftp.fundline.xyz`
- `FTP_USERNAME` — FTP account created in cPanel
- `FTP_PASSWORD` — FTP password
- `FTP_SERVER_DIR` — remote app directory, for example `/arenaiss/`
- `SITE_URL` — optional live verification URL; defaults to `https://arena-card.xyz`

The workflow currently uses repository secrets only:

```text
FTP host: FTP_SERVER
FTP user: FTP_USERNAME
FTP dir:  FTP_SERVER_DIR
Live URL: SITE_URL, or https://arena-card.xyz as a fallback
```

The workflow builds `next.config.ts` with `output: "standalone"` and uploads a
CloudLinux-compatible payload. The cPanel app root stays clean: it contains only a
small `server.js` wrapper, a minimal `package.json`, and the real standalone app in
the `app/` subfolder. The standalone runtime dependencies stay inside `app/node_modules`;
do not create or upload a root `node_modules` folder. The workflow also updates
`tmp/restart.txt` so Passenger/CloudLinux reloads the app after FTP upload.

Deployment flow:

```text
git push -> main/master
  -> GitHub Actions on ubuntu-latest
  -> npm ci
  -> node --check startup wrapper
  -> lint, typecheck, unit tests
  -> next build
  -> prepare standalone payload
  -> node --check deploy/server.js and deploy/app/server.js
  -> write tmp/restart.txt
  -> FTP-Deploy-Action uploads to cPanel
```

## Manual upload without Terminal

If FTP automation is not working and cPanel has no Terminal, upload a prebuilt
standalone ZIP instead.

Build the ZIP locally from the project root:

```powershell
npm.cmd run build
Remove-Item -Recurse -Force deploy -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force deploy\app, deploy\tmp | Out-Null
Copy-Item hosting\namecheap-server.js deploy\server.js
@'
{"name":"arenaiss-namecheap","private":true,"scripts":{"start":"node server.js"}}
'@ | Set-Content deploy\package.json -Encoding ascii
Copy-Item -Recurse .next\standalone\* deploy\app\
Remove-Item -Recurse -Force deploy\app\data -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force deploy\app\.next -ErrorAction SilentlyContinue | Out-Null
Copy-Item -Recurse .next\static deploy\app\.next\static
if (Test-Path public) { Copy-Item -Recurse public deploy\app\public }
(Get-Date).ToUniversalTime().ToString("s") + "Z" | Set-Content deploy\tmp\restart.txt -Encoding ascii
Compress-Archive -Path deploy\* -DestinationPath arenaiss-namecheap-standalone.zip -Force
```

Upload `arenaiss-namecheap-standalone.zip` into the cPanel application root
folder, extract it there, and confirm these files exist directly in the app root:

```text
package.json
server.js
app/
tmp/restart.txt
```

Then set the cPanel Node.js app startup file to `server.js`, add the environment
variables listed above, and restart the app. Do not click `Run NPM Install` for
the standalone ZIP path unless you intentionally switch back to repo-source
deployment; the runtime modules are already inside `app/node_modules`.

## Domain and DNS

For `arena-card.xyz` bought on Namecheap and hosted on Namecheap Stellar, either:

1. Use Namecheap hosting nameservers for the domain, then add `arena-card.xyz` as the
   primary/addon domain in cPanel.
2. Or keep existing DNS and point records to the hosting server IP from cPanel:
   - `A` record: `@` -> the hosting shared IP
   - `CNAME` record: `www` -> `arena-card.xyz`

The exact IP is shown in cPanel / hosting account details.

After DNS resolves, enable SSL in cPanel:

1. Open `SSL/TLS Status`.
2. Run AutoSSL for `arena-card.xyz` and `www.arena-card.xyz`.
3. Force HTTPS if cPanel provides that option.

## Persistence warning

The current demo stores test accounts and account saves in:

- `data/users.json`
- `data/account-saves.json`

This is acceptable on hosting with persistent disk, but it is not a production
database. Back up `data/` regularly. Before a public launch, replace it with a DB
or KV store.
