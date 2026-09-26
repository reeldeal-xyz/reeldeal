-- migrate:up

-- Demo data for the deployed ReliefPool plots, until the #104 importers load real geometry.
-- Carried over from #115's interim seed (db/interim/20260926150000_bootstrap_geo.sql):
--   * sea areas karakuwa-east and kesennuma-bay, traced from the Miyagi fishing-ground plan;
--   * plots p1213-001..015 (docs/INTERFACE.md), keyed by ENS label, all in karakuwa-east.
-- The interim seed stored the plots as points. Plots here are polygons, so each point becomes a 50 m
-- radius disc and is marked origin='synthetic'. When real polygons arrive, UPDATE geom and origin in
-- place: ids and codes stay, and the synthetic shape is kept in plots_history.
-- ON CONFLICT DO NOTHING: never overwrites rows a real importer has written.

INSERT INTO geo.sea_areas (id, name_ja, name_en, kind, geom, accuracy, source_url, source_sha256)
VALUES
  (
    'karakuwa-east',
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
ON CONFLICT (id) DO NOTHING;

INSERT INTO geo.plots (plot_code, origin, geom, species, sea_area_id, source_url)
SELECT code, 'synthetic',
       ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, 50)::geometry),
       ARRAY[species], 'karakuwa-east',
       'synthetic: point from web/src/fixtures/geo.ts / #115, buffered 50 m'
FROM (VALUES
  ('p1213-001', 141.634, 38.868, 'scallop'),
  ('p1213-002', 141.641, 38.874, 'scallop'),
  ('p1213-003', 141.629, 38.858, 'scallop'),
  ('p1213-004', 141.647, 38.862, 'scallop'),
  ('p1213-005', 141.622, 38.877, 'scallop'),
  ('p1213-006', 141.652, 38.855, 'scallop'),
  ('p1213-007', 141.637, 38.851, 'scallop'),
  ('p1213-008', 141.618, 38.867, 'scallop'),
  ('p1213-009', 141.630, 38.860, 'hoya'),
  ('p1213-010', 141.644, 38.856, 'hoya'),
  ('p1213-011', 141.625, 38.871, 'hoya'),
  ('p1213-012', 141.655, 38.864, 'hoya'),
  ('p1213-013', 141.620, 38.860, 'oyster'),
  ('p1213-014', 141.648, 38.878, 'oyster'),
  ('p1213-015', 141.635, 38.853, 'oyster')
) AS demo (code, lon, lat, species)
ON CONFLICT (plot_code) DO NOTHING;

-- migrate:down
