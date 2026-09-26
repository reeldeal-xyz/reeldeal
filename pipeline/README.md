# Satellite Imagery Analysis Pipeline for Aquaculture Risk

Owner: Jay. Stack: Python 3.12, FastAPI, xarray. Status: SPEC (draft; open questions are marked `Q#` and listed at the end).

**Precedence:** this README is the source of truth for the pipeline and overrules `docs/` (`INTERFACE.md`, `ARCHITECTURE.md`). Where it diverges, `docs/` and `packages/shared` must be updated to match (see §13). This must be coordinated with the app owner, because the web app and contracts consume that code.

This directory contains the pipeline for satellite imagery analysis of aquaculture risk. Coverage is **national (all of coastal Japan)**. It is split into **three independent hazard modules**, each with its own data, indices, models and API:

| Module | Hazard | Package | API prefix |
|---|---|---|---|
| **Heat** | Climate change: marine heat stress (SST, marine heatwaves) | `pipeline.hazards.heat` | `/heat` |
| **HAB** | Harmful algal blooms: shellfish toxin bans, red tides | `pipeline.hazards.hab` | `/hab` |
| **Storm** | Storm surge, waves and wind from typhoons and extratropical storms | `pipeline.hazards.storm` | `/storm` |

Analysis is written as plain Python functions and exposed via FastAPI. **The output is risk index values** per plot and per sea area, each with the provenance of the inputs it was computed from.

**Out of scope: payouts.** The pipeline does not threshold, grade or decide anything. Payout thresholds, tiers, rule windows, Triggers and signing live on chain and in the app (`contracts/`, `packages/shared/src/rules.ts`). They consume the index values this pipeline publishes. No field in the pipeline's output says "exceeded", "watch" or "fired".

## 1. Scope

| Dimension | Decision |
|---|---|
| Geography | All coastal Japan, Hokkaido to Okinawa. Demo and regression region: Kesennuma / Karakuwa (Miyagi). |
| Unit of study | **Aquaculture plot polygon** (GeoJSON, EPSG:4326). Plots roll up to sea area → prefecture → nation. |
| Hazards | Three separate modules (§6–§8): heat (climate change), HABs, storm surge |
| Operations | Seaweed (nori, wakame, kombu), shellfish (scallop, oyster, hoya), finfish (yellowtail, sea bream, salmon/coho, bluefin tuna) |
| Output | Risk index values with units, time window and input provenance. No thresholds, statuses or payout decisions. |
| Main data | **JAXA Earth API** for SST and chlorophyll-a; **Copernicus Marine** for ocean physics (temperature at depth, salinity, currents, mixed layer, sea level) and waves; JMA and prefectures for surge, typhoons, toxin bans and in-situ stations |
| Training | AWS (S3 data lake + SageMaker/EC2), one model family per module |

Why national: one bay gives a handful of seasons and a single buoy. National coverage gives thousands of plots, hundreds of monitoring stations and decades of toxin-ban and red-tide history across ~39 coastal prefectures. That is enough data to validate satellite data against stations, set per-region bias corrections and train HAB models with real labels.

## 2. Architecture

```
                         ┌──────────────────────── shared core ────────────────────────┐
                         │ pin (sha256 manifest) · coastal grid · plots & sea areas     │
                         │ station registry · pixel extraction · index envelope schema  │
                         └───────────────┬──────────────────┬──────────────────┬───────┘
                                         │                  │                  │
          ┌──────────── heat ────────────┴─┐ ┌──────── hab ───┴─────────────┐ ┌┴─────────── storm ───────────┐
ingest    │ JAXA SST (GCOM-C, AMSR2),      │ │ 39 prefectures' 貝毒/赤潮     │ │ JMA tide stations (潮位偏差),  │
          │ COBE-SST normals,              │ │ bulletins, JAXA GCOM-C chl-a,│ │ JMA best track & warnings,   │
          │ Copernicus physics (T at depth)│ │ Copernicus physics (MLD)     │ │ Copernicus waves, currents   │
layers    │ daily SST / T-at-depth Zarr    │ │ ban intervals + chl-a Zarr   │ │ surge / Hs / wave power Zarr │
indices   │ SST, SST anomaly, MHW days     │ │ BANWEEKS, red-tide days      │ │ MAX_SURGE, MAX_HS, TC_DIST   │
models    │ bias correction, heat forecast │ │ HAB onset                    │ │ surge/wave nowcast, damage   │
API       │ /heat/*                        │ │ /hab/*                       │ │ /storm/*                     │
          └────────────────────────────────┘ └──────────────────────────────┘ └──────────────────────────────┘
                                         │                  │                  │
                                         └──── index values + provenance (JSON) ──┘
                                                            │
                                    app / chain: thresholds, Triggers, payouts (outside pipeline/)
```

