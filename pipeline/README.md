# Satellite Imagery Analysis Pipeline for Aquaculture Risk

Owner: Jay. Stack: Python 3.12, FastAPI, xarray. Status: SPEC (draft; open questions are marked `Q#` and listed at the end).

**Precedence:** this README is the source of truth for the pipeline and overrules `docs/` (`INTERFACE.md`, `ARCHITECTURE.md`). Where it diverges, `docs/` and `packages/shared` must be updated to match (see §12). This must be coordinated with the app owner, because the web app and contracts consume that code.

This directory contains the pipeline for satellite imagery analysis of aquaculture risk from climate change (heat stress), harmful algal blooms (HABs) and storm damage. Coverage is **national (all of coastal Japan)**. Analysis is written as plain Python functions and exposed via FastAPI. Outputs are per-plot risk scores and, where a rule fires, signed `Trigger`s for the ReliefPool contract.

## 1. Scope

| Dimension | Decision |
|---|---|
| Geography | All coastal Japan, Hokkaido to Okinawa. Demo and regression region: Kesennuma / Karakuwa (Miyagi). |
| Unit of study | **Aquaculture plot polygon** (GeoJSON, EPSG:4326). Plots roll up to sea area → prefecture → nation. |
| Hazards | Heat stress (SST), HABs (toxin bans + red tides + satellite chl-a), storm damage (waves, wind, typhoons) |
| Operations | Seaweed (nori, wakame, kombu), shellfish (scallop, oyster, hoya), finfish (yellowtail, sea bream, salmon/coho, bluefin tuna) |
| Thresholds | Per operation type and hazard. Set with growers and literature, never tuned to fit the data. |
| Main data | Copernicus Marine, supplemented by higher-resolution nearshore products and national in-situ stations |
| Training | AWS (S3 data lake + SageMaker/EC2) |

Why national: one bay gives a handful of seasons and a single buoy. National coverage gives thousands of plots, hundreds of monitoring stations and decades of toxin-ban and red-tide history across ~39 coastal prefectures. That is enough data to validate satellite data against stations, set per-region bias corrections and train HAB models with real labels.

## 2. Architecture

```
                    ┌────────── ingest (adapters) ──────────┐  ┌─ pin ──┐  ┌──── national grids ────┐  ┌── per plot ──┐  ┌─ outputs ─┐
Copernicus Marine ──┤ SST, chl-a, waves, physics (Zarr/NC)  │  │ raw +  │  │ daily hazard layers on │  │ zonal stats  │  │ risk JSON │
Nearshore sat     ──┤ Himawari SST, GCOM-C chl-a, MUR       ├─>│ sha256 ├─>│ a common coastal grid  ├─>│ → indices    ├─>│ triggers  │
In-situ stations  ──┤ prefecture buoys, JMA, JODC           │  │manifest│  │ (Zarr on S3)           │  │ → rules      │  │ EIP-712   │
HAB bulletins     ──┤ 39 prefectures' 貝毒/赤潮 PDF/HTML/XLS │  │        │  │ + station registry     │  │ → Triggers   │  │ FastAPI   │
Storm             ──┤ JMA best track, warnings              │  │        │  │ + ban-area polygons    │  │              │  │           │
Plot inventory    ──┤ 海しる 区画漁業権 polygons, uploads    │  └────────┘  └────────────────────────┘  └──────────────┘  └───────────┘
                    └───────────────────────────────────────┘                        │
                                                                         AWS: training / bias-correction models (advisory)
```

Principles:

- **Pin before compute.** Every input is stored byte-for-byte (small files in `data/raw/`, large ones in S3) with URL, sha256 and fetch time. Compute reads only pinned inputs.
- **Two paths.**
  - Payout path: deterministic rules on pinned data. Reproducible by anyone, and its `dataHash` commits to the exact inputs.
  - Advisory path: models, forecasts and anomaly scores. These can never fire a Trigger by themselves (`Q6`).
- **Precompute nationally, sample per plot.** Hazard layers are built once per day for the whole coastline. API requests only sample them, with no live satellite calls in the request path.
- **Adapters per source.** Each prefecture and dataset gets a small adapter that normalizes into one schema. Adding coverage means adding an adapter, not changing core code.

## 3. Spatial model

