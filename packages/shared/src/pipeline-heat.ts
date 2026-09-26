import { z } from 'zod';

export const pipelineDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
const text = z.string().trim().min(1).max(200);
export const pipelinePlotCode = z.string().regex(/^(?:upload:)?[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
export const pipelineSeason = z.string().regex(/^20\d{2}$/);
const source = z.object({ product: text, sha256: z.string().regex(/^[a-fA-F0-9]{64}$/) }).strict();
const pixels = z.object({
  strategy: z.enum(['inside', 'buffer_500m', 'buffer_2km', 'nearest_pixel']),
  count: z.number().int().positive(),
  product: text,
  distanceKm: z.number().finite().nonnegative().nullable().optional(),
  stationId: z.null().optional(),
}).strict().refine((value) => value.strategy !== 'nearest_pixel' || typeof value.distanceKm === 'number',
  'Nearest-pixel extraction needs a distance');

const reading = z.object({
  index: z.enum(['SST', 'SST_ANOM', 'SST_MONTH']),
  unit: z.literal('degC'),
  value: z.number().finite().nullable(),
  asOf: pipelineDay,
  source: source.nullable(),
  pixels: pixels.nullable().optional(),
}).strict().superRefine((value, ctx) => {
  const valid = value.value === null
    ? value.source === null && value.pixels == null
    : value.source != null && value.pixels != null
      && (value.index === 'SST_ANOM'
        ? value.source.product.startsWith(`${value.pixels.product}-minus-`)
        : value.source.product === value.pixels.product);
  if (!valid) ctx.addIssue({ code: 'custom', message: 'Reading and extraction provenance disagree' });
});

/** The implemented observed heat response; future indices/advisory shapes require an explicit review. */
export const pipelineHeatRisk = z.object({
  module: z.literal('heat'),
  module_version: text,
  plot: z.object({
    plotCode: pipelinePlotCode.nullable(),
    areaM2: z.number().finite().nonnegative(),
    centroid: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]),
    seaArea: text.nullable(),
  }).strict(),
  window: z.object({ start: pipelineDay, end: pipelineDay }).strict(),
  indices: z.array(reading).max(1200),
  advisory: z.tuple([]),
}).strict().superRefine((value, ctx) => {
  if (value.window.start > value.window.end) ctx.addIssue({ code: 'custom', message: 'Reversed window' });
  const previous = new Map<string, string>();
  for (const item of value.indices) {
    if (item.asOf < value.window.start || item.asOf > value.window.end)
      ctx.addIssue({ code: 'custom', message: 'Reading outside window' });
    const last = previous.get(item.index);
    if (last && item.asOf <= last) ctx.addIssue({ code: 'custom', message: 'Duplicate or unordered observations' });
    previous.set(item.index, item.asOf);
  }
});

export type PipelineHeatRisk = z.infer<typeof pipelineHeatRisk>;

export function heatCoverage(data: PipelineHeatRisk) {
  const daily = data.indices.filter((value) => value.index === 'SST');
  const expectedDays = (Date.parse(data.window.end) - Date.parse(data.window.start)) / 86_400_000 + 1;
  const observed = daily.filter((value) => value.value !== null);
  return {
    expectedDays,
    observedDays: observed.length,
    nullDays: daily.length - observed.length,
    omittedDays: expectedDays - daily.length,
    latestObservedDay: observed.at(-1)?.asOf ?? null,
  };
}
