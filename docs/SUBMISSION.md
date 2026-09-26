<p align="center"><img src="assets/reeldeal-logo.svg" alt="Reel Deal" width="128"></p>

# Submission: Reel Deal

ETHGlobal Tokyo 2026, Classic track. Submission owner: Sailesh (#27).

Updated 2026-09-27 JST. The app uses **Sepolia (chain 11155111)**. Transaction
proofs below are the recorded September 26 runs; they are not new payments.
The project's name is **Reel Deal**. `umi.eth` remains the deployed ENS parent.

## Current release

- **App:** <https://app.13-196-78-137.sslip.io/hmi> — coastal map, fish market and relief dashboard in Astro.
- **Market:** scallop, sea pineapple (hoya) and oyster first; signed checkout sends **95% to the seller and 5% to the relief fund** atomically through SaleRouter.
- **Map:** PostGIS plot polygons, satellite imagery, sea temperature/anomaly, chlorophyll, species thresholds, polygon analysis and hourly forecast playback. EN/JP; mobile controls collapse.
- **Verified live:** 467 plots at pipeline `/ready`; heat observations, HAB restriction indices, weather forecast, relief balances/events, and scallop/hoya/oyster quotes with `reliefBps: 500` (2026-09-27, 03:43–03:50 JST). No payment was sent during these checks.
- **Catalogue deployment:** an initial hoya quote failed against the old backend; rechecking after its update returned valid-price quotes for all three primary species. Astro and the signer must stay on the same catalogue revision.

LIFF, co-op, holder, verification and donation pages still use the legacy backend;
Astro redirects those routes explicitly. Deployment details: [frontend/DEPLOY.md](../frontend/DEPLOY.md).

## Tagline

**Community-funded relief payments for aquaculture farmers.**
(Justin's copy, issue [#32](https://github.com/reeldeal-xyz/reeldeal/issues/32) — 59
characters, fits the ETHGlobal short-description field as-is.)

## Short description

*(≤100 characters, paste directly into the ETHGlobal "short description" field)*

> Parametric relief for aquaculture farmers, paid in JPYC when ocean risk crosses a threshold.

## Description

*(≥280 characters)*

Fishermen and aquaculture farmers on Japan's coast face shipping restrictions from
harmful algal blooms, heat stress and storm damage — with no fast, low-friction way to
get help. Conventional insurance needs a claims adjuster and takes months. Reel Deal is
a donor-funded relief pool that instead pays out **parametrically**: when a public risk
index (satellite sea-surface temperature, or a prefecture's own shipping-restriction
bulletin) crosses a species-specific threshold, the pool pays JPYC directly to the
farmer who holds that plot's season slot — no claims adjuster, no damage assessment,
just a reproducible read of public data against a rule everyone can check in advance.

Identity is capped per real person with World ID (so one farmer can't claim as many
plots as they can register), plot ownership and season-slot assignment live on ENSv2
(non-transferable, expiring names — a slot can't be sold or squatted), and farmers see
everything — evidence, amount, payment status — through a LINE mini-app, because LINE
is how Japanese fishing co-ops already communicate. Curvegrid MultiBaas indexes every
on-chain event and drives the LINE push the moment a payment lands.

This is explicitly **not** insurance in the legal sense (see `README.md`'s framing) and
not a claim that a shipping restriction equals a specific farmer's measured loss — see
[Honest limitations](#honest-limitations-and-whats-next). It is a smaller, sharper
claim: *if a public index crosses a line, money moves, fast, to a name-checked human,
with a public paper trail.*

## Problem

- Aquaculture and fisheries operators in Japan absorb climate, algal-bloom and storm
  risk with little fast-moving relief between "nothing" and "wait for a formal
  insurance claims process."
- Existing supplementary support (see `docs/research/aquaculture-evidence.md`'s
  [Japan's fisheries income support](https://www.jfa.maff.go.jp/j/kikaku/syotoku_hosyo/))
  and models like [COAST](https://www.ccrif.org/projects/coast/coast-faqs) inform this
  design but are not this fund; grower/co-op validation of need and allocation fairness
  remains outstanding (same doc).
- A shipping restriction (出荷自主規制) is evidence of constrained sales, **not** proof
  that a specific farm lost stock or a measured yen amount — the project is careful
  never to conflate the two (`docs/research/aquaculture-evidence.md`).

## How it works

1. **Donations and sales fund the pool.** Direct JPYC donations call `ReliefPool.donate`.
   Marketplace checkout calls `SaleRouter`: it pays the seller 95% and donates 5%
   with a `sale:<orderId>` memo in the same transaction. The Astro review dialog
   validates the signed quote and confirms both checkout and donation receipt events
   (`contracts/src/SaleRouter.sol`, `frontend/src/lib/market-proof.ts`).
2. **Farmers register.** A licence holder registers a per-plot ENSv2 subname under
   `karakuwa.umi.eth` and issues a non-transferable, expiring **"2026" season slot** to
   the farmer working that plot (`docs/INTERFACE.md`'s ENS layout, issues #7/#10/#11).
3. **Farmers verify humanity.** World ID (IDKit 4.3) verifies the farmer server-side —
   Selfie Check (level 1) or World ID Orb (level 2) — and
   `HumanRegistry.sol` records a per-nullifier level that caps units paid per real
   person, not per wallet.
4. **A public risk index crosses a threshold.** The pipeline (`pipeline/`, Jay) publishes
   an index value with provenance (a sha256 of the pinned source). Today: JAXA daily SST
   for the **heat** module; reviewed prefecture restrictions stored in PostGIS for
   **HAB** (`BANWEEKS` / `BAN_ACTIVE`). Chlorophyll map layers are an algae proxy,
   not a toxin result. Storm risk remains unimplemented; weather forecasts are advisory.
   The app's `RULES` (`packages/shared/src/rules.ts`) — never the pipeline — decide when
   a threshold is met and build a `Trigger`.
5. **A confidence gate reviews the trigger.** Jev (TypeSafe, via OpenRouter) scores the
   trigger's data quality as a typed Choice (`attest_now` / `co_op_review`); below 0.7
   confidence, or on any failure, the keeper escalates to the co-op instead of guessing.
   Jev can only *add* friction — it has no code path that calls `attest`/`settle`
   (`docs/JEV.md`).
6. **The keeper attests.** `runKeeper()` (`web/src/lib/keeper/run.ts`) builds an
   EIP-712-signed `Trigger` (domain `{name:"ReliefPool", version:"2"}`) and calls
   `ReliefPool.attest`, which needs 2-of-3 signer signatures and reserves the pro-rata
   payout across every plot enrolled for that zone/species.
7. **The pool settles per plot.** `ReliefPool.settle` resolves each plot's season-slot
   owner through ENSv2 (`EnsSlotResolver`/`EnsPlotResolver`) and either pays JPYC
   (verified farmer, in season, in zone, under the unit cap) or holds the share with an
   explicit reason (`UNVERIFIED`, `NO_FARMER`, `PLOT_EXPIRED`, `CAP`, `ZONE_MISMATCH` —
   `web/src/lib/held-reasons.ts`).
8. **Curvegrid MultiBaas indexes the event** and calls an HMAC-signed webhook
   (`web/src/app/api/multibaas/webhook/route.ts`), which pushes a **Paid** or **Held**
   card to the farmer over LINE Messaging API (`web/src/lib/line.ts`).
9. **The farmer checks status in LINE.** The LIFF app (`web/src/app/liff`) shows plot,
   evidence, wallet balance and payment state; a Held farmer can request a claim once
   verified. Jev also answers the farmer's free-text LINE questions with a canned
   bilingual reply, routed by intent classification, never generated text
   (`docs/JEV.md`).

## Architecture

```
JAXA Earth API (SST, chl-a)      ─┐              ┌─ heat  (climate change, IMPLEMENTED) ─┐
Copernicus (physics, waves)      ─┼─> pipeline ──┼─ hab   (restrictions + chl-a)       ─┼─> index values + sha256 ─┐
JMA tide/track, 貝毒/赤潮 bulletins ─┘  (Jay,      └─ storm (surge, waves, spec/501)       ─┘   (FastAPI, :8787)       │
                                       national)                                                                     v
                                            keeper (app): RULES thresholds ─> Jev gate ─> signed Trigger ─> ReliefPool
ENSv2 Sepolia: karakuwa.umi.eth ─> p1213-NNN (x15) ─> "2026" season slot ─> ReliefPool (JPYC) ─> farmer wallet (LIFF)
World ID (IDKit 4.3) ─> server verify (developer.world.org/api/v4/verify) ─> HumanRegistry (level 1 Selfie Check, level 2 World ID Orb)
MultiBaas (Curvegrid) indexes Donated/Attested/Paid/Held ─> HMAC-signed webhook ─> LINE Messaging API push
```

```text
Browser → Astro /hmi · /market · /relief (AWS EC2, Caddy)
          ├─ FastAPI → PostGIS plots / heat / HAB; weather forecast provider
          ├─ Sepolia reads + wallet checkout → SaleRouter → seller + ReliefPool
          └─ quote API → legacy web/ signing service (Railway)
LINE → legacy LIFF app → World ID / ENS / keeper / MultiBaas / LINE webhooks
```

PostGIS stores the plot inventory and reviewed restrictions. Plot geometry is read
through the pipeline; ENS remains authoritative for season-slot ownership. Production
services use the database; component fixtures stay in Storybook and `/preview`.

## Sponsors

Three formal ETHGlobal Tokyo 2026 prize tracks are targeted (checked directly against
`ethglobal.com/events/tokyo2026/prizes` and each sponsor's detail page, 2026-09-26):

| Prize | Sponsor page | Amount |
|---|---|---|
| Best Use of ENSv2 | <https://ethglobal.com/events/tokyo2026/prizes/ens> | $6,000 ($3,000/$2,000/$1,000) |
| Best Use of IDKit | <https://ethglobal.com/events/tokyo2026/prizes/world> | $5,000 (up to 2 teams, $2,500 each) |
| Best RWA Tokenization Project | <https://ethglobal.com/events/tokyo2026/prizes/curvegrid> | $1,000 |

`ethglobal.com/events/tokyo2026/prizes/{jpyc,line,reown}` all return **404** and none of
JPYC, LINE, TypeSafe/OpenRouter or Reown appear on the main prizes page's sponsor list —
they're technology partners the project uses, not prize tracks it's entered against.

| Sponsor | What we used | Where in code | Proof |
|---|---|---|---|
| **ENS** (ENSv2 Sepolia) | `umi.eth` parent → `karakuwa.umi.eth` branch → 15 per-plot registries → non-transferable, expiring **"2026" season slots**; `PermissionedResolver` text records (`zone`/`species`/`area`/`unit`); ReliefPool resolves the payout target through ENS at settlement time, not a cached copy | `contracts/src/adapters/EnsPlotResolver.sol`, `EnsSlotResolver.sol`, `contracts/src/interfaces/IEnsV2.sol`, `contracts/script/ens/EnsV2.sol` (write side), `docs/INTERFACE.md`'s ENS layout section | EnsPlotResolver [`0x5Fd0…F89b`](https://sepolia.etherscan.io/address/0x5Fd09356151DfF3DFca06B1270e5DDAF11DaF89b) (deploy [`0xa372…95c78a`](https://sepolia.etherscan.io/tx/0xa372f082de22b95b763cd9d012ac849177b45b2539ba44ed33498ba58195c78a)), EnsSlotResolver [`0xbf91…c80Ec`](https://sepolia.etherscan.io/address/0xbf91d74c0010ba727bD3B251B3fc5700835c80Ec) (deploy [`0x1511…52c8c`](https://sepolia.etherscan.io/tx/0x1511575cb70e24035b69c5bf6977614927cd16a3fdc020cb4452b897d42c528c)) |
| **Curvegrid MultiBaas** | Event indexing for `Donated`/`Attested`/`Paid`/`Held`; HMAC-SHA256-signed webhook drives the LINE push in place of a keeper-side event poller; donor-ledger dashboard reads indexed events | `scripts/multibaas-setup.ts` (setup/link script), `web/src/lib/multibaas.ts` (`verifyMultiBaasSignature`), `web/src/app/api/multibaas/webhook/route.ts`, `web/src/app/api/multibaas/events/route.ts`, `docs/MULTIBAAS.md` | Webhook registered against `https://web-production-746aa.up.railway.app/api/multibaas/webhook` (`docs/MULTIBAAS.md` §Setup); doc sources read directly and cited: docs.curvegrid.com/multibaas/{webhooks,event-indexing,manage-contracts} |
| **JPYC** | The only payout/donation currency, 18 decimals throughout (never assumed 6); EIP-3009/EIP-2612 domain hardcoded from a live signature-recovery check because the proxy reverts on `DOMAIN_SEPARATOR()`/`eip712Domain()` | `packages/shared/src/addresses.ts` (`JPYC`, `JPYC_DECIMALS`, `JPYC_EIP712_DOMAIN` — see its long inline comment for the verification), `contracts/src/ReliefPool.sol` (`SafeERC20`), `web/src/lib/liff/wallet-relay.ts` (gasless send) | JPYC [`0xE7C3…3c29`](https://sepolia.etherscan.io/address/0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29); recorded September 26 run paid 10,000 JPYC (`10000e18`) to `p1213-001` |
| **LINE** | LIFF farmer app (My Farm, Wallet tab: balance/activity/gasless send/key backup); LINE Login; Messaging API push on Paid/Held; Jev's LINE intent-routing replies go out over the same reply API | `web/src/app/liff/**`, `web/src/lib/line.ts`, `web/src/lib/line-auth.ts`, `web/src/app/api/line/webhook/route.ts` | LIFF `https://liff.line.me/2011749457-SgvM5ahH`, OA `@475hqocx`; recorded earlier-pool run delivered a "Paid" push card to the farmer's LINE |
| **TypeSafe (Jev, via OpenRouter)** | Off-critical-path decision layer: (1) classifies farmer LINE messages into a canned bilingual reply, (2) gates whether the keeper attests a fired trigger (`attest_now` / `co_op_review`, threshold 0.7). Never signs, never pays, can only add friction | `web/src/lib/jev.ts` (client), `web/src/lib/jev-gate.ts` (`decideAttest`), `web/src/lib/jev-templates.ts`; wired into `web/src/lib/keeper/run.ts::runKeeper` | `docs/JEV.md` logs 3 real alpha-API calls against `https://openrouter.ai/api/alpha/decisions` on 2026-09-26 (total spend $0.000069); includes a real marginal-confidence example (0.53 → `co_op_review`) |
| **Reown AppKit** | Wallet sign-in for people **without LINE**: `/app` → *Connect wallet* (WalletConnect QR / mobile deep link / browser wallets, Sepolia) → SIWE (EIP-4361) verified server-side → the same session and farmer UI as LINE users | `web/src/app/app/`, `web/src/app/api/wallet-auth/{nonce,verify}/`, `web/src/lib/siwe.ts`, `@reown/appkit` + `@reown/appkit-adapter-wagmi` `2.0.0-wagmi-v3.0` | [#123](https://github.com/reeldeal-xyz/reeldeal/pull/123); live at https://web-production-746aa.up.railway.app/app |

## Deployed addresses (Sepolia, chain `11155111`)

Source of truth: `packages/shared/src/addresses.ts`. ENSv2's own contracts (below) are
Curvegrid/ENS Labs' deployment, re-verified live 2026-09-26, not ours.

| Contract | Address | Deploy tx | Notes |
|---|---|---|---|
| **ReliefPool** (v2, **live pool** — the app points here, fresh 200k JPYC pool used in the demo video) | [`0xa9F67EA1717D2D068C7Cd4599CEB50755a8A2a68`](https://sepolia.etherscan.io/address/0xa9F67EA1717D2D068C7Cd4599CEB50755a8A2a68) | block 11785698, created by `bun run e2e -- --live` | Same v2 contract, 100,000 JPYC seed; attested, all 8 karakuwa-east scallop plots settled (below); SaleRouter donates here |
| ReliefPool (v2, first live run — proof txs below) | [`0xB25888A81B6F2D337c2f0CBFB863324F258c43e5`](https://sepolia.etherscan.io/address/0xB25888A81B6F2D337c2f0CBFB863324F258c43e5) | block 11785698, created by `bun run e2e -- --live` | Same v2 contract, 100,000 JPYC seed; attested, all 8 karakuwa-east scallop plots settled (below); SaleRouter donates here |
| ReliefPool (v2, earlier pool, superseded by the redeploy above) | [`0x560E8404be74DCB7F3877835F374CF1B1B696D32`](https://sepolia.etherscan.io/address/0x560E8404be74DCB7F3877835F374CF1B1B696D32) | [`0x1e583bd2…9505fb`](https://sepolia.etherscan.io/tx/0x1e583bd21588f944a6797a662c55d338f72fa7ec00b530366382c959b79505fb) (block 11785370) | Trigger v2 (`tempC`), EIP-712 domain `{"ReliefPool","2"}`, 2-of-3 signers (#55, #117, #118). Redeployed to wire up SaleRouter (#125); this address is no longer what the app or `packages/shared/src/addresses.ts` point to — kept here only because it's where the *first* attest/settle run happened |
| **SaleRouter** | [`0xD7aa137538874D05a375cF3BF152F3Fc57d89296`](https://sepolia.etherscan.io/address/0xD7aa137538874D05a375cF3BF152F3Fc57d89296) | #125 | Atomic sale → seller + `donate("sale:<orderId>")`; quote signer = co-op signer, max 10% |
| **HumanRegistry** | [`0xc713c174b33B071f7Bf6dC571E3dd7BfB441D4F8`](https://sepolia.etherscan.io/address/0xc713c174b33B071f7Bf6dC571E3dd7BfB441D4F8) | [`0x14757a36…3f4f7aa`](https://sepolia.etherscan.io/tx/0x14757a363b91b2a8e08c2d820523d24da651e59c51c519f993424b7cb3f4f7aa) | |
| **EnsPlotResolver** | [`0x5Fd09356151DfF3DFca06B1270e5DDAF11DaF89b`](https://sepolia.etherscan.io/address/0x5Fd09356151DfF3DFca06B1270e5DDAF11DaF89b) | [`0xa372f082…95c78a`](https://sepolia.etherscan.io/tx/0xa372f082de22b95b763cd9d012ac849177b45b2539ba44ed33498ba58195c78a) | |
| **EnsSlotResolver** | [`0xbf91d74c0010ba727bD3B251B3fc5700835c80Ec`](https://sepolia.etherscan.io/address/0xbf91d74c0010ba727bD3B251B3fc5700835c80Ec) | [`0x1511575c…d42c528c`](https://sepolia.etherscan.io/tx/0x1511575cb70e24035b69c5bf6977614927cd16a3fdc020cb4452b897d42c528c) | |
| **JPYC** (third-party token) | [`0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29`](https://sepolia.etherscan.io/address/0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29) | — | 18 decimals, faucet.jpyc.co.jp |
| **ENSv2 core** (third-party: ETHRegistrar, ETHRegistry, RootRegistry, PermissionedResolver impl, UserRegistry impl) | see `packages/shared/src/addresses.ts` `ENS` object | — | Redeploys ~monthly; re-verified live 2026-09-26, `contracts-v2@71a3b73` |
| **SaleRouter** (atomic JPYC purchase → `ReliefPool.donate`) | One tx: pull the buyer's JPYC, pay the seller, `donate(relief, "sale:<orderId>")`; EIP-712 signed quotes (co-op signer), replay/double-sale guards, integer split (`relief = floor(total·bps/10000)`) | `contracts/src/SaleRouter.sol`, `packages/shared/src/quote.ts`, `docs/SALE-ROUTER.md` | [`0xfc17…58bd`](https://sepolia.etherscan.io/address/0xfc178e7fA7b3119e2E233FeDF5e2E317D95658bd) → demo pool `0xB258…43e5`; Foundry tests + fork dry run ([#125](https://github.com/reeldeal-xyz/reeldeal/pull/125)); Astro checkout merged in [#172](https://github.com/reeldeal-xyz/reeldeal/pull/172) and [#174](https://github.com/reeldeal-xyz/reeldeal/pull/174) |
| ReliefPool v1 (superseded) | [`0x803d06aa8b1c1e6bb1418f586328fade877afe9f`](https://sepolia.etherscan.io/address/0x803d06aa8b1c1e6bb1418f586328fade877afe9f) | [`0xba71494e…9108ed89383`](https://sepolia.etherscan.io/tx/0xba71494e484afabf6ecc6fa6175e435b5d2253c3d1518639cbc219108ed89383) | Trigger v1 (no `tempC`), domain `{"ReliefPool","1"}` — replaced by v2 under #55/#117/#118; a v1 signature never verifies against v2 |

### Recorded end-to-end run (2026-09-26)

Event `2026-scallop-banweeks-karakuwa` (Karakuwa east scallop shipping restriction,
May 12 → Sep 15 2026, per the [pinned Miyagi prefecture PDF](https://www.pref.miyagi.jp/documents/24934/080915_mahikeika.pdf),
sha256 `39851aa6b573d9a4491f48fb2595609ffb07f84ac4a42000ab81fb1c4563d708`), fired at the
4th weekly `BANWEEKS` checkpoint (June 2). Proof below is against the **current live
pool** (`0xB25888A8...`, the one `packages/shared/src/addresses.ts` and the deployed app
actually point to), independently re-derived from raw chain logs (`eth_getLogs`, event
topics decoded against `contracts/src/interfaces/IReliefPool.sol`'s exact signatures via
`cast keccak`), not just trusted from an API response:

1. Donated (100,000 JPYC seed) — tx [`0x85715828…d5b2b9`](https://sepolia.etherscan.io/tx/0x857158283b6b660a820ec61017138b66b23ba0bd0dae7de1893ff95d30d5b2b9).
2. Jev's attest gate escalated to co-op review (marginal data-quality read); co-op
   approved — keeper attested, tx [`0x8070a0cb…8bbbf2`](https://sepolia.etherscan.io/tx/0x8070a0cbb0861ab028b889224754262315a68529ce8e1be85f761ae0f916d2be).
3. Settled — tx [`0x635c30a4…4b2ded`](https://sepolia.etherscan.io/tx/0x635c30a45200cfa123b8a214a94bd0bc6a915dbae1eb339ed9f8fa0f554b2ded)
   (`p1213-001` Paid, `p1213-002..005` Held) and tx [`0x8461479b…fa53518`](https://sepolia.etherscan.io/tx/0x8461479b92beb837751d1a73196085b72de2a215190e77c80cabd3c18fa53518)
   (`p1213-006..008` Held) — settlement was run in two batches (`POST /api/keeper/replay`
   is idempotent per-plot; the second batch just finished the remaining unsettled plots).
4. Plot `p1213-001` (World-ID-level-2-verified farmer, `0x1aEDC8...eEAB51`) **Paid
   exactly 10,000 JPYC** — decoded directly from the `Paid` event's log data
   (`10000000000000000000000` wei), not read off a UI. The other 7 enrolled scallop
   plots are **Held(UNVERIFIED)**.
5. LINE push: confirmed delivered for the **first** live run against the earlier pool
   (`0x560E8404...`, tx `0x786ad95c...`/`0x9d046a0c...` below). Not independently
   re-confirmed for this pool's Paid event — the keeper replay response showed
   `"sent": false` for the Held pushes it just fired (no linked LINE account on the
   still-synthetic demo plots), and the earlier Paid push for `p1213-001` on *this* pool
   happened before this check, so don't claim a fresh LINE screenshot without pulling one.

Earlier run, same event, on the pool this one superseded (`0x560E8404...`, see
[addresses](#deployed-addresses-sepolia-chain-11155111)): keeper attested (tx
[`0x786ad95c…9894190`](https://sepolia.etherscan.io/tx/0x786ad95c1c2712361830c831ea2b9bb9dcd7eecf9bbb8187e1f45f69a9894190)),
settled (tx [`0x9d046a0c…e85fd03`](https://sepolia.etherscan.io/tx/0x9d046a0c9ec189ea9cdcd37789b30e72868152615ba70878775527319e85fd03)),
`p1213-001` Paid 10,000 JPYC with a confirmed LINE push. Kept here because it's the run
with confirmed LINE delivery; the address itself is no longer live.

Read honestly: this is a **historical replay** (the 2022–2025 SST/restriction seasons
pay the live "2026" season slots — `docs/INTERFACE.md`), on **testnet**, with
**demo enrolments**. The current map uses imported fishery-right polygons (#147),
which do not establish farmer ownership or validate those enrolments. A
shipping restriction is evidence of constrained sales, not a measured loss (see
[Honest limitations](#honest-limitations-and-whats-next)).

## Demo script (3 minutes)

| Time | Beat | Shows |
|---|---|---|
| 0:00–0:20 | **Hook.** "Karakuwa's scallop farmers were under a shipping restriction from May to September. Reel Deal demonstrates a rule-based relief payment on Sepolia." | Title card, map of Karakuwa/Kesennuma |
| 0:20–0:50 | **Fund it.** Donor screen, JPYC donation into ReliefPool. "Community-funded relief payments for aquaculture farmers." | `/donate` (web/), `ReliefPool.donate` tx |
| 0:50–1:20 | **The evidence.** Pull up the pinned Miyagi prefecture bulletin; show the sha256 hash matches; show the BANWEEKS count hit 4 weekly checkpoints. "This isn't a vibe — it's a public PDF and a hash anyone can recompute." | Evidence/verification screen, the pinned PDF, `dataHash` |
| 1:20–1:50 | **The gate.** Show Jev's attest-gate decision (confidence 0.53, correctly escalated) and the co-op approval. "Money never moves on a guess — a human co-op signs off when confidence is marginal." | Co-op review screen, Jev decision log (`docs/JEV.md` style JSON line) |
| 1:50–2:20 | **The payout.** Attest tx, then settle: `p1213-001`'s World-ID-verified farmer gets 10,000 JPYC on-screen (Etherscan), the other 7 plots show Held(UNVERIFIED) with a plain-language reason. Show the previously recorded LINE Paid card; do not imply a new push. | Etherscan tx, LIFF wallet screen, real phone with LINE push |
| 2:20–2:50 | **The stack.** One breath each: ENS non-transferable season slot (can't be sold/squatted), World ID caps per human not per wallet, MultiBaas indexed the event and drove the push. | Quick cuts: ENS resolver read, HumanRegistry level badge, MultiBaas dashboard |
| 2:50–3:00 | **Close + honesty beat.** "Historical replay on Sepolia, with public transaction evidence." Link to repo. | End card, GitHub URL |

## Run it locally

```sh
git clone --recurse-submodules https://github.com/reeldeal-xyz/reeldeal.git
cd reeldeal
cp .env.example .env
bun install
(cd pipeline && uv sync)
bun run contracts:build && bun run contracts:test
bun run typecheck
bun run pipeline     # pipeline API on :8787
bun run dev          # web (Next.js/LIFF) on :3000
bun run frontend:dev # Astro app on :4321/hmi
```

## Tests

```sh
bun run test                    # bun run --filter '*' test && pipeline:test (uv run pytest) && forge test
bun run contracts:test          # forge test -vv
bun run e2e                     # fork-mode end-to-end: 8/8 PASS (see below)
```

`bun run e2e` (`scripts/e2e.ts`, merged in [#121](https://github.com/reeldeal-xyz/reeldeal/pull/121)
right before this write-up) forks real Sepolia into a local `anvil`, deploys a throwaway
ReliefPool v2 against the fork with the real `forge script
contracts/script/DeployReliefPoolV2.s.sol`, then runs the real keeper
(`web/src/lib/keeper/run.ts::runKeeper`) twice against the `2026-scallop-banweeks-karakuwa`
event and asserts: it attests; `p1213-001` is Paid exactly its on-chain `perUnit` share;
every other enrolled plot is Held(`UNVERIFIED`); the second run is a no-op; and a
Trigger signed under the old v1 EIP-712 domain is rejected while the same Trigger under
the live v2 domain is accepted. It skips gracefully if `anvil`/`forge` aren't on `PATH`.

Verified by Sailesh on `main` after the rebase: **8/8 PASS** (deploy against the fork, attested, `p1213-001` Paid to the World-ID-verified farmer for exactly `perUnit` = 10,000 JPYC, 7 plots Held(`UNVERIFIED`), idempotent re-run, no JPYC moved on re-run, v1 signature rejected / v2 accepted). ~75 s per run, repeatable. `bun run e2e -- --live --yes` does the same against a fresh pool on real Sepolia (used to create the demo pool `0xB258…43e5`).

## Team

Roles as recorded in the issues/PRs, not job titles:

| Person | GitHub | Role |
|---|---|---|
| Sailesh Sivakumar | [@ss251](https://github.com/ss251) | Identity, ENS, signing/payout policy, contracts, keeper, LIFF wallet; submission owner (#27) |
| Jay Matsushiba | [@JayMatsushiba](https://github.com/JayMatsushiba) | Pipeline/risk data: JAXA + Copernicus ingestion, heat module, PostGIS db service, deploy infra (#75–#82, #110, #111, #114) |
| Justin Diclemente | [@logohere](https://github.com/logohere) | HMI product design/QA/PM: evidence review and product copy, seafood illustrations, Dotdog/ADRs, demo narrative (#32, #36, #40, #85, #87, #93) |
| Eric Manganaro | [@superposition](https://github.com/superposition) | Astro/Storybook frontend, marketplace + relief components and integration — the "Superposition" tracker (#54, SP-01…SP-20) |
| Zenith_Assets | [@zenith0053](https://github.com/zenith0053) | Exploratory "AquaSure Command" risk-dashboard prototype, `prototypes/aquasure-command/` — open PR [#102](https://github.com/reeldeal-xyz/reeldeal/pull/102), not yet merged into `main` |

## Honest limitations and what's next

- **Testnet and replay.** Published proofs are Sepolia transactions from a reference
  restriction event. They do not demonstrate autonomous monitoring or a mainnet launch.
- **Data coverage.** Heat and HAB restriction routes are implemented. Heat/HAB onset
  forecasts and the storm risk module still return `501`; the map's hourly weather
  forecast is advisory and does not attest relief triggers. Reviewed bulletins require
  ingestion updates (`pipeline/src/pipeline/hazards/`).
- **Trigger trust.** The keeper can self-sign pinned inputs when the feed has no signed
  value (`web/src/lib/keeper/run.ts`). This remains a release limitation.
- **Plot rights and ownership.** Imported fishery-right polygons replace the old map
  discs. They are not farmer-verified registrations; ENS season-slot ownership and
  eligibility remain separate. Restrictions do not prove a farm's stock loss or yen loss.
- **Backend deployment.** The native Astro UI is deployed, but signing and LINE services
  still depend on `web/`. Both services must deploy the same shared catalogue.
- **Identity.** My Number Card and passport credentials are not integrated or tested.
  The recorded level-2 proof used World ID Orb; simulator support is a staging path,
  not evidence of production identity verification (`docs/WORLD_DEBRIEF.md`).

Before a real-money launch: independently review contracts and custody/signing operations, validate farmer enrolments and data
freshness, and provide production identity/provider configuration. Those checks are
not satisfied by a successful testnet demo.


## Final demo run (2026-09-27, pool `0xa9F67EA1717D2D068C7Cd4599CEB50755a8A2a68`)

- Hoya heat tier 1 event anchored: `0x081d4738a7661868c8c6f57772bd2b48446ab2d0440bdbc2b47b3f856985933e`
- p1213-009 paid 20,000 JPYC to the verified farmer `0x722Ee41ddc2bFEbF91166CC3dB016cCb452462c7`: `0xd2ea35b94c130e58ad1030f7382c64ff165baf6b44a08af7fd88fb64b72968e2`
- Plots p1213-010..012 held `UNVERIFIED` (claimable for 90 days).
- Market: SaleRouter `0xD7aa137538874D05a375cF3BF152F3Fc57d89296` checkout donated 190 JPYC (5% of 3,800) to the pool.
- World ID in this recording uses the World ID Simulator (staging actions); production actions remain registered.
