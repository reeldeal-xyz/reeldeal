import type { MeasurementRowProps } from './props';

/** Display fallback only; the shared adapter remains responsible for domain validation. */
export function measurementState(state: unknown, tempC: unknown): MeasurementRowProps['state'] {
  if (state === 'loading' || state === 'missing' || state === 'unavailable') return state;
  if (state !== 'available' && state !== 'stale' && state !== 'advisory') return 'unavailable';
  if (tempC === null || tempC === undefined) return 'missing';
  return typeof tempC === 'number' && Number.isFinite(tempC) ? state : 'unavailable';
}
