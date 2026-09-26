-- migrate:up

-- Time-varying outputs (README §4.2): what the pipeline computed, from which pinned inputs.
-- Rasters themselves stay on S3; raster_files is their catalogue.

CREATE TABLE risk.providers (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  terms_url  text
);

CREATE TABLE risk.risk_types (
  id     text PRIMARY KEY CHECK (id IN ('heat', 'hab', 'storm')),
  name   text NOT NULL,
  units  text NOT NULL
);

CREATE TABLE risk.layers (
  id              text PRIMARY KEY,
  provider_id     text NOT NULL REFERENCES risk.providers (id),
  module          text NOT NULL REFERENCES risk.risk_types (id),
  variable        text NOT NULL,
  frequency_days  numeric NOT NULL CHECK (frequency_days > 0),
  resolution_m    numeric CHECK (resolution_m > 0),
  description     text
);

CREATE TABLE risk.pinned_inputs (
  sha256       char(64) PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  url          text NOT NULL,
  fetched_at   timestamptz NOT NULL,
  bytes        bigint NOT NULL CHECK (bytes >= 0),
  storage_uri  text NOT NULL,
  module       text REFERENCES risk.risk_types (id)
);

CREATE TABLE risk.raster_files (
  id            bigserial PRIMARY KEY,
  layer_id      text NOT NULL REFERENCES risk.layers (id),
  date          date NOT NULL,
  grid          text NOT NULL,
  footprint     geometry(Polygon, 4326) NOT NULL,
  storage_uri   text NOT NULL,
  sha256        char(64) NOT NULL,
  input_sha256  char(64) REFERENCES risk.pinned_inputs (sha256),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layer_id, date, grid)
);
CREATE INDEX ON risk.raster_files USING gist (footprint);

CREATE TABLE risk.models (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]+-[0-9]+\.[0-9]+\.[0-9]+$'),
  risk_type_id  text NOT NULL REFERENCES risk.risk_types (id),
  name          text NOT NULL,
  version       text NOT NULL,
  trained_at    timestamptz,
  artifact_uri  text
);

CREATE TABLE risk.model_layers (
  model_id  text NOT NULL REFERENCES risk.models (id),
  layer_id  text NOT NULL REFERENCES risk.layers (id),
  PRIMARY KEY (model_id, layer_id)
);

-- Observed indices. Append-only per module_version; a recomputation adds rows under a new version.
-- NULL value means missing (e.g. cloud), never 0.
CREATE TABLE risk.index_values (
  id              bigserial PRIMARY KEY,
  target_kind     text NOT NULL CHECK (target_kind IN ('plot', 'sea_area')),
  plot_id         uuid REFERENCES geo.plots (id),
  sea_area_id     text REFERENCES geo.sea_areas (id),
  index           text NOT NULL,
  unit            text NOT NULL,
  date            date NOT NULL,
  value           double precision,
  pixel_strategy  text CHECK (pixel_strategy IN ('inside', 'buffer_500m', 'buffer_2km', 'nearest', 'station')),
  pixel_count     integer CHECK (pixel_count >= 0),
  product         text NOT NULL,
  source_sha256   char(64) NOT NULL,
  module_version  text NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((target_kind = 'plot') = (plot_id IS NOT NULL)),
  CHECK ((target_kind = 'sea_area') = (sea_area_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (target_kind, plot_id, sea_area_id, index, date, module_version)
);
CREATE INDEX ON risk.index_values (plot_id, index, date) WHERE plot_id IS NOT NULL;
CREATE INDEX ON risk.index_values (sea_area_id, index, date) WHERE sea_area_id IS NOT NULL;

-- Advisory scores: model outputs, always labelled with their model. Never mixed into index_values.
CREATE TABLE risk.advisory_values (
  id            bigserial PRIMARY KEY,
  target_kind   text NOT NULL CHECK (target_kind IN ('plot', 'sea_area')),
  plot_id       uuid REFERENCES geo.plots (id),
  sea_area_id   text REFERENCES geo.sea_areas (id),
  index         text NOT NULL,
  unit          text NOT NULL,
  date          date NOT NULL,
  horizon_days  integer NOT NULL CHECK (horizon_days >= 0),
  value         double precision,
  p10           double precision,
  p90           double precision,
  model_id      text NOT NULL REFERENCES risk.models (id),
  computed_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((target_kind = 'plot') = (plot_id IS NOT NULL)),
  CHECK ((target_kind = 'sea_area') = (sea_area_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (target_kind, plot_id, sea_area_id, index, date, horizon_days, model_id)
);

CREATE TABLE risk.station_observations (
  station_id     text NOT NULL REFERENCES geo.stations (id),
  variable       text NOT NULL,
  depth_m        numeric NOT NULL DEFAULT 0,
  observed_at    timestamptz NOT NULL,
  value          double precision,
  qc_flag        text,
  source_sha256  char(64) NOT NULL,
  PRIMARY KEY (station_id, variable, depth_m, observed_at)
);

-- HAB bulletins: a restriction per sea area x species x toxin.
CREATE TABLE risk.restrictions (
  id             bigserial PRIMARY KEY,
  sea_area_id    text NOT NULL REFERENCES geo.sea_areas (id),
  species        text NOT NULL,
  toxin          text NOT NULL,
  starts_on      date NOT NULL,
  ends_on        date,
  bulletin_url   text NOT NULL,
  source_sha256  char(64) NOT NULL,
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  UNIQUE (sea_area_id, species, toxin, starts_on)
);

CREATE TABLE risk.storm_events (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  track          geometry(MultiLineString, 4326),
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz,
  source_sha256  char(64) NOT NULL,
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX ON risk.storm_events USING gist (track);

-- Thresholds reference models (README §4.3).
GRANT REFERENCES ON risk.models TO app_migrator;

-- migrate:down