Principles:

- **One module per hazard.** Heat, HAB and storm are separate Python packages. Each owns its sources, layers, indices, models and FastAPI router, and has its own version (`module_version`). Modules never import each other; they only depend on the shared core. A module can be built, tested, trained, deployed and served on its own.
- **Shared core only for plumbing.** Pinning, the coastal grid, the plot/sea-area/station registries, pixel extraction and the common output envelope live in `pipeline.core` and are hazard-agnostic.
- **Index values, not decisions.** Modules compute values and stop. Anything that compares a value to a level (thresholds, tiers, statuses, Triggers) belongs to the consumer.
- **Pin before compute.** Every input is stored byte-for-byte (small files in `data/raw/<module>/`, large ones in `s3://…/<module>/`) with URL, sha256 and fetch time. Compute reads only pinned inputs, and every index value carries the sha256 of those inputs so a consumer can reproduce it.
- **Two kinds of output, per module.**
  - Observed indices: deterministic functions of pinned data. Reproducible by anyone.
  - Advisory scores: the module's models, forecasts and anomaly scores. Always labelled with `model_version` and kept separate from observed indices (`Q5`).
- **Precompute nationally, sample per plot.** Each module builds its hazard layers once per day for the whole coastline. API requests only sample them, with no live satellite calls in the request path.
- **Adapters per source.** Each prefecture and dataset gets a small adapter inside the module that uses it. Adding coverage means adding an adapter, not changing core code. Generic download clients (JAXA Earth API, Copernicus Marine toolkit) are plumbing and live in the shared core.
- **Two gridded providers, split by variable.** JAXA Earth API is the only source of the observed SST and chlorophyll-a indices. Copernicus Marine is the only source of physics and wave indices. No observed index mixes the two, so every value's provenance names one provider (advisory models and climate context may use both).

## 3. Spatial model (shared core)

- **Coastal grid:** a common analysis grid covering 24–46°N, 122–149°E, masked to a coastal strip (≤ 30 km offshore, `Q8`), so storage stays small. All three modules write layers on this grid.
- **Plots:**
  - The national inventory comes from 海しる (MSIL, Japan Coast Guard) demarcated fishery-right (区画漁業権) polygons. Check licence and bulk-download terms (`Q3`).
  - Co-ops and farmers can also upload plot polygons through `POST /plots`.
  - The pipeline stores geometry, species, operation type (longline, raft, cage) and plot code. **No owner names or personal data.**
- **Sea areas:** the prefectures' toxin/red-tide monitoring areas, digitized as polygons, are how bulletins map onto plots. Sea-area indices are what an on-chain zone consumes (`Q1`).
- **Pixel vs plot:** plots are 10²–10³ m across, while grids are 250 m–9 km and often land-masked inside bays. Extraction uses the following order and records which one was used and how many pixels:
  1. Pixels inside the polygon.
  2. Pixels inside a buffered polygon (500 m, then 2 km).
  3. Nearest valid ocean pixel.
  4. Storm surge only: nearest tide station on the same coast segment (surge is a point observation, not a gridded field).

## 4. Data sources

Collection and product IDs are as listed on 2026-09-26; verify them against the JAXA Earth API STAC catalogue (`https://data.earth.jaxa.jp/stac/cog/v1/catalog.json`) and the Copernicus Marine catalogue at build time. The **Module** column is the only module allowed to ingest that source.

