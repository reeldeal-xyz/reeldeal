# Interface contract: pipeline (Jay) ↔ app (Sailesh)

Change it only by PR touching `packages/shared/src/feed.ts` + this file, reviewed by both owners. For the pipeline side, `pipeline/README.md` is the source of truth and overrules this file; keep the two in sync.
Types and zod schemas live in `@repo/shared` (`packages/shared/src`). Everything below is validated with those schemas.

Status after #55: schemas, `Trigger.tempC`, `ReliefPool` and `web/` below reflect
the target risk-index handoff described in this file. The Python pipeline
service that serves these HTTP routes and signs index provenance is still a
FastAPI scaffold; that implementation remains pending under #64/#79.

## Split of responsibilities

| | Pipeline (`pipeline/`, Python + FastAPI) | App + chain (`web/`, `contracts/`, `packages/shared`) |
|---|---|---|
| Does | Ingests ocean data nationally, publishes **risk index values** per plot and sea area, with provenance. Keeps the canonical species reference data (`pipeline/data/ref/species.json`: profiles, response evidence, rule values) and serves it at `/species` | Applies thresholds, tiers and windows (`RULES`, generated from the pipeline's species.json), builds and signs `Trigger`s, attests, pays |
| Never | Evaluates thresholds; statuses, Triggers, signing | Computes indices from raw data; edits the generated rule copy by hand |

The pipeline has three independent hazard modules, each with its own routes and version: **heat** (climate change), **hab** (harmful algal blooms) and **storm** (storm surge, waves, wind).

## Identifiers (`ids.ts`)

| Kind | Labels | On-chain |
|---|---|---|
| Zone | Sea areas (payout unit). Demo: `karakuwa-east`, `kesennuma-bay`; national list to be generated from `pipeline/data/ref/sea_areas` | `keccak256(label)` |
| Species | `nori`, `wakame`, `kombu`, `scallop`, `oyster`, `hoya`, `yellowtail`, `sea-bream`, `salmon`, `bluefin-tuna` | `keccak256(label)` |
| Module | `heat`, `hab`, `storm` | none |
| Index | Per module, see below. Parameters are part of the name (`T_D10`, `HS_HOURS3`) | none |
| Peril | What the chain pays on: `HEAT` (days with SST ≥ the rule's `tempC`), `BANWEEKS` | `keccak256(label)` |
| Season | `"2026"` (fiscal year, 1 Apr to 31 Mar) | string |
| Event | `eventIdOf(zone, species, peril, tier, season)` | `keccak256(abi.encode(...))` |

Indices by module (`INDEX_PATTERNS`):

| Module | Indices |
|---|---|
| heat | `SST` (°C, primary, JAXA), `SST_ANOM` (°C), `T_D{z}` (°C at z m, Copernicus), `MHW_DAYS`, `MHW_INTENSITY`. `HEAT{t}` (days with SST ≥ t °C) is computed on request only, e.g. for the web map |
| hab | `BANWEEKS` (consecutive weeks under shipment restriction, per species), `BAN_ACTIVE`, `REDTIDE_DAYS`, `CHL` (mg/m³, JAXA), `CHL_Z`, `MLD` (m, Copernicus) |
| storm | `MAX_SURGE` (m), `MAX_WATER_LEVEL` (m), `MAX_HS` (m, Copernicus), `HS_HOURS{h}`, `MAX_WAVE_POWER` (kW/m, Copernicus), `MAX_CURRENT` (m/s, Copernicus), `MAX_WIND` (m/s), `TC_DIST` (km) |

Gridded sources: SST and chlorophyll-a come from the JAXA Earth API (GCOM-C SGLI, AMSR2 gap fill, COBE-SST normals); ocean physics and waves come from Copernicus Marine. `source.product` names the exact collection.

## Payloads (`feed.ts`)

| Schema | Where | Content |
|---|---|---|
| `IndicesFile` | `pipeline/out/<module>/indices-<zone>-<season>.json`, `GET /<module>/indices/:zone/:season` | One daily series per index for a sea area, each with `unit` and `source` (product + sha256 of the pinned input) |
| `RiskResponse` | `POST /<module>/risk`, `GET /<module>/plots/:plot/risk` | One module's index values for a plot: window, pixels used, `indices[]`, `advisory[]` |
| `CombinedRisk` | `POST /risk` | `{ plot, heat, hab, storm }`, the three module responses merged |
| `IndexValue` | inside the above | `{ index, unit, value, asOf, source }`. No threshold or status fields |
| `AdvisoryValue` | inside `RiskResponse` | Model output with `model_version`. Never used for payouts |
| `Plot`, `Station`, `StationSeries` | `/plots`, `/stations`, `/stations/:id/series` | Plot inventory (no personal data), station registry, observations. `StationSeries` replaces the old `BuoyFile` |
| `HabBan` | `GET /hab/bans` | Normalized toxin restriction intervals from prefecture bulletins |
| `StormEvent` | `GET /storm/events` | Typhoon / extratropical storm catalogue |

Removed from the feed: `SeriesFile` (SST is now the `SST` index in `IndicesFile`), `TriggersFile` and `BuoyFile`. `TriggerJson` moved to `trigger.ts` because Triggers are app-side.

## ENS layout (issues #7/#10/#11)

Parent name is **`umi.eth`** (checked available on ENSv2 Sepolia 2026-09-26 via
`ETHRegistrar.isAvailable("umi")`; `getRegisterPrice` returned base+premium 640000005 — MockUSDC has 6
decimals, so ~640.000005 MockUSDC, a free-mint testnet token, so real cost is zero). Override via env
`PARENT_LABEL` if it's ever re-registered under a different label.

```
umi.eth                                          <- parent, ETHRegistrar (commit/reveal, MockUSDC)
  karakuwa.umi.eth                               <- branch: UserRegistry + PermissionedResolver (issue #7)
    p1213-NNN.karakuwa.umi.eth (x15)             <- plot: owned by the licence holder, roleBitmap 0,
    │                                                registry = a dedicated per-plot UserRegistry,
    │                                                resolver = the shared karakuwa branch resolver
    └── "2026" (season slot)                     <- owned by the farmer, roleBitmap 0, expiry
                                                     2027-03-31T23:59:59Z, registered on the plot's own
                                                     per-plot registry (not on karakuwa's)
```

15 plots (`docs/ARCHITECTURE.md`'s "p1213-017" was illustrative; the deployed set is
`p1213-001`..`p1213-015`), zone `karakuwa-east` for all, species per issue #16's counts:

| Plots | Species |
|---|---|
| `p1213-001`..`p1213-008` (8) | scallop |
| `p1213-009`..`p1213-012` (4) | hoya |
| `p1213-013`..`p1213-015` (3) | oyster |

Text records on the karakuwa branch resolver, keyed by each plot's full DNS-encoded name (one resolver
instance holds records for every plot — `PermissionedResolver` keys records by name/node, and role scoping
for `setText` is by key only, not by name): `zone`, `species` (science key, scoped by issue #7's
`grantSetterRoles` — that grant already covers every plot, not just karakuwa itself), `area`, `unit`
(deployer/admin only).

**Roles** (`RegistryRolesLib`/`PermissionedResolverLib`, ensdomains/contracts-v2 @
`71a3b7339dbc55ab47667abdfe8303bac4f4c24e`):
- Plot's licence holder holds `ROLE_REGISTRAR | ROLE_UNREGISTER | ROLE_RENEW` (plain bits, no `_ADMIN`
  variants) on `ROOT_RESOURCE` of **their own plot's registry** — enough to `register`/`unregister`/`renew`
  a season slot directly, never to re-delegate those rights.
