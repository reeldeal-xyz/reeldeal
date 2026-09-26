-- Bootstrap for db/README.md's `geo` schema (issue #104), scoped to just the two tables the app
-- needs today: `sea_areas` and `plots`. This is an INTERIM seed, not the full #104 importer --
-- #103 (service scaffold: compose/init/roles/pgTAP) has not landed yet, so this runs with the
-- single Railway admin connection instead of the `db_migrator`/`pipeline` roles §5 describes.
--
-- Column names follow db/README.md §4.1 where the shape matches. Two deliberate deviations,
-- called out inline below, because our plot geometry is synthetic (no MSIL polygons exist yet):
--   1. `geo.plots.geom` is `geometry(Geometry, 4326)` (not `MultiPolygon`) so today's synthetic
--      Points and #104's real MultiPolygon rows can coexist in the same column.
--   2. `origin` gains a third value, `synthetic`, alongside spec's `msil`/`upload`.
-- `prefecture_code` on `sea_areas` stores the plain text 'miyagi', not a JIS 2-digit code --
-- `geo.prefectures` (§4.1) doesn't exist yet in this bootstrap, so there is no FK target.
--
-- Retire-not-delete (§4.1): re-running this file only UPDATEs the existing rows (same
-- plot_code/id); nothing is ever deleted. When #104's real importer lands, retire these rows
-- (`retired_at`) rather than dropping them, and insert the real geometry as new rows.
--
-- Idempotent: safe to re-run. Tracks itself in `public.schema_migrations` (dbmate's own table
-- name/shape) so that once #103 wires up the real dbmate binary, it sees this version as already
-- applied and skips it instead of re-running a conflicting CREATE TABLE.

-- migrate:up

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS geo;