- **Coastal grid:** a common analysis grid covering 24–46°N, 122–149°E, masked to a coastal strip (≤ 30 km offshore, `Q10`), so storage stays small.
- **Plots:**
  - The national inventory comes from 海しる (MSIL, Japan Coast Guard) demarcated fishery-right (区画漁業権) polygons. Check licence and bulk-download terms (`Q4`).
  - Co-ops and farmers can also upload plot polygons through `POST /plots`.
  - The pipeline stores geometry, species, operation type (longline, raft, cage) and plot code. **No owner names or personal data.**
- **Sea areas:** the prefectures' toxin/red-tide monitoring areas, digitized as polygons, are how bulletins map onto plots.
- **Pixel vs plot:** plots are 10²–10³ m across, while grids are 250 m–9 km and often land-masked inside bays. Extraction uses the following order and records which one was used and how many pixels:
  1. Pixels inside the polygon.
  2. Pixels inside a buffered polygon (500 m, then 2 km).
  3. Nearest valid ocean pixel.
- **Zones:** the payout unit on-chain. It becomes a sea area (national list) instead of the two hard-coded Kesennuma zones (§12, `Q1`).

## 4. Data sources

Product IDs are indicative; verify them against the Copernicus catalogue at build time.

| Source | Variables | Resolution | Access | Role |
|---|---|---|---|---|
| Copernicus Marine SST L4 (`SST_GLO_SST_L4_NRT_OBSERVATIONS_010_001`, + REP/MY for history) | SST | 0.05°, daily | `copernicusmarine` toolkit, ARCO Zarr | **Primary** heat layer |
| Copernicus Marine ocean colour (GlobColour L3/L4 chl-a) | chl-a, (Rrs) | ~1–4 km, daily | toolkit | HAB proxy |
| Copernicus Marine waves (`GLOBAL_ANALYSISFORECAST_WAV_001_027`, `GLOBAL_MULTIYEAR_WAV_001_032`) | Hs, Tp, direction | ~0.083°, 3-hourly | toolkit | Storm layer |
| Copernicus Marine physics (global / NW Pacific analysis) | T at depth, currents, MLD, salinity | ~0.083° | toolkit | Heat at cage/longline depth, stratification for HAB |
| NASA MUR SST v4.1 (AWS Open Data Zarr) | SST | 0.01°, daily | S3, no auth | Nearshore heat, legacy Kesennuma regression |
| JAXA Himawari-9 SST (P-Tree) | SST | 2 km, hourly | JAXA account | Nearshore / diurnal heat (`Q11`) |
| JAXA GCOM-C SGLI | chl-a, SST | 250 m, ~daily | G-Portal | Bay-scale HAB proxy (`Q11`) |
| Prefecture fisheries research buoys (e.g. Miyagi Futatsune, Iwate, Hokkaido) | Water temp, salinity, DO | Point, hourly | Per-prefecture sites/CSV | Validation, bias correction |
| JMA coastal / tide stations, JODC | Temp, sea level | Point | Public | Validation, storm surge |
| Prefecture 貝毒 (shellfish toxin) bulletins | Restriction start/end per sea area × species × toxin | Weekly-ish | PDF/HTML/Excel, ~39 prefectures | **HAB payout source** (ban weeks) |
| Red-tide (赤潮) reports: prefectures, FRA, Fisheries Agency | Event, species (e.g. *Karenia*, *Chattonella*), area, fish kills | Event | PDF/HTML | Finfish HAB hazard, training labels |
| JMA RSMC Tokyo best track, warnings | Typhoon track, pressure, wind radii | 6-hourly | Public | Storm hazard |

## 5. Station registry

`stations.parquet` is one national catalogue of every in-situ point we ingest:

`{station_id, name, source, type (buoy|tide|shore|research), lat, lon, prefecture, sea_area, variables, cadence, url, first_obs, last_obs}`

Uses:
- Satellite-vs-station offsets per region and season (generalizes the old `buoy-<month>.json`).
- Bias-correction training (§9).
- Map QA in the web app.

## 6. Hazards, indices and thresholds

All indices are computed per plot per day inside a hazard window, using the extracted pixels (median across pixels unless stated).

