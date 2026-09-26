import { z } from 'zod';

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
  plotCode,
  geometry: pipelineGeometry,
  species: z.array(z.string()),
  operation: z.string(),
  seaArea: z.string().nullable(),
  prefecture: z.string().nullable(),
  areaM2: z.number().finite().nonnegative(),
  centroid: coordinate,
  source: z.enum(['msil', 'upload', 'demo']),
}).strict();

export const pipelineZoneRecord = z.object({
  id: plotCode,
  name: z.string(),
  nameJa: z.string().nullable(),
  prefecture: z.string(),
  geometry: pipelineGeometry.nullable(),
}).strict();

export type PipelinePlotRecord = z.infer<typeof pipelinePlotRecord>;
export type PipelineZoneRecord = z.infer<typeof pipelineZoneRecord>;