- Season slots are issued with `roleBitmap 0`: the farmer never holds `ROLE_CAN_TRANSFER_ADMIN`, so any
  transfer of the slot token reverts (`TransferDisallowed`, or `TransferUnsafeUntilRegistryIsEmancipated` for
  the standard `safeTransferFrom` path — the plot registry is never "emancipated" while the holder keeps
  `ROLE_UNREGISTER` at root). Non-transferable by construction, not convention.
- Expiring: ENSv2's own per-registration `expiry`. `findOwner`/`getSubregistry`/`getResolver` all zero out
  once elapsed; `EnsSlotResolver` (issue #11) reads `getState(labelhash).latestOwner`/`.expiry` instead of
  `findOwner`, specifically so an *expired* slot (`REASON_PLOT_EXPIRED`) stays distinguishable from a
  *never-assigned* one (`REASON_NO_FARMER`) — `findOwner` alone collapses both to zero.

**For issues #19/#20** (holder/co-op screens) — the functions and where their ABIs come from:
- Issue slot: `IUserRegistryWrite.register(label, farmer, address(0), address(0), 0, expiry)` on the plot's
  own per-plot registry (`karakuwaRegistry.getSubregistry(plotLabel)` finds it). Same shape as
  `contracts/script/ens/EnsV2.sol`'s `IUserRegistryWrite` — no new ABI needed, that interface already has
  `register`.
- Revoke: `IUserRegistryWrite.unregister(anyId)` on the plot registry, `anyId = uint256(keccak256(bytes(label)))`
  (a labelhash — see `contracts/script/ens/EnsV2.sol`'s doc comment on `anyId`).
- Science key edits `zone`/`species`: `IPermissionedResolverWrite.setText(dnsEncodedName, "zone"|"species", value)`
  on the karakuwa branch resolver (`karakuwaRegistry.getResolver(plotLabel)`), denied for any other key.
- Reads for the co-op table: `ReliefPool.payoutTarget(plotLabel, "2026")` (farmer, plot registry, expiry) and
  `EnsPlotResolver`/branch resolver `resolve(dnsEncodedName, text(...))` for zone/species/area/unit — see
  `contracts/src/adapters/EnsPlotResolver.sol` / `EnsSlotResolver.sol`.
- All of the above interfaces live in `contracts/script/ens/EnsV2.sol` (write side) and
  `contracts/src/interfaces/IEnsV2.sol` (read side); there is no separate ABI export for them yet (no
  TypeScript consumer needed one before #19/#20) — `bun run abi` only exports `ReliefPool`/`HumanRegistry`
  (`packages/shared/src/abi/`), which are unchanged.

## HTTP (pipeline `bun run pipeline`, default `http://localhost:8787`, env `PIPELINE_FEED_URL`)

```
GET  /health                              status and version of each module
GET  /zones                               sea areas
GET  /plots?bbox=&species=   POST /plots  plot inventory
GET  /stations?bbox=&type=                station registry
GET  /stations/:id/series?var=            station observations
POST /risk                                all three modules for one plot

POST /heat/risk     GET /heat/plots/:plot/risk?season=     GET /heat/indices/:zone/:season
GET  /heat/forecast/:plot   GET /heat/layers/:date   GET /heat/climatology/:zone

POST /hab/risk      GET /hab/plots/:plot/risk?season=      GET /hab/indices/:zone/:season
GET  /hab/bans?pref=&season=   GET /hab/redtides?pref=&season=   GET /hab/forecast/:zone   GET /hab/layers/:date

POST /storm/risk    GET /storm/plots/:plot/risk?season=    GET /storm/indices/:zone/:season
GET  /storm/events?season=   GET /storm/events/:event/impact   GET /storm/forecast/:plot   GET /storm/layers/:date
```

Same JSON as the files. CORS open. The web app may also import the files directly for the static demo.

## Index values → Trigger → chain

- The app's keeper reads `GET /<module>/indices/:zone/:season` (or the file) and applies `RULES` from `packages/shared/src/rules.ts`. For `HEAT` it counts days with `SST ≥ rule.tempC` inside `rule.window` from the `SST` series (`heatDays` / `heatFiredOn` in `rules.ts`); for `BANWEEKS` it reads the index directly. On the first day the count reaches `rule.threshold` it builds a `Trigger` with `index` (the count), `threshold`, `tempC` (from the rule; 0 for `BANWEEKS`), `firedAt` and `dataHash` = `0x` + the series' `source.sha256`.
- The temperature is part of the rule, not the peril: there is one `HEAT` peril, and `eventIdOf` stays unique through species and tier (scallop tier 1 at 25 °C, scallop tier 2 at 26 °C, hoya tier 1 at 24 °C). A species + tier can therefore have only one heat temperature per season. `tempC` is signed into the `Trigger` (uint8, whole °C) and emitted in `Attested`, so anyone can recount the days from the pinned SST without `RULES`.
- `Trigger` fields and order: `packages/shared/src/trigger.ts` ⇔ `contracts/src/interfaces/IReliefPool.sol`. `tempC` (uint8) was added after `threshold`; regenerate `packages/shared/src/abi` with `bun run abi` after `forge build`.
- EIP-712 domain: `{ name: "ReliefPool", version: "2", chainId: 11155111, verifyingContract: ReliefPool }`. Version bumped from `"1"` with `tempC` (Trigger v2, #55): a v1 signature can never verify against the v2 contract, and vice versa.
- Who signs is app-side. Whether the pipeline should also sign the index values it publishes is open (`pipeline/README.md` Q2).

## Rules and regression

`RULES`, `REFERENCE_POINT` and `REFERENCE_FIRES` are exported from `packages/shared/src/rules.ts` and applied app-side. The `RULES` values (and `RULES_VERSION`) are canonical in `pipeline/data/ref/species.json` (`pipeline/README.md` §5a). `bun run species:gen` copies them to `packages/shared/src/species.data.json`, and `packages/shared/test/species-drift.test.ts` fails if the copy drifts. Change a rule there, bump `rules_version`, regenerate, and update the contracts' tests and deploy scripts that mirror it. The HMI reads the same values from `GET /species/{id}`. The pipeline publishes the daily `SST` series for the zone containing 38.85N 141.66E. `heatFiredOn(sst, rule)` for each `HEAT` rule must reproduce `REFERENCE_FIRES` exactly. The dates were re-derived on 2026-09-26 from the pipeline's JAXA daily SST series (`pipeline/tests/heat/snapshots/kesennuma-sst-2022-2025.csv`; gap fill SGLI night → SGLI day → AMSR2, `pipeline/README.md` Q10), replacing the NASA MUR dates. `packages/shared/test/reference-fires.test.ts` recomputes them from that snapshot.

| Season | Fires |
|---|---|
| 2022 | none |
| 2023 | scallop tier 1 on 13 Aug, scallop tier 2 on 14 Aug, hoya on 27 Aug |
| 2024 | scallop tier 1 on 5 Sep, hoya on 9 Sep |
| 2025 | scallop tier 1 on 20 Aug, hoya on 31 Aug |

Each SST value carries `source.product` (SGLI or AMSR2). Consumers should keep it with the value so a payout that rests on AMSR2's coarser offshore reading can be shown as such.

Seasons for the replay: `2022`, `2023`, `2024`, `2025` (July to September data), all paying the `"2026"` season slots.