| Hazard | Index | Payout-eligible | Notes |
|---|---|---|---|
| Heat | `HEAT{t}`: days with SST ≥ t °C in window (cumulative) | Yes | t depends on operation (e.g. scallop 25/26, hoya 24, wakame/kombu, salmon ~20) |
| Heat | Marine heatwave days (Hobday: > 90th percentile clim., ≥ 5 days) | Candidate (`Q2`) | Needs a 30-year climatology (MY/REP products) |
| HAB | `BANWEEKS`: consecutive weeks under shipment restriction for the species in the plot's sea area | Yes | From bulletins (§7) |
| HAB | Red-tide exposure days (finfish) | Candidate (`Q2`) | From red-tide reports |
| HAB | chl-a anomaly z-score vs climatology | Advisory | Satellite proxy, not toxin |
| Storm | Max Hs, hours Hs ≥ h in window; typhoon passage within r km | Candidate (`Q5`) | h, r depend on gear: longline, raft, cage |

Thresholds live in one table keyed by `(operation, hazard, tier)`, with window, threshold, comparison (`≥`) and source/citation. Rules are data, not code.

## 7. HAB bulletin extraction (national)

1. **Crawl:** one adapter per prefecture discovers bulletin URLs. Downloads are pinned under `data/raw/hab/<pref>/`.
2. **Extract:**
   - Parse HTML tables and Excel directly.
   - Parse PDFs with pdfplumber, falling back to OCR for scanned pages.
   - Normalize wareki dates (令和) and full-width characters.
3. **Normalize:** one row per restriction interval: `{pref, sea_area, species, toxin (PSP|DSP), level, restricted_from, lifted_on, source_url, sha256}`.
4. **Map:** sea-area names become polygons via a reviewed lookup table.
5. **Pin:** the normalized `hab-bans.csv` (per season) is the input whose sha256 goes into `dataHash` for `BANWEEKS` triggers.
6. **Review:** extraction diffs need a human sign-off before signing, because a bad parse moves money. Rows get a confidence flag. OCR or LLM-assisted extraction is allowed but always goes to review.

## 8. Processing and storage

- **Daily job (national):** ingest → pin → regrid to the coastal grid → write hazard layers (Zarr, chunked by time) to S3 → per-plot extraction → indices → rules → Triggers → sign → `out/`.
- **Backfill:** 1993–present where products allow, for climatologies, marine heatwaves and training labels.
- **Size:** coastal-strip masking keeps daily national layers to tens of MB. MUR at 0.01° over the full bounding box is ~24 MB/day float32 unmasked.
- **Orchestration:** a CLI (`pipeline fetch|build|sign|all --date/--season --region`) run by cron or an AWS scheduled task. Keep it simple for the hackathon.

## 9. Models on AWS (advisory path)

National data makes these trainable:

- **Nearshore bias correction:** learn station temperature from satellite + physics features, per region. Improves heat indices inside bays.
- **HAB onset prediction:** predict the probability of a toxin ban or red tide in the next 1–4 weeks per sea area, using SST, chl-a, stratification, season and past bans. Labels come from decades of national bulletins.
- **Heat-threshold forecast:** estimate P(index crosses threshold within 14 days) per plot.

Training data (pinned Zarr/Parquet) lives in S3 and training runs on SageMaker or EC2. Models are versioned, and every score returns its `model_version`. Inference is CPU, inside FastAPI.

## 10. HTTP API (FastAPI, default `:8787`, CORS open)

```
GET  /health
GET  /plots?bbox=&species=                     plot inventory (no personal data)
POST /plots                                    register/upload a plot polygon
POST /risk                                     GeoJSON Feature + operation + date range → hazard indices, status, pixels used, sources
GET  /plots/{plot}/risk?season=                same, for an inventoried plot
GET  /indices/{zone}/{season}                  per-day indices for a sea area (payout unit)
GET  /triggers/{zone}/{season}                 fired rules + signed Triggers
GET  /stations?bbox=  /stations/{id}/series    station registry and observations
GET  /layers/{hazard}/{date}                   layer metadata / tile URL for the web map
GET  /hab/bans?pref=&season=                   normalized toxin restrictions
```

`POST /risk` response sketch:

