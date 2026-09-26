# Database: PostgreSQL/PostGIS service (SPEC)

This is the spec for the database. The database is its own service, deployed and upgraded separately from the pipeline API (`pipeline/`) and the Astro app (`frontend/`). Both of those are clients. Open questions are tagged `D1`, `D2` and so on; see §11.

## 1. Scope and principles

- **All spatial data lives in PostGIS.** This covers plots, sea areas, stations, coast segments and the coastal mask, plus every time series attached to them: index values, advisory scores, station observations and restrictions. The Parquet/GeoJSON files that the pipeline README uses today become import sources, not stores.
- **Rasters stay on S3.** The daily gridded layers (Zarr/COG under `s3://$PIPELINE_S3_BUCKET/<module>/`) are too large for the database and are read by xarray anyway. PostGIS keeps a catalogue of them (product, date, footprint, S3 URI, sha256), so every raster can be found and checked from SQL.
- **The pipeline computes and the database stores.** The pipeline reads pinned inputs and rasters, computes values and writes rows. It has no DDL rights and does not host the database. The database does not compute indices.
- **Every schema has one writer.** Only the owning role writes to a schema; other roles get explicit read (and `REFERENCES`) grants.
- **No personal data in `geo` or `risk`:** plot codes, geometry, species, operation type, station metadata and numbers only. Farmer records belong to `app` (§4.3).
- **Deploying the pipeline never restarts the database.** They are separate Compose projects with separate deploy workflows.

## 2. Service

| | |
|---|---|
| Image | `postgis/postgis:16-3.4` (pinned by digest in `db/docker-compose.yml`) |
| Extensions | `postgis`, `pg_stat_statements`. Add `btree_gist` only if exclusion constraints need it. |
| Compose project | `db/docker-compose.yml`, project name `reeldeal-db` |
| Network | External Docker network `reeldeal`. Clients connect to `db:5432`. |
| Ports | None public. `127.0.0.1:5432` on the host for admin access over SSM port forwarding. |
| Data | Bind mount `/srv/pgdata` on a **dedicated EBS gp3 volume** (20 GB), separate from the root volume and the pipeline's `data/` and `out/` |
| Config | `db/postgresql.conf`, sized for a shared 4 GB host: `shared_buffers=512MB`, `work_mem=16MB`, `max_connections=50` (`D1`) |
| Health | `pg_isready` healthcheck. `restart: unless-stopped`. |
| Secrets | `db/.env` on the server only (role passwords). Never committed. |

The pipeline's and app's Compose projects join the `reeldeal` network as `external: true`. Nothing else links the three projects.

## 3. Layout

```
db/
  README.md                 # this spec
  docker-compose.yml        # db, migrate (one-shot), backup (cron sidecar)
  postgresql.conf
  .env.example              # POSTGRES_PASSWORD, role passwords, PIPELINE_S3_BUCKET
  init/                     # runs once on an empty data dir
    00-extensions.sql
    01-roles.sql            # roles with NOLOGIN; passwords set from .env by 02
    02-role-passwords.sh
  migrations/               # dbmate, plain SQL, forward-only
    2026xxxx_schemas.sql
    2026xxxx_geo.sql
    2026xxxx_risk.sql
  seeds/                    # idempotent reference seeds (providers, risk types)
  scripts/
    backup.sh  restore.sh  psql.sh
  tests/                    # SQL tests (pgTAP) for grants and constraints
```

Migrations use **dbmate**: plain SQL that works from any language and ships as a single binary with a Docker image. This replaces the Alembic plan for `risk` in PR #30 and ADR 0004, because the database no longer lives in the pipeline's Python project. The `app` schema keeps Drizzle in `packages/app-core` (#62) and runs after dbmate (§6).

## 4. Schemas