**Provider split:**
- **JAXA Earth API** (`jaxa.earth` Python package; cloud-optimised GeoTIFF over STAC; no registration or API key; JAXA research-data terms allow commercial use with attribution): **SST and chlorophyll-a.**
- **Copernicus Marine** (`copernicusmarine` toolkit; free account): **ocean physics and waves**: temperature at depth, salinity, currents, mixed-layer depth, sea level, wave height/period/direction and wave energy.

JAXA says Earth API specifications "may change or publication may cease without notice", so every file is pinned on download (§2).

| Source | Variables | Resolution | Access | Module | Role |
|---|---|---|---|---|---|
| JAXA Earth API: GCOM-C SGLI L3 SST v3 (`JAXA.G-Portal_GCOM-C.SGLI_standard.L3-SST.{nighttime,daytime}.v3_global_daily`) | SST | L3 global grid from 250 m / 1 km SGLI (grid spacing to verify, `Q9`), daily; also half-monthly/monthly | JAXA Earth API | heat | **Primary** SST. Optical: no data under cloud |
| JAXA Earth API: GCOM-W AMSR2 L3 SST v4 (`JAXA.G-Portal_GCOM-W.AMSR2_standard.L3-SST.{nighttime,daytime}.v4_global_daily`) | SST | ~0.1–0.25° (microwave), daily | JAXA Earth API | heat | Cloud-gap fill for SGLI. Sees through cloud but is coarse and degraded within tens of km of the coast (`Q10`) |
| JAXA Earth API: JMA COBE-SST daily normal (`JMA_COBE-SST-interpolation_SST.v2_global_daily-normal`) | SST day-of-year normal | 0.5°, per calendar day | JAXA Earth API | heat | Climatology for `SST_ANOM`; context for marine heatwaves (`Q15`) |
| Copernicus Marine physics (`GLOBAL_ANALYSISFORECAST_PHY_001_024`; history `GLOBAL_MULTIYEAR_PHY_001_030`, 1993–) | T at depth (`thetao`), salinity (`so`), currents (`uo`, `vo`), mixed-layer depth (`mlotst`), sea level (`zos`) | 1/12° (~9 km), hourly/daily, 50 depth levels | toolkit, ARCO Zarr | heat, hab, storm | **Primary** physics: `T_D{z}` at gear depth; stratification and MLD for HAB; currents and sea level for storm |
| JMA MOVE-JPN (日本沿岸海況監視予測システム, 4D-Var) | T (surface, 100 m), currents, salinity, sea level | 2 km around Japan, daily + forecast | 海洋の健康診断表 pages; gridded download unconfirmed | heat, hab | Nearshore T at depth and currents (`Q14`) |
| FRA-ROMS II v2 (水産研究・教育機構) | T at depth, currents, salinity | ~1/10°, Pacific + Sea of Japan + East China Sea, daily; hindcast 1993–, 2-month forecast | Public site is map images only; numerical data by application (利用申請) to framodel-admin@ml.affrc.go.jp, aimed at prefectural fisheries institutes; no redistribution without permission | — | **Not used.** Access needs an application and redistribution is prohibited, so it can't feed published indices. Copernicus physics covers the same variables at similar resolution |
| Copernicus Marine biogeochemistry (global analysis/forecast) | chl (model), nitrate, phosphate, O₂, pH, primary production | ~0.25°, daily | toolkit | hab | Offshore nutrient/O₂ context only; too coarse for bays |
| JAXA Earth API: GCOM-C SGLI L3 chl-a v3 (`JAXA.G-Portal_GCOM-C.SGLI_standard.L3-CHLA.daytime.v3_global_daily`) | Chlorophyll-a concentration | L3 global grid from 250 m / 1 km SGLI (grid spacing to verify, `Q9`), daily; also half-monthly/monthly | JAXA Earth API | hab | **Primary** chl-a: `CHL_Z` and HAB features. Optical: no data under cloud |
| Prefecture 貝毒 (shellfish toxin) bulletins | Restriction start/end per sea area × species × toxin | Weekly-ish | PDF/HTML/Excel, ~39 prefectures | hab | **Primary** HAB source (ban weeks) |
| Red-tide (赤潮) reports: prefectures, FRA, Fisheries Agency | Event, species (e.g. *Karenia*, *Chattonella*), area, fish kills | Event | PDF/HTML | hab | Finfish HAB index, training labels |
| JMA tide stations (潮位観測) + astronomical tide predictions | Observed sea level, predicted tide → surge anomaly (潮位偏差) | Point, hourly | Public | storm | **Primary** surge source |
| JMA storm surge warnings / forecasts (高潮警報・高潮予測) | Warning level, forecast surge per coast segment | Event, 3-hourly | Public | storm | Advisory, nowcast labels |
| JMA RSMC Tokyo best track, warnings | Typhoon track, pressure, wind radii | 6-hourly | Public | storm | Storm event catalogue |
| Copernicus Marine waves (`GLOBAL_ANALYSISFORECAST_WAV_001_027`; history `GLOBAL_MULTIYEAR_WAV_001_032`) | Hs (`VHM0`), energy period (`VTM10`), peak period (`VTPK`), direction (`VMDR`) | 1/12°, 3-hourly | toolkit, ARCO Zarr | storm | **Primary** waves: `MAX_HS`, `HS_HOURS{h}`, wave energy (`MAX_WAVE_POWER`) |
| Global Tide and Surge Model reanalysis (Copernicus CDS) | Surge, total water level | Coastal points, 10-min | CDS API | storm | Historical surge, training |
| Prefecture fisheries research buoys (e.g. Miyagi Futatsune, Iwate, Hokkaido) | Water temp, salinity, DO | Point, hourly | Per-prefecture sites/CSV | heat, hab | Validation, bias correction |
| Co-op ICT buoys (NTT Docomo ICTブイ / ウミミル; e.g. 陸奥湾 海況自動観測, 海ナビ＠あおもり) | Water temp (multi-depth), salinity, in-situ chl (fluorescence), DO | Point, hourly | Per-site pages; co-op-owned data, access varies | heat, hab | Nearshore in-situ chl and T validation |
| JMA research vessel sections (e.g. 137°E, Tokara Strait) | T/S profiles, measured chl-a, phaeophytin, DO, nutrients, currents | Ship sections, a few per year | JMA 海洋気象観測 pages | hab | Offshore chl/nutrient validation |
| JODC | Temp, sea level | Point | Public | heat, storm | Validation |