```jsonc
{
  "plot": { "areaM2": 18200, "centroid": [141.66, 38.85], "seaArea": "miyagi-kesennuma" },
  "operation": { "species": "scallop", "gear": "longline" },
  "pixels": { "heat": { "strategy": "buffer_500m", "count": 3, "product": "SST_GLO_SST_L4_NRT" } },
  "hazards": {
    "heat":  { "index": "HEAT25", "value": 17, "threshold": 14, "status": "exceeded", "source": { "sha256": "…" } },
    "hab":   { "index": "BANWEEKS", "value": 2, "threshold": 4, "status": "watch", "advisory": { "chlAnomalyZ": 2.4, "p_ban_4w": 0.31, "model_version": "hab-0.1" } },
    "storm": { "index": "MAX_HS", "value": 4.1, "threshold": 3.5, "status": "exceeded" }
  }
}
```

## 11. Layout

```
pipeline/
  pyproject.toml                 # uv; console scripts: pipeline, pipeline-serve
  src/pipeline/
    config.py  regions.py        # bbox, coastal mask, sea areas, prefectures
    ids.py                       # keccak labels / eventIdOf, cross-tested vs packages/shared
    thresholds.py                # rules table (data)
    schemas.py                   # pydantic models for all outputs
    sources/                     # copernicus.py, mur.py, himawari.py, gcomc.py, jma.py, stations/<pref>.py
    hab/                         # crawl/<pref>.py, extract.py, normalize.py, seaareas.py
    plots/                       # msil.py (海しる), store.py
    pin.py  grid.py  extract.py  indices.py  triggers.py  sign.py
    models/                      # training entrypoints + inference wrappers
    api.py  cli.py
  data/raw/  data/ref/           # small pinned inputs; reviewed lookup tables
  out/
  tests/
```

## 12. Changes required outside pipeline/

These follow from this spec. Coordinate them with the app owner in one PR:

- `packages/shared/src/ids.ts`: `ZONES` becomes a national sea-area list (or generated from `data/ref/sea_areas`), and `SPECIES` grows. `PERILS` gains any promoted perils.
- `packages/shared/src/rules.ts`: generate it from `thresholds.py`, or read a shared JSON (`Q9`). `REFERENCE_FIRES` is re-derived if heat moves from MUR to Copernicus (`Q13`).
- `packages/shared/src/feed.ts` + `docs/INTERFACE.md`: new risk/plot/station schemas. `BuoyFile` is replaced by station series.
- `Trigger` struct / `IReliefPool.sol`: unchanged if payouts stay per sea area. They change if payouts become per plot (`Q1`).
- Root `package.json`: drop `pipeline` from bun workspaces and point `bun run pipeline` at `uv run` (`Q12`).

## 13. Running

```sh
cd pipeline
uv sync
uv run pipeline all --season 2025 --region miyagi   # or --region japan
uv run pipeline-serve                               # FastAPI on :8787
uv run pytest                                       # includes Kesennuma regression + EIP-712 cross-check vs viem
```

## 14. Open questions

- **Q1** Payout unit: stays per sea area (a plot inherits its sea area's trigger), or per plot (needs a contract + Trigger change)?
- **Q2** Which candidate hazards become payout perils for the demo: marine heatwave, red-tide days, storm? Or keep them advisory?
- **Q3** Species/operation list and who supplies thresholds for seaweed and finfish.
- **Q4** Plot inventory: are 海しる 区画漁業権 polygons usable (licence, bulk access), and are they granular enough (fishery-right areas are often larger than individual plots)?
- **Q5** Storm metric and gear-specific damage thresholds (longline vs raft vs cage).
- **Q6** AWS model priority for the hackathon: bias correction, HAB onset, or heat forecast? Is an advisory-only model acceptable?
- **Q8** Conventions: `≥` vs `>`, SST rounding, `firedAt` in UTC vs JST midnight, `deadline` lifetime, and pixel aggregation (median vs mean vs max).
- **Q9** Single source for rules/ids: Python generates JSON consumed by `packages/shared`, or the reverse?
- **Q10** Coastal mask width, and storage: S3 bucket/region and who pays for it.
- **Q11** JAXA products (Himawari SST, GCOM-C 250 m chl-a) need accounts. Worth it for nearshore resolution?
- **Q12** OK to change the root `package.json` / bun workspace now?
- **Q13** Heat source for payouts: Copernicus L4 (main data, ~5 km, weak in bays) or MUR/Himawari (finer)? This decides the regression targets.
- **Q14** Demo scope: run the full national daily job, or backfill nationally but demo live on a few prefectures?
