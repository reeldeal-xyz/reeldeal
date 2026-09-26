import type { Peril, Species } from './ids';

/**
 * Provisional trigger rules (writeup v3, section 7.3). Thresholds are set with growers; do not tune to data.
 * Thresholds live here and on chain only. The pipeline publishes index values and never applies these.
 */
export interface Rule {
  species: Species;
  tier: 1 | 2;
  peril: Peril;
  /** HEAT only: a day counts when daily SST >= tempC (whole °C, uint8). Goes into Trigger.tempC; 0 for other perils. */
  tempC?: number;
  /** Minimum index value: days at or above tempC for HEAT, consecutive weeks for BANWEEKS. Goes into Trigger.threshold. */
  threshold: number;
  /** Season window for HEAT, inclusive, MM-DD. */
  window?: { start: string; end: string };
}

export const HEAT_WINDOW = { start: '07-01', end: '09-30' } as const;

export const RULES: readonly Rule[] = [
  { species: 'scallop', tier: 1, peril: 'HEAT', tempC: 25, threshold: 14, window: HEAT_WINDOW },
  { species: 'scallop', tier: 2, peril: 'HEAT', tempC: 26, threshold: 12, window: HEAT_WINDOW },
  { species: 'hoya', tier: 1, peril: 'HEAT', tempC: 24, threshold: 30, window: HEAT_WINDOW },
  { species: 'oyster', tier: 1, peril: 'BANWEEKS', threshold: 4 },
  { species: 'scallop', tier: 1, peril: 'BANWEEKS', threshold: 4 },
] as const;

/**
 * HEAT index for one rule: cumulative days with SST >= tempC inside the window, per day.
 * `days` is the pipeline's daily SST series (IndicesFile series with index "SST"); null SST days do not count.
 */
export const heatDays = (
  days: readonly { date: string; value: number | null }[],
  tempC: number,
  window: { start: string; end: string },
): { date: string; value: number }[] => {
  let count = 0;
  return days
    .filter(({ date }) => date.slice(5) >= window.start && date.slice(5) <= window.end)
    .map(({ date, value }) => {
      if (value !== null && value >= tempC) count += 1;
      return { date, value: count };
    });
};

/** First date on which a HEAT rule's index reaches its threshold, or null if it never does. */
export const heatFiredOn = (days: readonly { date: string; value: number | null }[], rule: Rule): string | null => {
  if (rule.peril !== 'HEAT' || rule.tempC === undefined || !rule.window) throw new Error('not a HEAT rule');
  return heatDays(days, rule.tempC, rule.window).find((d) => d.value >= rule.threshold)?.date ?? null;
};

/** Reference point for the regression: the pipeline's SST series here must reproduce REFERENCE_FIRES under RULES. */
export const REFERENCE_POINT = { lat: 38.85, lon: 141.66 } as const;

/**
 * Expected fire dates at the reference point (38.85N 141.66E) under RULES. Re-derived 2026-09-26 from the pipeline's
 * JAXA daily SST series (pipeline/tests/heat/snapshots/kesennuma-sst-2022-2025.csv: SGLI night -> SGLI day -> AMSR2
 * gap fill, pipeline/README.md Q10), replacing the NASA MUR dates. test/reference-fires.test.ts recomputes them from
 * that snapshot. Regression target for the pipeline.
 */
export const REFERENCE_FIRES = {
  '2023': { 'scallop:1': '2023-08-13', 'scallop:2': '2023-08-14', 'hoya:1': '2023-08-27' },
  '2024': { 'scallop:1': '2024-09-05', 'hoya:1': '2024-09-09' },
  '2025': { 'scallop:1': '2025-08-20', 'hoya:1': '2025-08-31' },
  '2022': {},
} as const;