## 5. Station registry (shared core)

`stations.parquet` is one national catalogue of every in-situ point we ingest:

`{station_id, name, source, type (buoy|tide|shore|research), lat, lon, prefecture, sea_area, variables, cadence, url, first_obs, last_obs}`

Modules read from the registry but own their own observation series (e.g. heat reads buoy water temperature, storm reads tide-station sea level). Uses:
- Satellite-vs-station offsets per region and season (generalizes the old `buoy-<month>.json`).
- Model training per module (§6–§8).
- Map QA in the web app.

## 6. Heat module (climate change)

Heat stress from warming seas and marine heatwaves. Hits scallop, hoya, kombu/wakame and cold-water finfish (salmon/coho).

**Indices** (per plot or sea area, per day, median across extracted pixels):

| Index | Unit | Definition |
|---|---|---|
| `SST` | °C | Daily sea surface temperature from JAXA (SGLI night → SGLI day → AMSR2 → null; each value records which, `Q10`). **Primary heat index**: the app counts payout heat days from this series |
| `SST_ANOM` | °C | SST minus the COBE-SST daily normal for that calendar day |
| `T_D{z}` | °C | Daily temperature at gear depth z m (Copernicus physics `thetao`) |
| `MHW_DAYS` | days | Marine heatwave days (Hobday: > 90th percentile climatology, ≥ 5 days). Percentile baseline source open (`Q15`) |
| `MHW_INTENSITY` | °C | Max SST anomaly during the current marine heatwave |

No fixed day-count indices. Payout temperatures (e.g. scallop 25 °C) belong to the app's rules, which count days from `SST` themselves. `POST /heat/risk` accepts an optional `t` and then also returns `HEAT{t}` (days with SST ≥ t °C in the window) as a convenience for the web map; it is never precomputed or stored.

