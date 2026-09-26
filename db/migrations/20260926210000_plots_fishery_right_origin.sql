-- migrate:up

-- origin 'fishery_right': a licensed 区画漁業権 area whose polygon comes from the licence's own vertex
-- list (e.g. the Fisheries Agency's per-prefecture 区画漁業権に関する情報一覧), not from 海しる.
-- source_url says which list. plot_code is '<JIS prefecture code>-ku-<licence number>', e.g. 04-ku-1101.
ALTER TABLE geo.plots DROP CONSTRAINT plots_origin_check;
ALTER TABLE geo.plots ADD CONSTRAINT plots_origin_check
  CHECK (origin IN ('msil', 'upload', 'synthetic', 'fishery_right'));

-- migrate:down
