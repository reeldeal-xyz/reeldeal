-- migrate:up

-- Reference geometry (README §4.1). EPSG:4326; areas, distances and buffers go through ::geography.
-- No personal data in this schema.

CREATE TABLE geo.prefectures (
  code      char(2) PRIMARY KEY CHECK (code ~ '^(0[1-9]|[1-3][0-9]|4[0-7])$'),
  name_ja   text NOT NULL,
  name_en   text NOT NULL,
  geom      geometry(MultiPolygon, 4326) NOT NULL CHECK (ST_IsValid(geom))
);
CREATE INDEX ON geo.prefectures USING gist (geom);

CREATE TABLE geo.sea_areas (
  id              text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  prefecture_code char(2) REFERENCES geo.prefectures (code),
  name_ja         text NOT NULL,
  name_en         text,
  kind            text NOT NULL CHECK (kind IN ('toxin_monitoring', 'red_tide', 'fishery', 'other')),
  geom            geometry(MultiPolygon, 4326) NOT NULL CHECK (ST_IsValid(geom)),
  accuracy        text NOT NULL,
  source_url      text,
  source_sha256   char(64),
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX ON geo.sea_areas USING gist (geom);

CREATE TABLE geo.plots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_code      text NOT NULL,
  origin         text NOT NULL CHECK (origin IN ('msil', 'upload')),
  geom           geometry(MultiPolygon, 4326) NOT NULL CHECK (ST_IsValid(geom)),
  area_m2        double precision GENERATED ALWAYS AS (ST_Area(geom::geography)) STORED,
  centroid       geometry(Point, 4326) GENERATED ALWAYS AS (ST_PointOnSurface(geom)) STORED,
  species        text[] NOT NULL DEFAULT '{}',
  operation      text CHECK (operation IN ('longline', 'raft', 'cage', 'bottom', 'other')),
  sea_area_id    text REFERENCES geo.sea_areas (id),
  source_url     text,
  source_sha256  char(64),
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz,
  retired_at     timestamptz,
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK (origin <> 'upload' OR plot_code LIKE 'upload:%')
);
-- One live plot per code; retired plots keep their code for history.
CREATE UNIQUE INDEX plots_plot_code_live ON geo.plots (plot_code) WHERE retired_at IS NULL;
CREATE INDEX ON geo.plots USING gist (geom);
CREATE INDEX ON geo.plots (sea_area_id);

CREATE TABLE geo.stations (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  source          text NOT NULL,
  type            text NOT NULL CHECK (type IN ('buoy', 'tide', 'shore', 'research')),
  geom            geometry(Point, 4326) NOT NULL,
  prefecture_code char(2) REFERENCES geo.prefectures (code),
  sea_area_id     text REFERENCES geo.sea_areas (id),
  variables       text[] NOT NULL DEFAULT '{}',
  cadence         text,
  url             text,
  first_obs       timestamptz,
  last_obs        timestamptz
);
CREATE INDEX ON geo.stations USING gist (geom);

CREATE TABLE geo.coast_segments (
  id              text PRIMARY KEY,
  prefecture_code char(2) REFERENCES geo.prefectures (code),
  geom            geometry(MultiLineString, 4326) NOT NULL CHECK (ST_IsValid(geom)),
  source_url      text,
  source_sha256   char(64)
);
CREATE INDEX ON geo.coast_segments USING gist (geom);

CREATE TABLE geo.coastal_mask (
  id          serial PRIMARY KEY,
  version     text NOT NULL UNIQUE,
  offshore_km numeric NOT NULL CHECK (offshore_km > 0),
  geom        geometry(MultiPolygon, 4326) NOT NULL CHECK (ST_IsValid(geom)),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON geo.coastal_mask USING gist (geom);

-- Geometry history. Ids stay stable (app.farm and index values point at them); an UPDATE that changes
-- geometry archives the previous row here, so the shape used for any past value can be recovered.
CREATE TABLE geo.sea_areas_history (LIKE geo.sea_areas);
ALTER TABLE geo.sea_areas_history ADD COLUMN archived_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX ON geo.sea_areas_history (id, valid_from);

CREATE TABLE geo.plots_history (
  LIKE geo.plots EXCLUDING GENERATED EXCLUDING CONSTRAINTS EXCLUDING DEFAULTS
);
ALTER TABLE geo.plots_history ADD COLUMN archived_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX ON geo.plots_history (id, valid_from);

CREATE FUNCTION geo.archive_geometry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.geom IS DISTINCT FROM OLD.geom THEN
    EXECUTE format('INSERT INTO %I.%I SELECT ($1).*, now()', TG_TABLE_SCHEMA, TG_TABLE_NAME || '_history')
      USING OLD;
    NEW.valid_from := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER sea_areas_archive BEFORE UPDATE ON geo.sea_areas
  FOR EACH ROW EXECUTE FUNCTION geo.archive_geometry();
CREATE TRIGGER plots_archive BEFORE UPDATE ON geo.plots
  FOR EACH ROW EXECUTE FUNCTION geo.archive_geometry();

-- The app references plots (README §4.3); it may not write them.
GRANT REFERENCES ON geo.plots, geo.sea_areas TO app_migrator;

-- migrate:down