**Models (advisory):**
- `heat-bias`: nearshore bias correction. Learns station temperature from JAXA SST + Copernicus physics features, per region. Improves heat indices inside bays and fills cloud gaps (advisory only).
- `heat-forecast`: 14-day forecast of daily `SST` per plot, with uncertainty.
- Climate context: SST trend and MHW frequency per sea area, for donor-facing reporting. Uses the longest JAXA record available (AMSR2 from 2012, COBE normals) plus Copernicus multiyear physics surface temperature from 1993.

**API** (router mounted at `/heat`):

```
POST /heat/risk                         GeoJSON Feature + date range (+ t) → heat indices, pixels used, sources
GET  /heat/plots/{plot}/risk?season=    same, for an inventoried plot
GET  /heat/indices/{zone}/{season}      per-day heat indices for a sea area
GET  /heat/forecast/{plot}              heat-forecast values (advisory)
GET  /heat/layers/{date}                SST layer metadata / tile URL
GET  /heat/climatology/{zone}           trend and MHW statistics
```

## 7. HAB module

Harmful algal blooms: shellfish toxin (PSP/DSP) shipment bans for shellfish, red tides for finfish.

**Indices** (per sea area, per day; plots inherit their sea area's values):

| Index | Unit | Definition |
|---|---|---|
| `BANWEEKS` | weeks | Consecutive weeks under shipment restriction for a species in the sea area |
| `BAN_ACTIVE` | 0/1 | Restriction in force on the day, per species and toxin |
| `REDTIDE_DAYS` | days | Red-tide exposure days in the sea area (finfish) |
| `CHL` | mg/m³ | Daily chlorophyll-a from JAXA GCOM-C SGLI (null under cloud) |
| `CHL_Z` | z-score | chl-a anomaly vs the SGLI day-of-year climatology (2018–). Satellite proxy, not toxin |
| `MLD` | m | Mixed-layer depth from Copernicus physics (stratification) |

**Bulletin extraction (national):**

1. **Crawl:** one adapter per prefecture discovers bulletin URLs. Downloads are pinned under `data/raw/hab/<pref>/`.
2. **Extract:**
   - Parse HTML tables and Excel directly.
   - Parse PDFs with pdfplumber, falling back to OCR for scanned pages.
   - Normalize wareki dates (令和) and full-width characters.
3. **Normalize:** one row per restriction interval: `{pref, sea_area, species, toxin (PSP|DSP), level, restricted_from, lifted_on, source_url, sha256}`. `level` is the prefecture's own restriction category as published, not a pipeline grade.
4. **Map:** sea-area names become polygons via a reviewed lookup table.
5. **Pin:** the normalized `hab-bans.csv` (per season) is the input whose sha256 goes into the provenance of `BANWEEKS` / `BAN_ACTIVE`.
6. **Review:** extraction diffs need a human sign-off before publication, because consumers act on these values. Rows get a confidence flag. OCR or LLM-assisted extraction is allowed but always goes to review.

**Models (advisory):**
- `hab-onset`: probability of a toxin ban or red tide in the next 1–4 weeks per sea area, from JAXA SST and chl-a, Copernicus stratification (MLD, salinity, currents), season and past bans. Labels come from decades of national bulletins; satellite features exist from 2018 (SGLI).

**API** (router mounted at `/hab`):

```
POST /hab/risk                          GeoJSON Feature + species + date range → HAB indices, sources
GET  /hab/plots/{plot}/risk?season=     same, for an inventoried plot
GET  /hab/indices/{zone}/{season}       per-day ban/red-tide indices for a sea area
GET  /hab/bans?pref=&season=            normalized toxin restrictions
GET  /hab/redtides?pref=&season=        normalized red-tide events
GET  /hab/forecast/{zone}               hab-onset probabilities (advisory)
GET  /hab/layers/{date}                 chl-a layer metadata / tile URL
```

## 8. Storm module (storm surge)

Physical damage from storm surge, waves and wind: longlines and rafts torn loose, cages breached, seaweed stripped. Driven mostly by typhoons (Kyushu, Shikoku, Okinawa, Pacific coast) and winter extratropical storms (Hokkaido, Sea of Japan).

**Indices** (per plot or sea area, per storm event and per day):

| Index | Unit | Definition |
|---|---|---|
| `MAX_SURGE` | m | Max surge anomaly (observed − astronomical tide) at the plot's tide station |
| `MAX_WATER_LEVEL` | m | Max total water level at the tide station |
| `MAX_HS` | m | Max significant wave height at the plot (Copernicus `VHM0`) |
| `HS_HOURS{h}` | hours | Hours with Hs ≥ h m. `h` is a parameter of the index, not a payout level |
| `MAX_WAVE_POWER` | kW/m | Max wave energy flux, P = ρg²/(64π) · Hs² · Te (Copernicus `VHM0`, `VTM10`) |
| `MAX_CURRENT` | m/s | Max surface current speed at the plot (Copernicus `uo`, `vo`) |
| `MAX_WIND` | m/s | Max 10-minute wind at the plot (best-track radii / analysis) |
| `TC_DIST` | km | Closest approach of a typhoon centre to the plot (best track) |

Storm events are defined from the JMA best track and warnings. Event indices use the event's time span; daily indices are also published so consumers can pick their own window (`Q12`).

**Models (advisory):**
- `storm-nowcast`: surge and wave nowcast at plots between tide stations, from Copernicus sea level and waves, winds, pressure and track.
- `storm-damage`: P(gear damage | surge, Hs, wind, gear type). Labels from prefecture/co-op damage reports and 共済 claims statistics where public (`Q11`).

**API** (router mounted at `/storm`):

```
POST /storm/risk                        GeoJSON Feature + gear + date range (+ h) → storm indices, station/pixels used, sources
GET  /storm/plots/{plot}/risk?season=   same, for an inventoried plot
GET  /storm/events?season=              storm event catalogue (typhoons, extratropical storms)
GET  /storm/events/{event}/impact       per-sea-area storm indices for one event
GET  /storm/indices/{zone}/{season}     per-day and per-event storm indices for a sea area
GET  /storm/forecast/{plot}             storm-nowcast / storm-damage values (advisory)
GET  /storm/layers/{date}               surge/Hs layer metadata / tile URL
```

## 9. Processing and storage

- **Daily job, per module:** ingest → pin → regrid to the coastal grid → write the module's layers (Zarr, chunked by time) to `s3://…/<module>/` → per-plot and per-sea-area extraction → indices → `out/<module>/`. Modules run as separate jobs; one failing does not block the others.
- **Backfill:** as far back as each product goes: SGLI SST/chl-a from 2018, AMSR2 SST from 2012, Copernicus multiyear physics and waves from 1993. Used for climatologies, surge and wave history and training labels.
- **Size:** coastal-strip masking keeps daily national layers to tens of MB per module. JAXA Earth API returns cloud-optimised GeoTIFFs clipped to a bounding box, so only the Japan window is downloaded.
- **Orchestration:** a CLI (`pipeline <heat|hab|storm|all> fetch|build|train --date/--season --region`) run by cron or an AWS scheduled task. Keep it simple for the hackathon.

## 10. Models on AWS (advisory)

Each module trains and versions its own models (§6–§8); there is no cross-hazard model.

| Module | Models | Labels |
|---|---|---|
| heat | `heat-bias`, `heat-forecast` | Station temperatures, historical SST |
| hab | `hab-onset` | National toxin-ban and red-tide history |
| storm | `storm-nowcast`, `storm-damage` | Tide-station surge, GTSM reanalysis, damage reports |

Training data (pinned Zarr/Parquet) lives in `s3://…/<module>/training/` and training runs on SageMaker or EC2. Models are versioned as `<model>-<semver>`, and every score returns its `model_version`. Inference is CPU, inside the module's FastAPI router.

## 11. HTTP API (FastAPI, default `:8787`, CORS open)

One FastAPI app mounts the three module routers (§6–§8) plus the shared core routes. Each router can also be served alone (`pipeline-serve --module heat`).

Shared core routes:

```
GET  /health                                   status and version of each module
GET  /plots?bbox=&species=                     plot inventory (no personal data)
POST /plots                                    register/upload a plot polygon
GET  /stations?bbox=&type=                     station registry
GET  /stations/{id}/series?var=                station observations
GET  /zones                                    sea areas
POST /risk                                     convenience: calls /heat/risk, /hab/risk, /storm/risk and merges them; no logic of its own
```

Module response envelope (`POST /heat/risk`; `/hab/risk` and `/storm/risk` use the same envelope):

```jsonc
{
  "module": "heat",
  "module_version": "heat-0.1.0",
  "plot": { "areaM2": 18200, "centroid": [141.66, 38.85], "seaArea": "miyagi-kesennuma" },
  "window": { "start": "2025-07-01", "end": "2025-09-30" },
  "pixels": { "strategy": "buffer_500m", "count": 3, "product": "GCOM-C_SGLI_L3-SST.nighttime.v3" },
  "indices": [
    { "index": "SST", "unit": "degC", "value": 24.6, "asOf": "2025-09-30", "source": { "product": "GCOM-C_SGLI_L3-SST.nighttime.v3", "sha256": "…" } },
    { "index": "SST_ANOM", "unit": "degC", "value": 1.8, "asOf": "2025-09-30", "source": { "product": "GCOM-C_SGLI_L3-SST.nighttime.v3", "sha256": "…" } }
  ],
  "advisory": [
    { "index": "SST", "horizonDays": 14, "value": 23.9, "p10": 22.8, "p90": 25.1, "model_version": "heat-forecast-0.1.0" }
  ]
}
```

`POST /risk` returns `{ "plot": …, "heat": <heat response>, "hab": <hab response>, "storm": <storm response> }`.

## 12. Layout

```
pipeline/
  pyproject.toml                 # uv; console scripts: pipeline, pipeline-serve
  src/pipeline/
    core/                        # shared, hazard-agnostic
      config.py  regions.py      # bbox, coastal mask, sea areas, prefectures
      schemas.py                 # shared pydantic models (plot, station, index envelope)
      pin.py  grid.py  extract.py
      clients/                   # jaxa_earth.py (JAXA Earth API), cmems.py (Copernicus Marine toolkit)
      plots/                     # msil.py (海しる), store.py
      stations/                  # registry.py, <pref>.py adapters
    hazards/
      heat/                      # climate change
        sources/                 # jaxa_sst.py (SGLI, AMSR2), cobe_normal.py, cmems_physics.py
        layers.py  indices.py  schemas.py
        models/                  # bias.py, forecast.py (train + infer)
        api.py                   # APIRouter(prefix="/heat")
      hab/
        sources/                 # jaxa_chla.py (SGLI), cmems_physics.py, cmems_bgc.py
        bulletins/               # crawl/<pref>.py, extract.py, normalize.py, seaareas.py
        layers.py  indices.py  schemas.py
        models/                  # onset.py
        api.py                   # APIRouter(prefix="/hab")
      storm/
        sources/                 # jma_tide.py, jma_besttrack.py, jma_warnings.py, cmems_waves.py, cmems_physics.py, gtsm.py
        events.py  layers.py  indices.py  schemas.py
        models/                  # nowcast.py, damage.py
        api.py                   # APIRouter(prefix="/storm")
    api.py                       # mounts core routes + module routers
    cli.py
  data/raw/<module>/  data/ref/  # small pinned inputs; reviewed lookup tables
  out/<module>/
  tests/core/  tests/heat/  tests/hab/  tests/storm/
```

## 13. Changes required outside pipeline/

These follow from this spec. Coordinate them with the app owner in one PR:

- **Payout logic moves fully to the app / chain.** `RULES` in `packages/shared/src/rules.ts` and the contracts keep the thresholds, tiers and windows. Whatever produces `Trigger`s (keeper, oracle) reads index values from this pipeline and applies them; the pipeline no longer signs or emits Triggers (`Q2`).
- `packages/shared/src/feed.ts` + `docs/INTERFACE.md`: replace `TriggersFile` and the `/triggers/*` route with the index envelope (§11) and per-module routes (`/heat/indices/...`). `BuoyFile` is replaced by `StationSeries`. `SeriesFile` is folded into `IndicesFile` (SST is the `SST` index), which gains `module`, `unit` and `source.sha256` per series.
- `packages/shared/src/ids.ts`: `ZONES` becomes a national sea-area list (or generated from `data/ref/sea_areas`), and `SPECIES` grows. `PERILS` and `eventIdOf` stay app-side; the pipeline only needs index names that match them (`Q7`).
- `REFERENCE_FIRES`: stays app-side. The pipeline's regression target becomes the daily `SST` series at 38.85N 141.66E for 2022–2025, which must reproduce those fire dates under the app's `RULES` (`heatFiredOn` in `rules.ts`) (`Q10`). `REFERENCE_FIRES` was derived from NASA MUR, which is no longer a source, so it must be re-derived from the JAXA SST series and re-agreed with the app owner.
- Perils: `HEAT24` / `HEAT25` / `HEAT26` collapse into one `HEAT` peril. The temperature is a rule field (`tempC`), signed on chain as `Trigger.tempC`, and the app counts days from `SST`.
- `Trigger.dataHash`: the consumer sets it from the `source.sha256` the pipeline returns with each value.
- Root `package.json`: drop `pipeline` from bun workspaces and point `bun run pipeline` at `uv run` (`Q6`).

## 14. Running

```sh
cd pipeline
uv sync
uv run pipeline all --season 2025 --region miyagi     # or --region japan
uv run pipeline heat build --season 2025 --region miyagi
uv run pipeline-serve                                 # all modules on :8787
uv run pipeline-serve --module storm                  # one module alone
uv run pytest                                         # includes Kesennuma heat index regression
uv run pytest tests/hab                               # one module's tests
```

## 15. Open questions

- **Q1** Consumer granularity: does the chain read sea-area indices (a plot inherits its sea area's value) or per-plot indices?
- **Q2** Delivery to chain: does the consumer fetch index values over HTTP, or does it need them signed/attested by the pipeline (a signed index value, not a Trigger)?
- **Q3** Plot inventory: are 海しる 区画漁業権 polygons usable (licence, bulk access), and are they granular enough (fishery-right areas are often larger than individual plots)?
- **Q4** Species/operation list, and which index parameters (`h` for `HS_HOURS{h}`, depth z for `T_D{z}`) to precompute.
- **Q5** AWS model priority for the hackathon: which module's model first (heat bias/forecast, HAB onset, storm nowcast/damage)?
- **Q6** OK to change the root `package.json` / bun workspace now?
- **Q7** Single source for index names and ids: Python generates JSON consumed by `packages/shared`, or the reverse?
- **Q8** Coastal mask width, and storage: S3 bucket/region and who pays for it.
- **Q9** JAXA Earth API coverage: what is the grid spacing of the global daily L3 SGLI SST and chl-a collections (250 m, 1 km or coarser), and does the v3 daily record start in 2018 or 2024 (the STAC metadata disagrees)? If the grid is too coarse for bays, is Himawari SST / chl-a from P-Tree (registration, 72 h NRT retention) an acceptable second JAXA source?
- **Q10** Daily `SST` from JAXA: SGLI is optical, so summer cloud (tsuyu, typhoons) leaves gaps exactly when heat matters. Proposed order: SGLI night → SGLI day → AMSR2 → null. Is AMSR2 near the coast acceptable, or should gaps stay null (then the app counts fewer days)? This decides the regression series and the re-derived `REFERENCE_FIRES`. Also conventions: SST rounding (the app counts `≥ tempC`), day boundary in UTC vs JST, and pixel aggregation (median vs mean vs max).
- **Q11** Storm damage labels: are prefecture/co-op damage reports or 漁業共済 claims statistics available at sea-area resolution?
- **Q12** Storm indices per event or per day: which does the consumer need, and how is a storm event identified across systems?
- **Q13** Demo scope: run the full national daily job for all three modules, or backfill nationally but demo live on a few prefectures and one or two modules?
- **Q14** Does JMA MOVE-JPN publish machine-readable gridded output (and under what licence), or only maps? If gridded, it could supplement Copernicus physics nearshore. (FRA-ROMS II is resolved: application-only, not used.)
- **Q15** Marine heatwave baseline: Hobday needs a 30-year daily 90th percentile. COBE-SST daily normals in the Earth API give the mean only, and JAXA satellite SST starts in 2012 (AMSR2) / 2018 (SGLI). Compute percentiles from Copernicus multiyear physics surface temperature (1993–), or drop `MHW_DAYS` to advisory?
