-- migrate:up

-- Reference rows from pipeline/README.md §4. New products get a new migration; ON CONFLICT keeps
-- re-runs harmless. resolution_m is left NULL where the grid spacing is unverified (pipeline Q9);
-- terms_url is filled in once each provider's licence page is checked. layers.module is the module that
-- ingests the product; physics feeds heat, hab and storm alike.

INSERT INTO risk.providers (id, name, terms_url) VALUES
  ('jaxa',  'JAXA Earth API',    NULL),
  ('cmems', 'Copernicus Marine', NULL),
  ('jma',   'Japan Meteorological Agency', NULL),
  ('pref',  'Prefectural fisheries bulletins', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO risk.risk_types (id, name, units) VALUES
  ('heat',  'Heat stress',            'degC'),
  ('hab',   'Harmful algal bloom',    'mixed'),
  ('storm', 'Storm damage',           'mixed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO risk.layers (id, provider_id, module, variable, frequency_days, resolution_m, description) VALUES
  ('JAXA.G-Portal_GCOM-C.SGLI_standard.L3-SST.nighttime.v3_global_daily', 'jaxa', 'heat', 'sst', 1, NULL, 'Primary SST (optical, night)'),
  ('JAXA.G-Portal_GCOM-C.SGLI_standard.L3-SST.daytime.v3_global_daily',   'jaxa', 'heat', 'sst', 1, NULL, 'Primary SST (optical, day)'),
  ('JAXA.G-Portal_GCOM-W.AMSR2_standard.L3-SST.nighttime.v4_global_daily', 'jaxa', 'heat', 'sst', 1, NULL, 'Cloud-gap SST (microwave, night)'),
  ('JAXA.G-Portal_GCOM-W.AMSR2_standard.L3-SST.daytime.v4_global_daily',   'jaxa', 'heat', 'sst', 1, NULL, 'Cloud-gap SST (microwave, day)'),
  ('JMA_COBE-SST-interpolation_SST.v2_global_daily-normal', 'jaxa', 'heat', 'sst_normal', 1, 55000, 'COBE-SST day-of-year normal for SST_ANOM'),
  ('JAXA.G-Portal_GCOM-C.SGLI_standard.L3-CHLA.daytime.v3_global_daily', 'jaxa', 'hab', 'chla', 1, NULL, 'Primary chl-a (optical, day)'),
  ('GLOBAL_ANALYSISFORECAST_PHY_001_024', 'cmems', 'heat', 'physics', 1, 9000, 'T at depth, salinity, currents, MLD, sea level'),
  ('GLOBAL_MULTIYEAR_PHY_001_030',        'cmems', 'heat', 'physics', 1, 9000, 'Physics history, 1993-'),
  ('GLOBAL_ANALYSISFORECAST_BGC_001_028', 'cmems', 'hab',  'bgc',     1, 25000, 'Offshore nutrients and O2 context'),
  ('GLOBAL_ANALYSISFORECAST_WAV_001_027', 'cmems', 'storm', 'waves',  0.125, 9000, 'Hs, periods, direction'),
  ('GLOBAL_MULTIYEAR_WAV_001_032',        'cmems', 'storm', 'waves',  0.125, 9000, 'Wave history')
ON CONFLICT (id) DO NOTHING;

-- migrate:down
