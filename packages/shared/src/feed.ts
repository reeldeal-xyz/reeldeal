// Data contract between the pipeline (Jay) and the app (Sailesh).
// The pipeline writes these as JSON files to pipeline/out/ AND serves them over HTTP (see docs/INTERFACE.md).
// bigint fields are serialized as decimal strings in JSON.
import { z } from 'zod';

export const Source = z.object({
  dataset: z.string(),            // e.g. "jplMURSST41"
  url: z.string().url(),          // exact ERDDAP query URL
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  fetchedAt: z.string(),          // ISO timestamp
  point: z.object({ lat: z.number(), lon: z.number() }).optional(),
});

export const SeriesFile = z.object({
  zone: z.string(),
  season: z.string(),             // "2023"
  source: Source,
  days: z.array(z.object({ date: z.string(), sst: z.number().nullable() })), // date = YYYY-MM-DD
});

export const IndicesFile = z.object({
  zone: z.string(),
  season: z.string(),
  days: z.array(z.object({
    date: z.string(),
    heat24: z.number().int(), heat25: z.number().int(), heat26: z.number().int(), // cumulative within window
    banWeeks: z.record(z.string(), z.number().int()).default({}),               // species -> consecutive weeks
  })),
});

export const TriggerJson = z.object({
  zoneId: z.string(), speciesId: z.string(), perilId: z.string(),
  tier: z.number().int(), seasonLabel: z.string(),
  windowStart: z.string(), windowEnd: z.string(), firedAt: z.string(),
  index: z.number().int(), threshold: z.number().int(),
  dataHash: z.string(), deadline: z.string(),
});

export const TriggersFile = z.object({
  zone: z.string(),
  season: z.string(),
  triggers: z.array(z.object({
    label: z.string(),            // "scallop:2" (species:tier)
    zone: z.string(), species: z.string(), peril: z.string(),
    firedOn: z.string(),          // YYYY-MM-DD
    trigger: TriggerJson,
    signatures: z.array(z.object({ signer: z.string(), signature: z.string() })),
  })),
});

export const BuoyFile = z.object({
  station: z.literal('futatsune'),
  month: z.string(),              // "2026-08"
  source: Source,
  readings: z.array(z.object({ at: z.string(), tempC: z.number() })),
  vsSatellite: z.object({ meanDiffC: z.number(), minDiffC: z.number(), maxDiffC: z.number() }).optional(),
});

export type SeriesFile = z.infer<typeof SeriesFile>;
export type IndicesFile = z.infer<typeof IndicesFile>;
export type TriggerJson = z.infer<typeof TriggerJson>;
export type TriggersFile = z.infer<typeof TriggersFile>;
export type BuoyFile = z.infer<typeof BuoyFile>;