CREATE TABLE IF NOT EXISTS geo.sea_areas (
  id              text PRIMARY KEY,               -- zone label, e.g. 'karakuwa-east' (packages/shared/src/ids.ts ZONES)
  prefecture_code text NOT NULL,                   -- interim: plain text 'miyagi', not a JIS code (see header)
  name_ja         text,
  name_en         text,
  kind            text NOT NULL DEFAULT 'toxin_monitoring',
  geom            geometry(MultiPolygon, 4326) NOT NULL,
  accuracy        text,                            -- 'official' | 'approximate, traced from <source>' (§4.1)
  source_url      text,
  source_sha256   text,
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sea_areas_geom_gist ON geo.sea_areas USING GIST (geom);

CREATE TABLE IF NOT EXISTS geo.plots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_code     text NOT NULL UNIQUE,              -- ENS label, e.g. 'p1213-001' (docs/INTERFACE.md)
  ens_name      text,                               -- e.g. 'p1213-001.karakuwa.umi.eth' (not in §4.1; extra, harmless)
  origin        text NOT NULL DEFAULT 'upload' CHECK (origin IN ('msil', 'upload', 'synthetic')),
  synthetic     boolean NOT NULL DEFAULT false,     -- convenience flag mirroring origin='synthetic'
  geom          geometry(Geometry, 4326) NOT NULL,  -- deviation from §4.1's MultiPolygon-only; see header
  area_m2       numeric GENERATED ALWAYS AS (ST_Area(geom::geography)) STORED,
  centroid      geometry(Point, 4326) GENERATED ALWAYS AS (ST_Centroid(geom)) STORED,
  species       text[] NOT NULL,
  operation     text,                               -- 'longline' | 'raft' | 'cage'; unknown for synthetic rows
  sea_area_id   text REFERENCES geo.sea_areas(id),
  prefecture    text NOT NULL DEFAULT 'miyagi',      -- not in §4.1; convenience denorm the app asked for
  source_url    text,
  source_sha256 text,
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_to      timestamptz,
  retired_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plots_geom_gist ON geo.plots USING GIST (geom);

-- Zones: both files under pipeline/data/zones/*.geojson (karakuwa-east currently holds all 15
-- demo plots; kesennuma-bay has none yet but is loaded so the map/API have both sea areas).
INSERT INTO geo.sea_areas (id, prefecture_code, name_ja, name_en, kind, geom, accuracy, source_url, source_sha256)
VALUES
  (
    'karakuwa-east',
    'miyagi',
    '唐桑半島東部',
    'Karakuwa Peninsula East',
    'toxin_monitoring',
    ST_Multi(ST_GeomFromText(
      'POLYGON((141.6332 38.9650, 141.6317 38.9302, 141.655 38.9100, 141.6648 38.8961, 141.6715 38.8611, 141.705 38.8580, 141.700 38.9050, 141.672 38.9320, 141.665 38.9680, 141.6332 38.9650))',
      4326
    )),
    'approximate, traced from https://www.pref.miyagi.jp/documents/37871/kukakun.pdf (宮城海区漁場計画 令和5年一斉更新 区画漁業 北部, page 1 ''区画 No.1 唐桑北部''); not surveyed',
    'https://www.pref.miyagi.jp/documents/37871/kukakun.pdf',
    '7c42494e0106776a34ad5e27e3dbb4ebc61415452efc3da88c5d28df2c58f5fe'
  ),
  (
    'kesennuma-bay',
    'miyagi',
    '気仙沼湾',
    'Kesennuma Bay',
    'toxin_monitoring',
    ST_Multi(ST_GeomFromText(
      'POLYGON((141.660 38.861, 141.6428 38.8934, 141.6232 38.9046, 141.5794 38.9008, 141.590 38.855, 141.6034 38.8284, 141.645 38.838, 141.660 38.861))',
      4326
    )),
    'approximate, traced from https://www.pref.miyagi.jp/documents/37871/kukakun.pdf (宮城海区漁場計画 令和5年一斉更新 区画漁業 北部, pages 2-3 ''区画 No.2 唐桑西部''/''区画 No.3 気仙沼''); not surveyed',
    'https://www.pref.miyagi.jp/documents/37871/kukakun.pdf',
    '7c42494e0106776a34ad5e27e3dbb4ebc61415452efc3da88c5d28df2c58f5fe'
  )
ON CONFLICT (id) DO UPDATE SET
  prefecture_code = EXCLUDED.prefecture_code,
  name_ja = EXCLUDED.name_ja,
  name_en = EXCLUDED.name_en,
  kind = EXCLUDED.kind,
  geom = EXCLUDED.geom,
  accuracy = EXCLUDED.accuracy,
  source_url = EXCLUDED.source_url,
  source_sha256 = EXCLUDED.source_sha256,
  updated_at = now();

-- 15 deployed plots (docs/INTERFACE.md: p1213-001..015, all zone karakuwa-east, 8 scallop / 4 hoya /
-- 3 oyster). Points 001-008 are web/src/fixtures/geo.ts's SYNTHETIC_PLOTS p1-p8 coordinates
-- (that fixture's own labels/zones differ -- it predates the deployed plot list -- so only the
-- lon/lat is reused here, repointed at the canonical labels/species). 009-015 are newly synthesized
-- points in the same cluster (no real geometry exists yet; #104 replaces all of this once MSIL
-- polygons are cleared, D2).
INSERT INTO geo.plots (plot_code, ens_name, origin, synthetic, geom, species, sea_area_id, prefecture)
VALUES
  ('p1213-001', 'p1213-001.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.634, 38.868), 4326), ARRAY['scallop'], 'karakuwa-east', 'miyagi'),
  ('p1213-002', 'p1213-002.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.641, 38.874), 4326), ARRAY['scallop'], 'karakuwa-east', 'miyagi'),
  ('p1213-003', 'p1213-003.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.629, 38.858), 4326), ARRAY['scallop'], 'karakuwa-east', 'miyagi'),
  ('p1213-004', 'p1213-004.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.647, 38.862), 4326), ARRAY['scallop'], 'karakuwa-east', 'miyagi'),
  ('p1213-005', 'p1213-005.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.622, 38.877), 4326), ARRAY['scallop'], 'karakuwa-east', 'miyagi'),
  ('p1213-006', 'p1213-006.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.652, 38.855), 4326), ARRAY['scallop'], 'karakuwa-east', 'miyagi'),
  ('p1213-007', 'p1213-007.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.637, 38.851), 4326), ARRAY['scallop'], 'karakuwa-east', 'miyagi'),
  ('p1213-008', 'p1213-008.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.618, 38.867), 4326), ARRAY['scallop'], 'karakuwa-east', 'miyagi'),
  ('p1213-009', 'p1213-009.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.630, 38.860), 4326), ARRAY['hoya'],    'karakuwa-east', 'miyagi'),
  ('p1213-010', 'p1213-010.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.644, 38.856), 4326), ARRAY['hoya'],    'karakuwa-east', 'miyagi'),
  ('p1213-011', 'p1213-011.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.625, 38.871), 4326), ARRAY['hoya'],    'karakuwa-east', 'miyagi'),
  ('p1213-012', 'p1213-012.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.655, 38.864), 4326), ARRAY['hoya'],    'karakuwa-east', 'miyagi'),
  ('p1213-013', 'p1213-013.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.620, 38.860), 4326), ARRAY['oyster'],  'karakuwa-east', 'miyagi'),
  ('p1213-014', 'p1213-014.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.648, 38.878), 4326), ARRAY['oyster'],  'karakuwa-east', 'miyagi'),
  ('p1213-015', 'p1213-015.karakuwa.umi.eth', 'synthetic', true, ST_SetSRID(ST_MakePoint(141.635, 38.853), 4326), ARRAY['oyster'],  'karakuwa-east', 'miyagi')
ON CONFLICT (plot_code) DO UPDATE SET
  ens_name = EXCLUDED.ens_name,
  origin = EXCLUDED.origin,
  synthetic = EXCLUDED.synthetic,
  geom = EXCLUDED.geom,
  species = EXCLUDED.species,
  sea_area_id = EXCLUDED.sea_area_id,
  prefecture = EXCLUDED.prefecture,
  updated_at = now();

-- migrate:down

DROP TABLE IF EXISTS geo.plots;
DROP TABLE IF EXISTS geo.sea_areas;
