const DAY_MS = 86_400_000;

/**
 * GIBS near-real-time rasters can lag the current date. Use a conservative three-day lag for the current
 * year; past years use the end of the HMI observation season. Never request a future day.
 */
export function hmiLayerDate(season: string, now = new Date()): string {
  const year = Number(season);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('invalid season');
  const currentYear = now.getUTCFullYear();
  if (year < currentYear) return `${season}-10-31`;
  if (year > currentYear) return `${season}-01-01`;
  const lagged = new Date(now.getTime() - 3 * DAY_MS).toISOString().slice(0, 10);
  return lagged < `${season}-01-01` ? `${season}-01-01` : lagged;
}
