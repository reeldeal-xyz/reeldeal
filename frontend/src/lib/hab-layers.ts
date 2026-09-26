import type { PipelineLayerInfo } from '@repo/shared';

/** A pipeline tile path as proxied by /api/tiles: <module>/tiles/<region>/<cadence>/<period>/<layer>/<z>/<x>/<y>.png */
const TILE_PATH = /^(hab|heat)\/tiles\/[a-z0-9-]{1,40}\/(daily|daily-normal|half-monthly|monthly)\/(\d{4}-\d{2}-\d{2}|\d{4}-\d{2}|\d{2}-\d{2})\/[a-z0-9_]{1,64}\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.png$/;
export const MAX_TILE_ZOOM = 16;

/** True for a well-formed tile path whose x/y exist at its zoom. Anything else never reaches the pipeline. */
export function validTilePath(path: string): boolean {
  const match = TILE_PATH.exec(path);
  if (!match) return false;
  const [z, x, y] = [Number(match[4]), Number(match[5]), Number(match[6])];
  return z <= MAX_TILE_ZOOM && x < 2 ** z && y < 2 ** z;
}

/** HMI month selector values; chl-a composites exist once JAXA publishes the month. */
export const HAB_MONTHS = ['05', '06', '07', '08', '09', '10'] as const;

export function habMonth(value: string | null): string {
  return HAB_MONTHS.includes(value as (typeof HAB_MONTHS)[number]) ? value! : '08';
}

/**
 * The chl-a layer to show for a month: the monthly composite when built (daily SGLI chl-a is mostly cloud),
 * else the daily layer with the most valid cells. Only layers the pipeline can tile.
 */
export function pickChlLayer(layers: readonly PipelineLayerInfo[]): PipelineLayerInfo | null {
  const tiled = layers.filter((layer) => layer.module === 'hab' && layer.variable === 'CHL' && layer.tileUrl && layer.tileScale);
  const monthly = tiled.find((layer) => layer.cadence === 'monthly');
  if (monthly) return monthly;
  return [...tiled].sort((a, b) => b.validFraction - a.validFraction)[0] ?? null;
}

/** CSS gradient for a tile scale's colour stops, for the legend. */
export function scaleGradient(colors: readonly string[]): string {
  return `linear-gradient(90deg, ${colors.join(', ')})`;
}
