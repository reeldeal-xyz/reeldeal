# Astro frontend and component workshop

This is the #56/#58 foundation. The existing `web/` app still owns the live donor,
co-op, holder, map, verification and LIFF flows. Do not switch production traffic
until each route has passed its migration acceptance.

## Run

From the repository root (Bun 1.3.14, Node 24):

```sh
bun install --frozen-lockfile
cp frontend/.env.example frontend/.env
bun run frontend:dev                 # http://localhost:4321/workshop
bun run frontend:check
bun run --cwd frontend test
bun run frontend:build
bun run --cwd frontend smoke:built
HOST=127.0.0.1 PORT=4328 LEGACY_WEB_ORIGIN=http://localhost:3000 bun run frontend:start
bun run storybook                    # http://localhost:6008
```

`storybook` builds once and serves the result locally. Rebuild after edits. Use
`bun run storybook:build` in CI. The static workshop needs no database, wallet,
pipeline, or messaging credentials. The production Node server needs its env
provided by the host; it does not automatically read `frontend/.env` at startup.

`GET /health` reports the frontend process only, not database or pipeline health.

## Island boundaries

- Astro owns layouts, routes and server composition.
- `src/components/react/` owns React islands. Keep wagmi/QueryClient/World
  providers in the same hydrated React tree as their consumers. MapLibre and
  LINE initialization belongs in client effects.
- `src/components/solid/` owns the reusable marketplace interaction. Its local
  TypeScript config selects Solid JSX; integration include paths keep JSX
  transforms separate. Both frameworks have interactive workshop stories.
- `BidPanel` accepts `BidServices`. The workshop supplies an in-memory adapter;
  it cannot access `window.ethereum`, send network requests, or call LINE. The
  demo JPY offer is carried over from `superposition/reeldeal`, not the JPYC
  purchase/relief settlement implementation tracked by #66. That adapter must
  distinguish definitive rejection from an ambiguous submission before launch.

## Route migration inventory

| URL | Current owner | Astro handoff |
| --- | --- | --- |
| `/map` | `web/` replay and map | #68 |
| `/donate` | `web/` donor flow | #67 |
| `/verify/[eventId]` | `web/` event verification | #68 |
| `/liff` | `web/` farmer flow, #31 | #67 |
| `/coop` | `web/` co-op tools | #67 |
| `/holder` | `web/` holder tools | #67 |

Until a replacement route exists, the catch-all redirects these page URLs to
`LEGACY_WEB_ORIGIN`, preserving path and query. Unknown paths are 404, missing
configuration is 503, and a same-origin destination is rejected to avoid a loop.
API routes are not proxied. New Astro page files take precedence over the
catch-all. `/` currently opens `/workshop`; it is an explicit fixture surface.

## Server and pipeline integration

`astro:env/server` keeps `DATABASE_URL`, `PIPELINE_API_URL` and
`LEGACY_WEB_ORIGIN` off the client. Only `PUBLIC_CHAIN_ID` is public. Configure
secrets at runtime; do not pass them as island props or add a `PUBLIC_` prefix.

Future Astro API handlers import the reviewed `packages/app-core` boundary
(#63), which owns application actions. PostgreSQL access stays server-side;
Jay owns `risk` migrations, and the application owns `app`. Pipeline reads use
Jay's FastAPI/OpenAPI handoff (#79) through the agreed shared adapter. This PR
does not create schema migrations or change Trigger fields. New temperature
fixtures must use `tempC`; existing shared domain reconciliation belongs to #55/#59.

## Storybook

Stories use production components, organized as Atoms → Molecules → Organisms
→ Pages. Astro props are pre-rendered: Controls do not change static props.
Add a named story for each state, then rebuild. Hydrated islands remain
interactive, and bid/wallet stories include `play` assertions.

The framework's native React/Solid CSF preview entries are disabled because all
stories use Astro wrappers. Astro supplies both hydration renderers. This also
avoids the obsolete `storybook-solidjs-vite/renderer/entry-preview` import.

Static placeholder images live under `public/images`; both Astro and Storybook
serve the same visible image. No CSS hides `<picture>` or substitutes a background.
Viewport presets are 320×720, 390×844 and 1440×900. Full-page stories own their
gutters; isolated components receive one 16px inset. Lot Detail uses the same
isolated canvas as the other organism stories, without an extra page frame.

Fixtures are synthetic: preview lots and lot-detail shapes originate from
`superposition/reeldeal` at `c3546e7`; wallet addresses, amounts, decisions and
receipts are examples. They are not observations, confirmed transfers or relief
eligibility decisions. #61's reviewed domain records depend on #59.

### Visual changes

The existing accent colors, outlines, shadows, typography and phone frame are
preserved. Only white surfaces use warmer paper (`#f2eddf`) and ivory
(`#faf6ec`). Spacing uses existing tokens: 12px card padding, 16px grid gaps,
24px between detail groups, and one card column below 360px. Cards and action
rows can grow or wrap rather than clipping text.

### Known upstream build diagnostic

The pinned Astro 7/Storybook adapter can log `Failed to create the dev server
app: transport was disconnected` when its temporary Vite SSR server closes.
The Astro app build is clean; the static Storybook build completes. The log
comes from Astro's dev-server bootstrap, which the adapter starts while
pre-rendering. Do not hide unrelated errors: verify rendered story files,
hydration, images and play assertions as well as the exit code.

## Relief molecule previews (#61)

Farm, species, equipment, contribution, measurement, provenance and transaction
components reuse the existing atoms in 35 synthetic Storybook states. Resource
cards include Japanese/English labels and loading, empty, missing and unavailable
examples. Unmapped farms remain visible with their mapping gap explained.

Temperature props use `tempC`; missing readings display text rather than zero.
Zero Celsius remains a valid observation. Invalid values fall back to missing
or unavailable, and unknown statuses cannot produce an empty badge. Forecasts
are advisory, while Pending, Paid and Held explain the represented outcome.

These are presentation props and local samples, not the #59 domain/API contract.
Shared fixture adapters and validation of incoming domain data remain
outstanding until the reviewed #59 records are available.
The previews make no wallet, pipeline, database or LINE calls.
