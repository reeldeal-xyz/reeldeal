// Data contract between the pipeline (Jay) and the app (Sailesh). Mirrors pipeline/README.md §6-§11.
// The pipeline writes these as JSON files to pipeline/out/<module>/ AND serves them over HTTP (see docs/INTERFACE.md).
// The pipeline publishes index values only: no thresholds, statuses or Triggers. Those are built app-side from RULES.
import { z } from 'zod';
import { GEARS, MODULES } from './ids';

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD

const ModuleName = z.enum(MODULES);

/** Provenance of a value: the pinned input it was computed from. `sha256` becomes Trigger.dataHash app-side. */
export const Source = z.object({
  product: z.string(),            // e.g. "SST_GLO_SST_L4_NRT", "hab-bans-miyagi-2025", "jma-tide-ayukawa"
  sha256: Sha256,
  url: z.string().url().optional(),
  fetchedAt: z.string().optional(), // ISO timestamp
});

/** How a plot was sampled (pipeline/README.md §3). */
export const Pixels = z.object({
  strategy: z.enum(['inside', 'buffer_500m', 'buffer_2km', 'nearest', 'station']),
  count: z.number().int(),
  product: z.string(),
  stationId: z.string().optional(), // storm surge: the tide station used
});

/** One observed index value. `index` includes its parameters, e.g. "SST", "T_D10", "HS_HOURS3". */
export const IndexValue = z.object({
  index: z.string(),
  unit: z.string(),               // "days", "degC", "weeks", "m", "hours", "m/s", "km", "z", "bool"
  value: z.number().nullable(),   // null = no valid data
  asOf: IsoDate,
  source: Source,
});

/** One model output. Never observed data; always carries its model version. */
export const AdvisoryValue = z.object({
  index: z.string(),              // index being forecast, or a probability such as "P_BAN_4W"
  horizonDays: z.number().int(),
  value: z.number(),
  p10: z.number().optional(),
  p90: z.number().optional(),
  model_version: z.string(),      // "<model>-<semver>", e.g. "heat-forecast-0.1.0"
});

export const PlotRef = z.object({
  plotCode: z.string().optional(),
  areaM2: z.number(),
  centroid: z.tuple([z.number(), z.number()]), // [lon, lat]
  seaArea: z.string(),
});

/** Response of POST /<module>/risk and GET /<module>/plots/:plot/risk. Same envelope for heat, hab and storm. */
export const RiskResponse = z.object({
  module: ModuleName,
  module_version: z.string(),     // e.g. "heat-0.1.0"
  plot: PlotRef,
  window: z.object({ start: IsoDate, end: IsoDate }),
  pixels: Pixels,
  indices: z.array(IndexValue),
  advisory: z.array(AdvisoryValue).default([]),
});

/** Response of POST /risk: the three module responses merged, no logic of its own. */
export const CombinedRisk = z.object({
  plot: PlotRef,
  heat: RiskResponse,
  hab: RiskResponse,
  storm: RiskResponse,
});

/** indices-<module>-<zone>-<season>.json and GET /<module>/indices/:zone/:season. One series per index. */
export const IndicesFile = z.object({
  module: ModuleName,
  module_version: z.string(),
  zone: z.string(),
  season: z.string(),             // "2025"
  series: z.array(z.object({
    index: z.string(),
    unit: z.string(),
    source: Source,
    days: z.array(z.object({ date: IsoDate, value: z.number().nullable() })),
  })),
});

export const Plot = z.object({
  plotCode: z.string(),
  geometry: z.unknown(),          // GeoJSON Polygon/MultiPolygon, EPSG:4326
  species: z.array(z.string()),
  gear: z.enum(GEARS).optional(),
  seaArea: z.string(),
  prefecture: z.string(),
  source: z.enum(['msil', 'upload']),
});

export const Station = z.object({
  station_id: z.string(),
  name: z.string(),
  source: z.string(),
  type: z.enum(['buoy', 'tide', 'shore', 'research']),
  lat: z.number(),
  lon: z.number(),
  prefecture: z.string(),
  sea_area: z.string().nullable(),
  variables: z.array(z.string()),
  cadence: z.string(),
  url: z.string().url(),
  first_obs: z.string().nullable(),
  last_obs: z.string().nullable(),
});

/** GET /stations/:id/series. Replaces the old Futatsune-only BuoyFile. */
export const StationSeries = z.object({
  station_id: z.string(),
  variable: z.string(),           // "water_temp", "sea_level", "surge", ...
  unit: z.string(),
  source: Source,
  readings: z.array(z.object({ at: z.string(), value: z.number().nullable() })),
});

/** GET /hab/bans. One row per restriction interval, as normalized from prefecture bulletins. */
export const HabBan = z.object({
  pref: z.string(),
  sea_area: z.string(),
  species: z.string(),
  toxin: z.enum(['PSP', 'DSP']),
  level: z.string(),              // the prefecture's own restriction category, as published
  restricted_from: IsoDate,
  lifted_on: IsoDate.nullable(),
  source_url: z.string().url(),
  sha256: Sha256,
});

/** GET /storm/events. */
export const StormEvent = z.object({
  eventId: z.string(),            // e.g. "tc-2025-15" (JMA typhoon number) or "etc-2025-01-12-hokkaido"
  kind: z.enum(['typhoon', 'extratropical']),
  name: z.string().nullable(),
  start: z.string(),              // ISO timestamp
  end: z.string(),
  source: Source,
});

export type Source = z.infer<typeof Source>;
export type Pixels = z.infer<typeof Pixels>;
export type IndexValue = z.infer<typeof IndexValue>;
export type AdvisoryValue = z.infer<typeof AdvisoryValue>;
export type PlotRef = z.infer<typeof PlotRef>;
export type RiskResponse = z.infer<typeof RiskResponse>;
export type CombinedRisk = z.infer<typeof CombinedRisk>;
export type IndicesFile = z.infer<typeof IndicesFile>;
export type TriggerJson = z.infer<typeof TriggerJson>;
export type TriggersFile = z.infer<typeof TriggersFile>;
export type BuoyFile = z.infer<typeof BuoyFile>;
export type Plot = z.infer<typeof Plot>;
export type Station = z.infer<typeof Station>;
export type StationSeries = z.infer<typeof StationSeries>;
export type HabBan = z.infer<typeof HabBan>;
export type StormEvent = z.infer<typeof StormEvent>;
