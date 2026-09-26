import { z } from 'zod';
import { pipelinePlotCode } from './pipeline-heat';

const plotCode = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
const coordinate = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
const ring = z.array(coordinate).min(4).refine((points) => {
  const first = points[0];
  const last = points.at(-1);
  return first?.[0] === last?.[0] && first?.[1] === last?.[1];
}, 'Polygon rings must be closed');

export const pipelineGeometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) }).strict(),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1)).min(1) }).strict(),
]);

export const pipelinePlotRecord = z.object({
  plotCode: pipelinePlotCode,
  geometry: pipelineGeometry,
  species: z.array(z.string()),
  operation: z.string(),
  seaArea: z.string().nullable(),
  prefecture: z.string().nullable(),
  areaM2: z.number().finite().nonnegative(),
  centroid: coordinate,
  source: z.enum(['msil', 'upload', 'demo', 'fishery_right']),
}).strict();

export const pipelineZoneRecord = z.object({
  id: plotCode,
  name: z.string(),
  nameJa: z.string().nullable(),
  prefecture: z.string(),
  geometry: pipelineGeometry.nullable(),
}).strict();

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** How a layer's tiles are coloured: `min`..`max` (linear or log10) spread evenly over `colors`, clipped at both ends. */
export const pipelineTileScale = z.object({
  kind: z.enum(['linear', 'log']),
  min: z.number().finite(),
  max: z.number().finite(),
  unit: z.string(),
  colors: z.array(hexColor).min(2),
}).strict();

/** Root-relative XYZ template served by the pipeline: /<module>/tiles/<region>/<cadence>/<period>/<layer>/{z}/{x}/{y}.png */
const tileTemplate = z.string().regex(/^\/(heat|hab|storm)\/tiles\/[a-z0-9-]+\/[a-z-]+\/[0-9-]+\/[a-z0-9_]+\/\{z\}\/\{x\}\/\{y\}\.png$/);

/** GET /<module>/layers/{date}: one precomputed layer covering the date. Tiles are display only, never index values. */
export const pipelineLayerInfo = z.object({
  module: z.enum(['heat', 'hab', 'storm']),
  layer: z.string(),
  cadence: z.enum(['daily', 'half-monthly', 'monthly', 'daily-normal']),
  date: isoDay,
  region: z.string(),
  product: z.string(),
  variable: z.string(),
  unit: z.string(),
  bbox: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
  validFraction: z.number().min(0).max(1),
  tileUrl: tileTemplate.nullable(),
  tileScale: pipelineTileScale.nullable(),
  zarrUrl: z.string().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type PipelinePlotRecord = z.infer<typeof pipelinePlotRecord>;
export type PipelineZoneRecord = z.infer<typeof pipelineZoneRecord>;
export type PipelineTileScale = z.infer<typeof pipelineTileScale>;
export type PipelineLayerInfo = z.infer<typeof pipelineLayerInfo>;
