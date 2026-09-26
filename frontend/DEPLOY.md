# Deploying the Astro web app

The web app is its own container (`frontend/docker-compose.yml`, project `reeldeal-web`) on the same EC2 instance as the pipeline and the database, deployed independently of both.

```
Caddy (pipeline/) :443 ─┬─ <SITE_ADDRESS>      → api:8787  (pipeline project)
                        └─ app.<SITE_ADDRESS>  → web:4321  (this project, via the reeldeal network)
web ──> db:5432 (reeldeal network, role `app`)   web ──> LEGACY_WEB_ORIGIN (redirects for unported pages)
```

Live: `https://app.13-196-78-137.sslip.io`. Pages not yet ported to Astro redirect to `LEGACY_WEB_ORIGIN`, the Next.js app on Railway, until #63/#66–#68 land.

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build from the repo root: Bun installs the frontend's deps from `bun.lock`, Astro builds, and the runtime is `node:24-slim` with production deps only, running as `node`. Healthcheck on `/health`. |
| `Dockerfile.dockerignore` | Keeps the root build context to the manifests, lockfile and `frontend/`. |
| `docker-compose.yml` | The `web` service on the external `reeldeal` network, no published ports, `.env` for runtime secrets. |
| `deploy/up.sh` | Builds and starts the container, then checks that `/health` reports `GIT_SHA`. |
| `../pipeline/caddy/Caddyfile` | The `app.{$SITE_ADDRESS}` site. |
| `../.github/workflows/deploy-web.yml` | PRs: build the image and smoke-test routes. `main`: deploy over SSM. |

## Server `.env` (`frontend/.env`, mode 600, never committed)

```sh
LEGACY_WEB_ORIGIN=https://web-production-746aa.up.railway.app
PIPELINE_API_URL=https://13-196-78-137.sslip.io
DATABASE_URL=postgres://app:<APP_PASSWORD from db/.env>@db:5432/reeldeal
# Relief fund + marketplace checkout (frontend/src/lib/chain, /relief, /market/checkout-demo). See below.
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
QUOTE_SIGNER_PRIVATE_KEY=<same key as the repo root .env's COOP_SIGNER_PRIVATE_KEY, unless a distinct
  quote signer was configured on SaleRouter via QUOTE_SIGNER at deploy time -- see docs/SALE-ROUTER.md>
```

All are `astro:env/server` secrets, read at runtime; changing them needs only `frontend/deploy/up.sh`, not a rebuild. `PUBLIC_CHAIN_ID` is a build-time public value and defaults to Sepolia. `SEPOLIA_RPC_URL` has a public default baked into `astro.config.mjs` (a public RPC endpoint, not a secret) and only needs setting to use a private/rate-limited RPC. `QUOTE_SIGNER_PRIVATE_KEY` has no default -- unset, `POST /api/market/quote` responds `503` instead of signing with an absent key. Never print or commit this key.

## Deploy

Automatic on merge to `main` for changes under `frontend/`, the root manifests or `bun.lock` (`deploy-web.yml`, same OIDC + SSM path as the pipeline, queued in the shared `deploy-ec2` group). By hand on the instance:

```sh
cd ~/reeldeal && git pull --ff-only && frontend/deploy/up.sh
```

A Caddyfile change is deployed by the pipeline workflow, which reloads Caddy.

## Local

```sh
docker network create reeldeal 2>/dev/null; cp frontend/.env.example frontend/.env
frontend/deploy/up.sh    # then e.g. docker compose -f pipeline/docker-compose.yml up -d caddy for https://app.localhost
```
