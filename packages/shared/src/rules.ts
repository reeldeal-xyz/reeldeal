import type { Peril, Species } from './ids';

/** Provisional trigger rules (writeup v3, section 7.3). Thresholds are set with growers; do not tune to data. */
export interface Rule {
  species: Species;
  tier: 1 | 2;
  peril: Peril;
  /** Minimum index value (days for HEAT*, weeks for BANWEEKS). */
  threshold: number;
  /** Season window for heat perils, inclusive, MM-DD. */
  window?: { start: string; end: string };
}

export const HEAT_WINDOW = { start: '07-01', end: '09-30' } as const;

export const RULES: readonly Rule[] = [
  { species: 'scallop', tier: 1, peril: 'HEAT25', threshold: 14, window: HEAT_WINDOW },
  { species: 'scallop', tier: 2, peril: 'HEAT26', threshold: 12, window: HEAT_WINDOW },
  { species: 'hoya', tier: 1, peril: 'HEAT24', threshold: 30, window: HEAT_WINDOW },
  { species: 'oyster', tier: 1, peril: 'BANWEEKS', threshold: 4 },
  { species: 'scallop', tier: 1, peril: 'BANWEEKS', threshold: 4 },
] as const;

/** Expected fire dates at the reference point (38.85N 141.66E), verified 2026-09-25 against raw MUR CSVs. Regression target for the pipeline. */
export const REFERENCE_FIRES = {
  '2023': { 'scallop:1': '2023-08-12', 'scallop:2': '2023-08-11', 'hoya:1': '2023-08-25' },
  '2024': { 'hoya:1': '2024-09-15' },
  '2025': { 'scallop:1': '2025-08-28', 'hoya:1': '2025-09-01' },
  '2022': {},
} as const;
