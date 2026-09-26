# Astro frontend

The main app lives in `frontend/`: coastal map at `/hmi`, fish market at `/market`,
and relief dashboard at `/relief`. `/` opens the map. Storybook is a separate
component catalogue; there is no `/workshop` route in the app.

## Run

From the repository root (Bun 1.3.14, Node 24):

```sh
bun install --frozen-lockfile
cp frontend/.env.example frontend/.env
bun run frontend:dev                 # http://localhost:4321/hmi
bun run frontend:check
bun run --cwd frontend test
bun run frontend:build
bun run --cwd frontend smoke:built
HOST=127.0.0.1 PORT=4328 node --env-file=frontend/.env frontend/dist/server/entry.mjs
bun run storybook                    # http://localhost:6008
```

Configure `PIPELINE_API_URL` for plot and satellite data, `SEPOLIA_RPC_URL` for
fund and transaction reads, and `LEGACY_WEB_ORIGIN` for the quote signer and
remaining legacy pages. Optional wallet and forecast settings are documented
in [`.env.example`](.env.example). The production Node process needs its
environment supplied by the host or `--env-file`.

`GET /health` checks this frontend process. It does not establish database,
pipeline or RPC availability. Container deployment is documented in
[DEPLOY.md](DEPLOY.md).

## Connected screens

| Route | Behavior |
| --- | --- |
| `/hmi` | Miyagi farm polygons, satellite imagery, sea temperature, temperature anomaly, chlorophyll, polygon analysis, species/season selection and forecast playback |
| `/market` | Scallop, hoya and oyster first; search/filter; compact purchase review; JPYC wallet checkout and verified sale contributions |
| `/relief` | Fund balances, plot/season outcome, event evidence, held-payment claim, donations and market contributions |
| `/preview` | Synthetic journeys for market, donor, farmer, holder and co-op components |

The map and market provide English/Japanese controls. Temperature observations
and forecasts remain separate from relief eligibility: the shared rules and
contracts determine payment, not the map's selected layer or forecast slider.

Marketplace quotes allocate **5% to the relief fund and 95% to the seller**.
The Solid checkout validates the signed quote and signer, checks wallet funds
and allowance, and verifies matching purchase/contribution receipts before
showing success. A submitted transaction can be checked again after a reload.
Closing purchase review does not cancel an already submitted transaction.

`/api/market/quote` forwards validated requests to the existing quote signer in
`web/`; the signing key stays there. Deploy that service with the same shared
catalogue revision as Astro, including hoya and oyster. Payments use Sepolia
test funds. Generated seafood illustrations are not photographs of sale lots;
[asset provenance](public/images/fish/README.md) is recorded separately.

## Route migration inventory

These page routes still redirect to `LEGACY_WEB_ORIGIN`, preserving path and
query: `/map`, `/donate`, `/verify/[eventId]`, `/liff`, `/coop`, and `/holder`.
Missing configuration returns 503; unknown paths return 404. A same-origin
redirect is rejected. The catch-all does not proxy API routes.

## Server and pipeline integration

Secrets remain server-side through `astro:env/server`. Plot geometry and
metadata reach Astro through the pipeline API. The configured PostGIS
inventory is authoritative; database-free pipeline development can use its
reviewed seed. Database failures do not silently activate demo geometry.

Heat responses are checked for plot/season identity, finite Celsius values,
dates, observation ordering and source metadata. Missing observations stay
missing. Unavailable fund or transaction reads are not displayed as zero or
as confirmed payments. Forecasts are advisory.

## Island boundaries

- Astro owns routes, layouts and server composition.
- `src/components/react/` owns wallet providers and marketplace filters/dialog controls.
- `src/components/solid/` owns checkout and donation interactions.
- `src/lib/hmi-map.client.ts` owns Leaflet layers and map interactions.
- `packages/shared/` owns chain interfaces, catalogue, relief split and API validation.

## Storybook

Stories use production components, arranged as Atoms → Molecules → Organisms
→ Pages. Astro props are pre-rendered; use named stories for different static
states. Hydrated controls have interaction assertions. `bun run storybook`
builds once and serves the result; rebuild after edits. CI uses
`bun run storybook:build`.

Viewport presets cover 320px and 390px phones, iPhone 17 (402×874), iPad portrait
and landscape, and desktop (1440×900). Marketplace stories check later-card
purchase review, dialog bounds, stable card width, focus return, filtering and
Japanese checkout. Map stories cover layer panels, forecast playback and the
single chlorophyll legend.

Preview fixtures and example receipts are synthetic. They do not establish
live inventory, transfers or relief eligibility. Storybook needs no database,
wallet, pipeline or messaging credentials.
