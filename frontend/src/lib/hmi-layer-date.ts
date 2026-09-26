const DAY_MS = 86_400_000;

/** A conservative raster request date, not a guarantee that a product has been published for that date. */
export function hmiLayerDate(season: string, now = new Date()): string {
  if (!/^20\d{2}$/.test(season) || !Number.isFinite(now.getTime())) throw new Error('invalid season or date');
  const year = Number(season);
  const currentYear = now.getUTCFullYear();
  if (year > currentYear) throw new Error('future season');
  if (year < currentYear) return `${season}-10-31`;
  const lagged = new Date(now.getTime() - 3 * DAY_MS).toISOString().slice(0, 10);
  return lagged < `${season}-01-01` ? `${season}-01-01` : lagged;
}
