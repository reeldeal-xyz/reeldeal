<p align="center"><img src="docs/assets/reeldeal-logo.svg" alt="Reel Deal" width="128"></p>

# Reel Deal

**Community-funded relief payments for aquaculture farmers.**

Reel Deal is parametric relief for Japan's aquaculture farmers. Donors and marketplace sales fund a
pool. When a public ocean-risk index crosses a species threshold, the pool pays JPYC on Sepolia. The
risk index is built from JAXA satellite sea-surface temperature and Miyagi Prefecture shellfish-toxin
bulletins. The money goes to whoever holds the affected plot's ENSv2 season slot. Payouts are capped
per real person with World ID and explained to farmers over LINE.

Built at ETHGlobal Tokyo 2026 (Classic track). The submission write-up is
**[docs/SUBMISSION.md](docs/SUBMISSION.md)**. It has a sponsor-by-sponsor integration table with code
references and proof transactions, the demo script, the team, and an honest list of what's real today
and what's still in progress.

## Deployed

| What | URL | Hosting |
|---|---|---|
| Map, marketplace, relief dashboard (Astro `frontend/`) | <https://app.13-196-78-137.sslip.io> (`/hmi`, `/market`, `/relief`) | AWS EC2 (Tokyo), Caddy |
| Co-op, holder, donor and farmer web app (Next.js `web/`) | <https://web-production-746aa.up.railway.app> (`/coop`, `/holder`, `/donate`, `/app`, `/verify/[eventId]`) | Railway |
| Farmer app in LINE (LIFF) | <https://liff.line.me/2011749457-SgvM5ahH> (opens `web/` `/liff`) | Railway, inside LINE |
| Pipeline risk API (FastAPI) | <https://13-196-78-137.sslip.io> (`/health`, `/plots`, `/heat/*`, `/hab/*`) | AWS EC2, with PostGIS |

### Contracts (Sepolia, chain id 11155111)

Source of truth: [`packages/shared/src/addresses.ts`](packages/shared/src/addresses.ts).