| Schema | Holds | Owner (DDL) | Writer (DML) | Readers |
|---|---|---|---|---|
| `geo` | Reference geometry: plots, sea areas, stations, coast segments, coastal mask, prefectures | `db_migrator` | `pipeline` | `app`, `readonly` |
| `risk` | Time-varying outputs: pinned inputs, raster catalogue, index and advisory series, observations, restrictions, models | `db_migrator` | `pipeline` | `app`, `readonly` |
| `app` | Farm, AquacultureFarmer, Species, Equipment, Threshold, Event, Fund, Transaction, Buyer, Donor (#59, #62) | `app_migrator` | `app` | `readonly` (no PII columns, `D5`) |

**CRS:** geometry is stored as `geometry(MultiPolygon|Point|MultiLineString, 4326)`. Areas, distances and buffers (the 500 m and 2 km extraction buffers) use `::geography`, because Japan spans many JGD2011 plane zones. Every geometry column has a GiST index.

### 4.1 `geo`

| Table | Key columns |
|---|---|
| `prefectures` | `code` (JIS 01–47) PK, `name_ja`, `name_en`, `geom` MultiPolygon |
| `sea_areas` | `id` text PK (e.g. `miyagi-kesennuma`), `prefecture_code`, `name_ja`, `name_en`, `kind` (`toxin_monitoring`, `red_tide`, …), `geom` MultiPolygon, `accuracy` (`official`, `approximate, traced from <source>`), `source_url`, `source_sha256`, `valid_from`, `valid_to` |
| `plots` | `id` uuid PK, `plot_code` text UNIQUE (fishery-right code, or `upload:<uuid>`), `origin` (`msil`, `upload`), `geom` MultiPolygon, `area_m2` (generated from geography), `centroid` Point (generated), `species` text[], `operation` (`longline`, `raft`, `cage`, …), `sea_area_id` FK, `source_url`, `source_sha256`, `valid_from`, `valid_to`, `retired_at` |
| `stations` | `id` text PK, `name`, `source`, `type` (`buoy`, `tide`, `shore`, `research`), `geom` Point, `prefecture_code`, `sea_area_id`, `variables` text[], `cadence`, `url`, `first_obs`, `last_obs` |
| `coast_segments` | `id` PK, `geom` MultiLineString, `prefecture_code`. Storm surge uses these to match plots to tide stations. |
| `coastal_mask` | `id`, `version`, `offshore_km` (`Q8`), `geom` MultiPolygon: the coastal strip that the pipeline's grid is masked to |

Rows are never hard-deleted. Plots and sea areas are retired with `valid_to`/`retired_at` so that historical index values keep their geometry. A changed geometry becomes a new row. `app.farm` references `geo.plots(id)` (ADR 0004: one writable copy of geography).

### 4.2 `risk`

| Table | Key columns |
|---|---|
| `providers` | `id` PK (`jaxa`, `cmems`, `jma`, `pref-miyagi`, …), `name`, `terms_url` |
| `risk_types` | `id` PK (`heat`, `hab`, `storm`), `units` |
| `layers` | `id` PK (product id, e.g. `GCOM-C_SGLI_L3-SST.nighttime.v3`), `provider_id`, `module`, `variable`, `frequency_days`, `resolution_m` |
| `pinned_inputs` | `sha256` PK, `url`, `fetched_at`, `bytes`, `storage_uri` (`s3://…` or `data/raw/…`), `module` |
| `raster_files` | `id` PK, `layer_id`, `date`, `footprint` Polygon, `grid` (`coastal-v1`), `storage_uri`, `sha256`, `input_sha256` FK → `pinned_inputs`. UNIQUE (`layer_id`, `date`, `grid`). |
| `models` | `id` PK (`heat-forecast-0.1.0`), `risk_type_id`, `name`, `version`, `trained_at`, `artifact_uri` |
| `model_layers` | (`model_id`, `layer_id`): the "reads inputs" relation from PR #30 |
| `index_values` | `id` bigserial, `target_kind` (`plot`, `sea_area`), `plot_id`, `sea_area_id`, `index` (`SST`, `SST_ANOM`, …), `unit`, `date`, `value` (NULL means missing, never 0), `pixel_strategy`, `pixel_count`, `product`, `source_sha256`, `module_version`, `computed_at`. UNIQUE (target, `index`, `date`, `module_version`). |
| `advisory_values` | Same target and date columns, plus `horizon_days`, `value`, `p10`, `p90`, `model_id`. Deliberately separate from `index_values` (pipeline `Q5`). |
| `station_observations` | `station_id`, `variable`, `depth_m`, `observed_at`, `value`, `qc_flag`, `source_sha256`. PK (`station_id`, `variable`, `depth_m`, `observed_at`). Partitioned by year if it grows past a few million rows (`D3`). |
| `restrictions` | HAB bulletins: `sea_area_id`, `species`, `toxin`, `starts_on`, `ends_on`, `bulletin_url`, `source_sha256` |
| `storm_events` | `id`, `name`, `track` MultiLineString, `starts_at`, `ends_at`, `source_sha256` |

`index_values` is append-only. A recomputation under a new `module_version` adds rows and never overwrites. The API serves the latest `module_version` unless a version is requested, so any value a Trigger was built from can still be reproduced from its `source_sha256`.

### 4.3 `app`

Defined by #59 and implemented by #62 in Drizzle. This spec fixes only the interface:

- `app.farm.plot_id uuid REFERENCES geo.plots(id)` replaces `Farm.location` from the PR #30 ER diagram. A farm without a fishery-right polygon gets an uploaded plot through the pipeline's `POST /plots`, so geometry is still written by one role.
- `app.threshold.risk_model_id REFERENCES risk.models(id)`.
- Species ids are shared text codes (`packages/shared/src/ids.ts`, `D4`).
- Farmer personal data stays in `app`, in columns that `readonly` cannot select.

## 5. Roles

All roles are created by `init/01-roles.sql`. Passwords come from `db/.env`.

| Role | Login | Rights |
|---|---|---|
| `postgres` | Local socket only | Superuser. Bootstrap and emergencies only. |
| `db_migrator` | Yes | Owns `geo` and `risk`. Runs dbmate. |
| `pipeline` | Yes | `SELECT, INSERT, UPDATE` on `geo.*` and `risk.*`. No `DELETE` (retire instead), no DDL. |
| `app_migrator` | Yes | Owns `app`. Runs Drizzle migrations. `USAGE` + `REFERENCES` on `geo.plots` and `risk.models`. |
| `app` | Yes | DML on `app.*`. `SELECT` on `geo.*` and `risk.*`. |
| `readonly` | Yes | `SELECT` on `geo.*`, `risk.*` and non-PII `app` views. For dashboards, QA and Dotdog. |

`ALTER DEFAULT PRIVILEGES` in each migration keeps grants correct for new tables. `db/tests/` asserts the matrix: `pipeline` cannot write `app`, `app` cannot write `geo`, `readonly` cannot read PII.

## 6. Migrations and startup order

1. `db` starts and becomes healthy. `init/` runs only on an empty data directory.
2. The `migrate` one-shot (`docker compose run --rm migrate up`, dbmate as `db_migrator`) applies `geo`/`risk` migrations and reference seeds.
3. The app's Drizzle migrations run as `app_migrator` in the app's deploy (#62/#71). They can depend on `geo`/`risk` tables but never alter them.
4. The pipeline and app start. Each checks at startup that the schema version it needs is present (`schema_migrations`) and reports it in `/health`.

Migrations are forward-only and must not break the currently deployed clients (expand, then contract across two deploys).

## 7. Clients

| Client | Role | Env | Access |
|---|---|---|---|
| Pipeline CLI (daily build, imports) | `pipeline` | `DATABASE_URL` in `pipeline/.env` | Writes `geo` (imports, `POST /plots`) and `risk` (catalogue, indices, observations) |
| Pipeline API | `pipeline` | same | Reads `geo`/`risk` to answer `/plots`, `/zones`, `/stations`, `/<module>/risk`. Writes only on `POST /plots`. |
| Astro app / keeper | `app` | `DATABASE_URL` in the app's `.env` (`frontend/astro.config.mjs` already declares it) | `app` DML. Reads risk values through the pipeline API (the typed contract, #79), not SQL, unless #55 decides otherwise (`D6`). |
| Humans / QA | `readonly` | SSM port forward to `127.0.0.1:5432` | Read only |

The pipeline uses `psycopg` 3 with a small connection pool and `shapely` for geometry, with no ORM. Plot/pixel extraction stays in Python (xarray on rasters, polygons from `geo.plots`).

## 8. Local development

```sh
bun run db:up        # docker compose -f db/docker-compose.yml up -d --wait, then migrate
bun run db:psql      # psql as db_migrator
bun run db:reset     # drop the local volume, re-init, migrate, seed
```

Local development uses a named volume and `db/.env.example` passwords. Pipeline tests run against this database (or a throwaway one in CI via a `services: postgres` container using the same image), never against the shared server.

## 9. Deployment (EC2)

- Same instance as the pipeline (`pipeline/DEPLOY.md`), in its own directory: `/home/ubuntu/reeldeal/db`.
- One-time setup: attach a 20 GB gp3 EBS volume, format it, mount it at `/srv/pgdata` through fstab, `docker network create reeldeal`, and write `db/.env`.
- `.github/workflows/deploy-db.yml` triggers on pushes to `main` that touch `db/**`. It runs the pgTAP/grant tests against a CI Postgres, then, over the same OIDC + SSM path as `deploy-pipeline.yml`, runs `cd db && docker compose up -d --wait && docker compose run --rm migrate up`. It fails if `pg_isready` or the migration fails.
- `deploy-pipeline.yml` does not touch `db/`. The pipeline's Compose file adds `networks: [reeldeal]` and a `DATABASE_URL` only.
- Memory: Postgres, the pipeline API, the xarray daily build and Astro share 4 GB. Upgrade to `t3.large` before the app moves onto the host (`D1`).

## 10. Backup and restore

- The `backup` sidecar runs nightly at 02:00 JST, before the pipeline's 03:00 build: `pg_dump -Fc` as `postgres` to `s3://$PIPELINE_S3_BUCKET/db/<YYYY-MM-DD>.dump` using the instance role. An S3 lifecycle rule keeps 14 dailies.
- Rasters and pinned inputs are already on S3 and are not in the dump. The dump holds their catalogue rows.
- `scripts/restore.sh <date>` restores into a scratch database and runs the grant tests plus row-count checks. It is rehearsed before the demo (#71). An EBS snapshot of `/srv/pgdata` before each migration deploy is a cheap second line of defence.

## 11. Open questions

- **D1** Instance size: stay on `t3.medium` with tight Postgres settings, or move to `t3.large` now? Who pays?
- **D2** MSIL (海しる) fishery-right polygons: licence and bulk-download terms (pipeline `Q3`) decide whether national plots can be stored and served.
- **D3** Station observation volume nationally (hourly × stations × depths): is yearly partitioning needed for the demo, or later?
- **D4** Species and sea-area ids: does `geo.sea_areas` / the species list become the source that `packages/shared/src/ids.ts` is generated from (pipeline `Q7`)?
- **D5** Farmer personal data in `app`: retention period, and whether it is encrypted at rest beyond the EBS default.
- **D6** Does the app ever read `risk` tables directly (for example for map tiles), or only through the pipeline API? Direct reads bypass the OpenAPI contract.
- **D7** RDS later: after the hackathon, move to RDS for PostgreSQL with PostGIS. The roles and dbmate migrations carry over unchanged.