| Contract | Address | Role |
|---|---|---|
| ReliefPool (v2) | [`0xB25888A81B6F2D337c2f0CBFB863324F258c43e5`](https://sepolia.etherscan.io/address/0xB25888A81B6F2D337c2f0CBFB863324F258c43e5) | Holds donations, verifies 2-of-3 signed Triggers, pays or holds per plot |
| HumanRegistry | [`0xc713c174b33B071f7Bf6dC571E3dd7BfB441D4F8`](https://sepolia.etherscan.io/address/0xc713c174b33B071f7Bf6dC571E3dd7BfB441D4F8) | Wallet ↔ World ID nullifier binding and level |
| SaleRouter | [`0xfc178e7fA7b3119e2E233FeDF5e2E317D95658bd`](https://sepolia.etherscan.io/address/0xfc178e7fA7b3119e2E233FeDF5e2E317D95658bd) | Atomic marketplace checkout: pays the seller and donates the relief share |
| EnsPlotResolver | [`0x5Fd09356151DfF3DFca06B1270e5DDAF11DaF89b`](https://sepolia.etherscan.io/address/0x5Fd09356151DfF3DFca06B1270e5DDAF11DaF89b) | Reads a plot's `zone` / `species` text records from ENSv2 |
| EnsSlotResolver | [`0xbf91d74c0010ba727bD3B251B3fc5700835c80Ec`](https://sepolia.etherscan.io/address/0xbf91d74c0010ba727bD3B251B3fc5700835c80Ec) | Reads who holds a plot's season slot, and until when |
| JPYC | [`0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29`](https://sepolia.etherscan.io/address/0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29) | Payment token (18 decimals) |

The first attest, settle and LINE push ran on an earlier ReliefPool v2 at
[`0x560E…96D32`](https://sepolia.etherscan.io/address/0x560E8404be74DCB7F3877835F374CF1B1B696D32),
which the pool above has since replaced. ENSv2 on Sepolia is redeployed about monthly. Its registry
addresses are also in `addresses.ts`.

---

## How it works

Every flow below is drawn from the code on `main`. Each diagram is followed by the files that
implement it.

### 1. System overview

```mermaid
flowchart LR
  subgraph People
    donor["Donor"]
    buyer["Market buyer"]
    farmer["Farmer, in LINE"]
    holder["Licence holder"]
    coop["Co-op operator"]
  end

  subgraph Railway["web/ Next.js on Railway"]
    liff["/liff and /app farmer app"]
    coopui["/coop event console"]
    holderui["/holder slot issuing"]
    donateui["/donate"]
    verifyui["/verify/eventId"]
    api["API routes: keeper, world, market quote, LINE and MultiBaas webhooks"]
  end

  subgraph EC2["AWS EC2"]
    astro["frontend/ Astro: /hmi map, /market storefront, /relief"]
    pipeline["pipeline/ FastAPI risk API"]
    pg[("Postgres + PostGIS: geo, risk, app schemas")]
  end

  subgraph Sepolia
    pool["ReliefPool"]
    hr["HumanRegistry"]
    router["SaleRouter"]
    ensr["EnsPlotResolver and EnsSlotResolver"]
    jpyc["JPYC"]
    ens["ENSv2: umi.eth, karakuwa.umi.eth, p1213-001 to 015, slot 2026"]
  end

  subgraph External
    jaxa["JAXA SGLI and AMSR2 SST"]
    miyagi["Miyagi toxin-ban bulletins"]
    world["World ID"]
    mb["Curvegrid MultiBaas"]
    line["LINE Messaging API"]
    jev["TypeSafe Jev via OpenRouter"]
  end

  signers["Trigger signers: pipeline, co-op, science"]

  farmer --> liff
  holder --> holderui
  coop --> coopui
  donor --> donateui
  donor --> astro
  buyer --> astro
  jaxa --> pipeline
  miyagi --> pipeline
  pipeline --> pg
  astro --> pipeline
  astro -- "quote proxy" --> api
  api --> pg
  api --> signers
  signers --> pool
  api -- "attest gate" --> jev
  liff --> world
  api -- "bind or upgrade" --> hr
  holderui --> ens
  pool --> ensr
  ensr --> ens
  pool --> hr
  pool --> jpyc
  router --> pool
  router --> jpyc
  pool -- "events" --> mb
  mb -- "HMAC webhook" --> api
  api --> line
  line --> farmer
```

- **Two web apps.** `web/` (Next.js, Railway) is the operational app: the LINE farmer app, co-op
  console, holder screen, donor screen, public verifier, and every server route that holds a key.
  `frontend/` (Astro, EC2) is the public face: the `/hmi` risk map, the `/market` storefront and the
  `/relief` dashboard. It reads the chain and the pipeline directly. It forwards quote signing to
  `web/` through `LEGACY_WEB_ORIGIN` (`frontend/src/pages/api/market/quote.ts`).
- **Pipeline.** `pipeline/` (Python, uv, FastAPI) pins raw data by sha256 and serves per-plot risk
  indices. It shares the Postgres + PostGIS service in `db/`, where the pipeline owns the `geo` and
  `risk` schemas and `web/` owns `app` (`web/src/db/schema.ts`).
- **Contracts.** `contracts/src/ReliefPool.sol`, `HumanRegistry.sol` and `SaleRouter.sol`, plus the
  ENSv2 adapters in `contracts/src/adapters/`. Their Solidity structs are mirrored in `packages/shared`
  (`trigger.ts`, `quote.ts`, `addresses.ts`).
- **Money only moves on deterministic checks.** Jev can delay an attest by asking for co-op review,
  but it never calls `attest` or `settle` itself (`web/src/lib/jev-gate.ts`, `docs/JEV.md`).

### 2. Farmer onboarding

```mermaid
sequenceDiagram
  autonumber
  actor F as Farmer
  participant L as LINE LIFF /liff
  participant W as web API
  participant DB as Postgres app schema
  actor H as Licence holder
  participant R as Plot registry p1213-NNN
  participant WID as World ID
  participant HR as HumanRegistry

  F->>L: Open LIFF link in LINE
  L->>L: Create on-device wallet if none
  L->>W: POST /api/liff/session with LINE ID token and wallet
  W->>W: Verify ID token with LINE
  W->>DB: Pin first wallet to this LINE user
  W-->>L: Session cookie and pinned wallet
  F->>L: Request this season's slot for a plot
  L->>W: POST /api/liff/slot-request
  H->>W: /holder lists pending requests
  H->>R: register "2026" to farmer, roles 0, expires 2027-03-31
  Note over R: Found with getSubregistry on karakuwa.umi.eth
  H->>W: PATCH /api/holder/requests/id marks it issued
  F->>WID: Verify with World ID, see flow 3
  WID-->>W: Proof
  W->>HR: bind or upgrade the pinned wallet
```

- **LINE login.** `web/src/app/api/liff/session/route.ts` checks the LIFF ID token against LINE
  (`web/src/lib/line-auth.ts`) and sets a signed session cookie (`web/src/lib/session.ts`).
- **One wallet per LINE user.** The browser makes a Sepolia wallet on first open
  (`web/src/lib/wallet.ts`, a demo custody model). The server pins the first wallet a LINE user presents
  and returns it on every later session (`pinWalletForLineUser` in `web/src/lib/payout-directory.ts`,
  stored in `app.wallet_links`). That way a second browser can't split the verified wallet from the
  plot owner.
- **Season slot.** The ENS name is `umi.eth` → `karakuwa.umi.eth` → `p1213-001` … `p1213-015`
  (8 scallop, 4 hoya, 3 oyster, zone `karakuwa-east`) → season label `2026`. The licence holder issues
  the slot from `/holder` with their own wallet. `issueSeasonSlot` in `web/src/lib/ens-adapter.ts`
  finds the plot's own registry with `getSubregistry(plotLabel)`, then calls
  `register("2026", farmer, …, roleBitmap 0, expiry)`. A role bitmap of 0 makes the slot
  non-transferable. The expiry is 31 March 2027 (`web/src/components/holder/holder-screen.tsx`).
- **Plot facts.** A plot's `zone` and `species` are ENSv2 text records. `EnsPlotResolver` reads them.
  `ReliefPool.enroll(plotLabel)` caches them on chain.

### 3. World ID verification

```mermaid
sequenceDiagram
  autonumber
  actor F as Farmer
  participant C as WorldVerify component
  participant W as web API
  participant WA as World App or Simulator
  participant DEV as developer.world.org
  participant HR as HumanRegistry

  F->>C: Tap Verify, level 1 or level 2
  C->>W: POST /api/world/request
  W-->>C: RP-signed request context, 5 minute TTL
  C->>WA: IDKit request, signal is the wallet
  WA-->>C: Proof
  C->>W: POST /api/world/verify with level, wallet, result
  W->>DEV: POST /api/v4/verify/rp_id
  Note right of W: Staging adds x-staging-verification-token
  DEV-->>W: Verified
  W->>W: Check action, environment, signal hash, schema
  W->>HR: bind for a new human, upgrade for a bound one
  HR-->>W: Bound or Upgraded event
  W->>W: Link wallet to the LINE user server-side
  W-->>C: level, schemaId, txHash
  C->>HR: Re-read levelOf every 3 s
```

- **Levels.** Level 1 is Selfie Check (schema 11, action `bind-payout-wallet`). Level 2 is World ID
  **Orb** only (schema 1, `proof_of_human`) (`web/src/lib/world/schema.ts`). My Number Card and
  passport are **not integrated**. The deployed HumanRegistry would still map schemas 9303 and 9310 to
  level 2, but the app never requests them and the server rejects them.
- **Caps.** ReliefPool pays at most `unitCap[1] = 3` plots per event to a level-1 human and
  `unitCap[2] = 12` to a level-2 human. The cap is counted per nullifier, not per wallet.
- **Server-side proof check.** `web/src/lib/world/signing.ts` signs the request context with
  `WORLD_RP_SIGNING_KEY`. `web/src/lib/world/verify-client.ts` calls the v4 verify endpoint.
  `web/src/lib/world/credential.ts` picks the matching credential. `web/src/lib/world/binder.ts` sends
  `HumanRegistry.bind` or `upgrade` with the binder key.
- **Simulator.** Staging support is in `web/src/components/WorldVerify.tsx` and `credential.ts`. The
  World ID Simulator has no Selfie Check credential, so a level-1 request there asks for the Human
  (Orb) credential and binds it at its real level, 2.
- **LIFF reloads.** LINE's in-app browser reloads the page when World App returns. That's why the
  server links the wallet to the LINE user itself instead of waiting for the client
  (`web/src/app/api/world/verify/route.ts`, `docs/WORLD_DEBRIEF.md`).

### 4. Risk detection and trigger

```mermaid
flowchart TD
  sgli["JAXA GCOM-C SGLI L3 SST, night then day"] --> pin["pin.py: download once, store sha256 sidecar, re-hash on every read"]
  amsr["JAXA GCOM-W AMSR2 L3 SST, gap fill"] --> pin
  cobe["JMA COBE-SST normal"] --> pin
  pin --> heat["heat/indices.py: daily SST per plot and zone"]
  bulletin["Miyagi PSP and DSP bulletin, hand-transcribed"] --> review["hab/bans.py: reviewed bans.csv"]
  review --> restr[("risk.restrictions in PostGIS")]
  restr --> banweeks["hab/indices.py: BANWEEKS per species"]
  heat --> api["Pipeline API: /heat/plots/plot/risk, /hab/plots/plot/risk"]
  banweeks --> api
  api --> rules{"packages/shared rules.ts"}
  rules -- "HEAT: days with SST at or above tempC, 1 Jul to 30 Sep" --> fired["Rule fires"]
  rules -- "BANWEEKS: 4 consecutive restricted weeks" --> fired
  fired --> trig["buildTrigger: zoneId, speciesId, perilId, tier, seasonLabel, window, firedAt, index, threshold, tempC, dataHash, deadline"]
  trig --> sign["EIP-712 sign, domain ReliefPool version 2, by pipeline, co-op and science keys"]
```

- **Pinned inputs.** `pipeline/src/pipeline/core/clients/jaxa_earth.py` reads JAXA Earth's public
  STAC/COG store. `pipeline/src/pipeline/core/pin.py` writes each file once with a `.pin.json`
  sidecar (`url`, `sha256`, `size`, `fetched_at`) and refuses to read bytes that no longer match. Every
  index value carries that `source.sha256`.
- **Heat.** `pipeline/src/pipeline/hazards/heat/indices.py` fills each day from SGLI night, then SGLI
  day, then AMSR2 night. It also derives `SST_ANOM` against the COBE normal.
- **Toxin bans.** Miyagi's shellfish-toxin table goes through human review into
  `risk.restrictions` (`pipeline/src/pipeline/hazards/hab/bans.py`). `BANWEEKS` counts consecutive
  restricted weeks. The heat and HAB routes are live. Storm routes, and the heat/HAB forecast routes,
  still return 501.
- **Rules.** `packages/shared/src/rules.ts` loads `species.data.json`, generated from
  `pipeline/data/ref/species.json`:

  | Species | Tier | Peril | Fires when |
  |---|---|---|---|
  | scallop | 1 | HEAT | 14 days at 25 °C or above, 1 Jul to 30 Sep |
  | scallop | 2 | HEAT | 12 days at 26 °C or above |
  | hoya | 1 | HEAT | 30 days at 24 °C or above |
  | oyster, scallop | 1 | BANWEEKS | 4 consecutive weeks under a shipment ban |

- **The Trigger.** Defined in `packages/shared/src/trigger.ts` and `contracts/src/interfaces/IReliefPool.sol`.
  `tempC` is the rule's threshold temperature (0 for bans). `dataHash` is the sha256 of the pinned source
  series, so anyone can recount the days.
- **Signing.** `web/src/lib/keeper/signing.ts` takes the signed Trigger from the pipeline feed. If the
  feed is missing or has too few signatures, it tops up locally with `PIPELINE_SIGNER_PRIVATE_KEY`,
  `COOP_SIGNER_PRIVATE_KEY` and `SCIENCE_KEY_PRIVATE_KEY`.

### 5. Event lifecycle in the co-op console

```mermaid
sequenceDiagram
  autonumber
  actor O as Co-op operator
  participant UI as /coop event console
  participant API as /api/coop/events
  participant K as runKeeper
  participant J as Jev gate
  participant P as ReliefPool

  UI->>API: GET events
  API-->>UI: Stage per event: not_fired, awaiting_coop, anchored, settled
  O->>UI: Check event
  UI->>API: POST action check, with passcode
  API->>K: stage attest, force false
  K->>J: decideAttest with trigger and data quality
  alt attest_now at confidence 0.7 or higher
    K->>P: attest with Trigger and 2 of 3 signatures
    P-->>K: Attested with eventId, eligible units, perUnit
  else co_op_review, low confidence, or Jev down
    K-->>API: escalated, nothing sent on chain
    API-->>UI: Needs co-op review
    O->>UI: Accept and anchor
    UI->>API: POST action accept
    API->>K: stage attest, force true, skips Jev
    K->>P: attest
  end
  O->>UI: Settle plots
  UI->>API: POST action settle
  API->>K: stage settle
  K->>P: settle eventId with enrolled plots, batches of 5
  P-->>K: Paid or Held with reason, per plot
  K-->>UI: Plot outcomes and tx hashes
```

- **Console routes.** `web/src/app/api/coop/events/route.ts`. `GET` lists every reference event
  with its stage from `web/src/lib/keeper/event-status.ts`. `POST` takes `check`, `accept` or `settle`,
  guarded by `COOP_PASSCODE`. `settle` on an event that isn't anchored yet returns 409.
- **Keeper.** `web/src/lib/keeper/run.ts` (`runKeeper`) reads the attestation, loads and checks the
  signed Trigger, runs the Jev gate unless `force` is set, sends `attest`, then finds enrolled plots from
  `Enrolled` logs (`web/src/lib/keeper/plots.ts`) and settles them.
- **Jev gate.** `web/src/lib/jev-gate.ts` asks TypeSafe Jev (`typesafe/jev-1.13` through the
  OpenRouter Decisions API) to choose `attest_now` or `co_op_review`. Anything below
  `JEV_CONFIDENCE_THRESHOLD` (default 0.7), or any failure, becomes `co_op_review`.
- **On chain.** `ReliefPool.attest` needs `signerThreshold` distinct signers (2 of 3) over the
  EIP-712 domain `ReliefPool` version `2`. It checks the deadline, that the window has ended, and that
  `index >= threshold`. It reserves `perUnit = min(tierAmount, free balance / eligible units)` for every
  eligible unit.

### 6. Settlement, holds and claims

```mermaid
stateDiagram-v2
  [*] --> Unsettled: attest reserves the plot's share
  Unsettled --> Paid: settle, all checks pass
  Unsettled --> Held: settle, a check fails
  state Held {
    direction LR
    ZONE_MISMATCH --> NO_FARMER
    NO_FARMER --> PLOT_EXPIRED
    PLOT_EXPIRED --> UNVERIFIED
    UNVERIFIED --> CAP
  }
  Held --> Claimed: claimHeld within 90 days, checks now pass
  Held --> Swept: sweep after 90 days, reserve released to pool
  Paid --> [*]
  Claimed --> [*]
  Swept --> [*]
```

- **Checks, in order** (`_checkEligibility` in `contracts/src/ReliefPool.sol`). The first failing
  check becomes the hold reason.
  - `ZONE_MISMATCH`: the plot isn't enrolled, or its zone or species changed.
  - `NO_FARMER`: no one holds the season slot.
  - `PLOT_EXPIRED`: the slot has expired.
  - `UNVERIFIED`: the holder's wallet has no World ID level.
  - `CAP`: the human already hit `unitCap[level]` for this event.
- **Claims.** A held farmer who fixes the cause can call `claimHeld(eventId, plotLabel)` before
  `claimDeadline` (90 days after the attest). It always pays the current slot owner. From LINE the
  claim is gasless: `POST /api/liff/claim` (`web/src/lib/liff/claim.ts`) sends it with the keeper
  relayer's gas. From the web, `/relief` offers the same call through
  `frontend/src/components/solid/ReliefClaimAction.tsx`.
- **Sweep.** After the deadline, `sweep` frees the held share back into the pool. No tokens move.
  The pool keeps `reserved == pending + held` at all times.
- **Readable reasons.** Farmer-facing Japanese and English text for each reason is in
  `web/src/lib/held-reasons.ts`.

### 7. Notification

```mermaid
sequenceDiagram
  autonumber
  participant P as ReliefPool
  participant MB as MultiBaas
  participant WH as /api/multibaas/webhook
  participant K as runKeeper after settle
  participant N as notification_log
  participant D as payout directory
  participant LN as LINE Messaging API
  actor F as Farmer

  P-->>MB: Paid or Held event indexed
  MB->>WH: event.emitted, HMAC-SHA256 signed
  WH->>WH: Verify signature and timestamp
  WH->>D: LINE user for this wallet or plot
  WH->>N: claimNotification txHash and logIndex
  alt first claim
    N-->>WH: true
    WH->>LN: pushPaid or pushHeld Flex card
    LN->>F: Japanese then English message
  else already sent
    N-->>WH: false, skip
  end
  K->>N: Same claim for the same log
  Note over K,N: Whichever path claims first sends. The other skips.
```

- **Webhook.** `web/src/app/api/multibaas/webhook/route.ts` checks `X-MultiBaas-Signature`, an
  HMAC-SHA256 of body plus timestamp keyed by `MULTIBAAS_WEBHOOK_SECRET`
  (`verifyMultiBaasSignature` in `web/src/lib/multibaas.ts`). `Paid` and `Held` become LINE pushes.
  `Donated` and `Attested` are only logged.
- **Two senders, one message.** The keeper also pushes right after `settle`
  (`web/src/lib/keeper/run.ts`). Both paths call `claimNotification` in
  `web/src/lib/notification-log.ts`. It inserts `txHash:logIndex` into `app.notification_log` with
  on-conflict-do-nothing, so each chain event is pushed once. Without `DATABASE_URL` it falls back
  to a JSON file.
- **LINE.** `web/src/lib/line.ts` builds the `pushPaid` / `pushHeld` Flex bubbles and mints a
  short-lived channel token. The LINE webhook (`web/src/app/api/line/webhook/route.ts`) answers
  farmer questions with a canned bilingual reply picked by Jev. It hands off to the co-op when Jev isn't
  sure.
- **Setup.** `bun run multibaas:setup` (`scripts/multibaas-setup.ts`) links the contracts and
  registers the webhook. See `docs/MULTIBAAS.md`.

### 8. Donation

```mermaid
sequenceDiagram
  autonumber
  actor D as Donor wallet
  participant UI as /relief or /donate
  participant J as JPYC
  participant P as ReliefPool
  participant MB as MultiBaas
  participant DASH as Fund ledger

  D->>UI: Enter amount, for example 20,000 JPYC
  UI->>J: allowance for ReliefPool
  alt allowance too low
    D->>J: approve ReliefPool for amount
  end
  D->>P: donate amount with memo
  P->>J: transferFrom donor to pool
  P-->>MB: Donated from, amount, memo
  DASH->>MB: GET /api/multibaas/events
  Note over DASH: Falls back to reading logs from the chain
  DASH-->>UI: Balance, reserved and activity
```

- **Two donation screens.** The Astro `/relief` page uses `frontend/src/components/solid/DonateForm.tsx`.
  The Next.js `/donate` page uses `web/src/components/donate/donate-screen.tsx`. Both use plain
  `approve` then `ReliefPool.donate(amount, memo)`. JPYC has 18 decimals, so ¥20,000 is `20000e18`.
- **Ledger.** `web/src/app/api/multibaas/events/route.ts` serves indexed events from MultiBaas and
  falls back to `getLogs` when MultiBaas isn't configured. `/relief` reads the fund summary and each
  plot's settlement straight from chain (`frontend/src/lib/chain/client.server.ts`, also served as
  `GET /api/relief/fund` and `GET /api/relief/plot/[plot]`).

### 9. Marketplace sale

```mermaid
sequenceDiagram
  autonumber
  actor B as Buyer wallet
  participant S as Astro /market storefront
  participant AQ as Astro /api/market/quote
  participant WQ as web /api/market/quote
  participant J as JPYC
  participant R as SaleRouter
  participant P as ReliefPool
  actor Sel as Seller

  B->>S: Choose a listing in CheckoutForm
  S->>AQ: POST listing and buyer
  AQ->>WQ: Forward to LEGACY_WEB_ORIGIN
  WQ->>WQ: buildQuote, reliefBps 500, 10 minute expiry
  WQ->>WQ: Sign EIP-712 Quote with the co-op key
  WQ-->>S: quote and signature
  S->>R: Check signer equals quoteSigner
  B->>J: approve SaleRouter for quote total
  B->>R: checkout quote and signature
  R->>R: Verify signature, buyer, expiry, unused order, listing and nonce
  R->>J: transferFrom buyer total
  R->>Sel: total minus relief
  R->>P: donate relief with memo sale:orderId
  R-->>B: Checkout event
  Note over R,P: All legs succeed together or the whole call reverts
```

- **Storefront.** `frontend/src/pages/market/index.astro` renders
  `frontend/src/components/organisms/marketplace/MarketplaceDiscovery.astro`. That opens
  `frontend/src/components/solid/CheckoutForm.tsx`, with the steps in `checkout-services.ts`. A pending
  purchase survives a reload through `localStorage`.
- **Quote.** `frontend/src/pages/api/market/quote.ts` validates the listing and forwards to
  `web/src/app/api/market/quote/route.ts`, because the signing key lives only in `web/`. `buildQuote`
  and `signSaleQuote` are in `packages/shared/src/market-quote.ts` and `quote.ts`. The EIP-712 domain is
  `SaleRouter` version `1`. The fields are `orderId, listingId, buyer, seller, total, reliefBps, nonce,
  expiry`.
- **Split.** `contracts/src/SaleRouter.sol` computes `relief = floor(total × reliefBps / 10000)`. The
  seller gets the rest. Listings quote 5% (`MARKET_RELIEF_BPS = 500`), and the router refuses anything
  above its `maxReliefBps` of 10%. The pool's `Donated` event with memo `sale:<orderId>` ties the
  relief leg back to the sale. See `docs/SALE-ROUTER.md`.

### 10. Public verification

```mermaid
sequenceDiagram
  autonumber
  actor V as Anyone
  participant Pg as /verify/eventId page
  participant Src as Pinned source data
  participant P as ReliefPool
  participant Br as Browser

  V->>Pg: Open /verify/eventId
  Pg->>Src: Load the SST CSV for the zone and season
  Pg->>P: Read the Attested event for eventId
  Pg-->>Br: CSV, on-chain Trigger and buoy context
  Br->>Br: sha256 of the CSV
  Br->>Br: Re-run rules.ts evaluateRules on the CSV
  Br->>Br: Compare hash with dataHash and fire date with firedAt
  Br-->>V: Match or mismatch, with the day-by-day table
```

- **Files.** `web/src/app/verify/[eventId]/page.tsx` resolves the event, loads the CSV and reads the
  on-chain Trigger. `web/src/components/verify/VerifyClient.tsx` hashes and recomputes in the browser
  with `sha256Hex`, `parseErddapCsv` and `evaluateRules` from `@repo/shared`. The browser runs the same
  rule code the Trigger was built with.
- **Scope.** This covers HEAT events. BANWEEKS events come from a PDF bulletin, so the page shows
  them as recorded rather than recomputed.
- **Why it matters.** `dataHash` on chain is the sha256 of the pinned input, and `rules.ts` is public.
  Nobody has to trust the keeper to check that a payout was owed.

---

## Why parametric relief

Reel Deal is a fisheries and aquaculture relief fund for climate change, harmful algal blooms, and
storm damage. Conditions are getting less predictable, and fishers and aquaculture operators struggle
to respond and adapt. The fund is paid for by the sale of local goods and by donations. It's informed
by real-time satellite data and existing oceanographic sensor networks, and it releases money
transparently and on time to affected farms. The scope is Japan's Exclusive Economic Zone.

Insurance collects manageable payments ahead of time, so it can pay beneficiaries when an event damages
their business. There are two broad kinds:

1. **Damages-based insurance.** After an event (say, a car accident), the insurer assesses the damage
   and pays according to its value. Payment waits for the assessment.
2. **Parametric insurance.** Payment is triggered by a measured threshold, not by assessed damage. In
   a wildfire, for example, it might pay when a property reaches 200 °C. Nobody has to assess damage,
   so the money arrives sooner and can be used to respond to the event.

Reel Deal uses the parametric model. The thresholds depend on the species and the farming gear,
because finfish, shellfish and seaweed tolerate heat, storm energy and algal-bloom toxins differently.
It is a relief fund, a social good, rather than insurance, which avoids insurance's legal burden.

The fund has three sources:

1. Direct donations.
2. Fees from fishers and aquaculture farmers (planned).
3. Sales of local products through the Reel Deal marketplace. 5% of each sale goes to the pool.

Threshold data comes from satellite products (JAXA today, with NASA and ESA as candidates), in-water
sensor networks and prefecture bulletins. Sensors and prefecture reports are the ground truth for
calibrating satellite-derived values. Together they support forecasting and hindcasting where, and how
likely, thresholds are crossed.

## Data model

The conceptual model the app and pipeline schemas grew from. On chain there are only wallets, plot
codes, zone and species ids, and nullifiers. Farmers' personal details stay off chain.

```mermaid
erDiagram
    AquacultureFarmer ||--o{ Farm : owns
    AquacultureFarmer }o--|| Fund : "member of"
    Farm }o--|| Species : farms
    Farm }o--|| Equipment : uses
    Species ||--o{ Threshold : "tolerates up to"
    RiskModel ||--o{ Threshold : "evaluated by"
    RiskModel }o--|| RiskType : predicts
    RiskModel }o--o{ RiskDataLayer : "reads inputs"
    RiskDataProvider ||--o{ RiskDataLayer : publishes
    Threshold ||--o{ Event : "crossed in"
    Farm ||--o{ Event : "affected by"
    Fund ||--o{ Event : "pays out for"
    Fund ||--o{ Transaction : ledger
    Buyer ||--o{ Transaction : "purchase fee"
    Donor ||--o{ Transaction : donates
    AquacultureFarmer |o--o{ Transaction : "pays fee"
    Event |o--o{ Transaction : payout

    AquacultureFarmer {
        uuid id PK
        uuid fund_id FK
        string wallet "no PII on chain"
    }
    Farm {
        uuid id PK
        geometry location "GeoJSON polygon, EPSG:4326"
        string species FK
        string equipment FK
        uuid farmer_id FK
    }
    Species {
        string name PK
    }
    Equipment {
        string type PK
        string description
    }
    Threshold {
        uuid id PK
        string species FK
        uuid risk_model_id FK
        string op "above | below | between"
        numeric low
        numeric high
    }
    Event {
        uuid id PK
        uuid threshold_id FK
        uuid farm_id FK
        uuid fund_id FK
        timestamptz datetime
    }
    Fund {
        uuid id PK
        numeric total_value "JPYC, 18 decimals"
    }
    Transaction {
        uuid id PK
        uuid fund_id FK
        uuid buyer_id FK "nullable"
        uuid donor_id FK "nullable"
        uuid farmer_id FK "nullable, fee"
        uuid event_id FK "nullable, payout"
        numeric amount
        string tx_hash
    }
    Buyer {
        uuid id PK
    }
    Donor {
        uuid id PK
    }
    RiskDataProvider {
        string name PK "NASA, ESA, JAXA"
    }
    RiskDataLayer {
        uuid id PK
        string provider FK
        string name "e.g. NASA SST"
        int frequency_days "1 daily, 30 monthly"
    }
    RiskModel {
        uuid id PK
        string name "e.g. HAB Model v1"
        string version
        string risk_type FK
    }
    RiskType {
        string name PK "HAB, Heat Stress, Storm Damage"
        string units
    }
```

- Each Species has one `Threshold` row per risk model. Each RiskModel predicts one RiskType.
- A Transaction has exactly one counterparty: a buyer (a marketplace sale), a donor, a farmer (a fee),
  or an event (a payout).
- The on-chain ReliefPool balance is the source of truth for money. `Fund.total_value` is derived
  from transactions and reconciled against it.
- Postgres schema ownership is recorded in [ADR 0004](docs/adrs/0004-postgres-schema-ownership.md).
  The pipeline owns `geo` and `risk`. `web/` owns `app`, which holds wallet links, plot wallets and
  the notification log.

## Repository structure

- `contracts/`: Foundry. `ReliefPool`, `HumanRegistry`, `SaleRouter`, the ENSv2 adapters
  (`EnsPlotResolver`, `EnsSlotResolver`), tests and deploy scripts.
- `packages/shared/`: the interface contract. Trigger and Quote types, EIP-712 domains, rules, ids,
  ABIs, addresses, the marketplace catalogue and the quote builder.
- `web/`: Next.js. The LIFF farmer app, `/app`, `/coop`, `/holder`, `/donate`, `/market`, `/map` and
  `/verify/[eventId]`, plus every keyed API route: keeper, World ID, market quote, LINE and MultiBaas
  webhooks.
- `frontend/`: Astro with Solid and React islands. `/hmi`, `/market`, `/relief`, the risk and tile
  proxies, and Storybook.
- `pipeline/`: Python (uv, FastAPI). JAXA ingestion, sha256 pinning, heat and HAB indices and layers.
  Storm routes are still stubs (501). Spec: `pipeline/README.md`.
- `db/`: the Postgres + PostGIS service, with migrations for `geo` and `risk`.
- `docs/`: [INTERFACE.md](docs/INTERFACE.md) (pipeline ↔ app contract),
  [ARCHITECTURE.md](docs/ARCHITECTURE.md), [ADRs](docs/adrs/README.md), and the integration notes
  [JEV.md](docs/JEV.md), [MULTIBAAS.md](docs/MULTIBAAS.md), [SALE-ROUTER.md](docs/SALE-ROUTER.md) and
  [WORLD_DEBRIEF.md](docs/WORLD_DEBRIEF.md). Justin's [HMI handoff](docs/HMI-HANDOFF.md) covers the
  map work.
- `specs/`: Dotdog specs. `bun run dog:map && bun run dog:check` checks that every file is covered and
  that reviewed areas haven't drifted (see [docs/REPO-MAP.md](docs/REPO-MAP.md)).

## Setup

```sh
git clone --recurse-submodules https://github.com/reeldeal-xyz/reeldeal.git
cd reeldeal
cp .env.example .env
bun install
(cd pipeline && uv sync)
bun run contracts:build && bun run contracts:test
bun run typecheck
bun run pipeline       # pipeline API on :8787 (uv run pipeline-serve)
bun run pipeline:test
bun run dev            # web/ on :3000
bun run frontend:dev   # frontend/ (Astro)
```

Built at ETHGlobal Tokyo 2026 (Classic track), from 21:00 JST Friday 25 Sep.
