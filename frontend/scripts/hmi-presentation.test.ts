import { describe, expect, test } from 'bun:test';
import { observationChart, observationSummary } from '../src/lib/hmi-presentation';

const reading = (asOf: string, value: number | null) => ({ asOf, value });

describe('HMI data presentation', () => {
  test('shows zero and an isolated observation, without a fabricated trend', () => {
    const chart = observationChart([reading('2025-06-01', 0)], 'SST');
    expect(chart?.latest.value).toBe(0);
    expect(chart?.segments.map((segment) => segment.length)).toEqual([1]);
    expect(chart?.ticks.every((tick) => Number.isFinite(tick.y))).toBe(true);
    expect(observationChart([reading('2025-06-01', null)], 'SST')).toBeNull();
  });

  test('breaks the line at nulls and omitted days and preserves actual time spacing', () => {
    const chart = observationChart([
      reading('2025-06-01', 10), reading('2025-06-02', 11), reading('2025-06-03', null),
      reading('2025-06-04', 12), reading('2025-06-08', 14),
    ], 'SST');
    expect(chart?.segments.map((segment) => segment.length)).toEqual([2, 1, 1]);
    expect(chart?.latest.asOf).toBe('2025-06-08');
    const points = chart!.segments.flat();
    expect(points[3].x - points[2].x).toBeCloseTo(4 * (points[1].x - points[0].x));
  });

  test('connects adjacent monthly samples but not missing months', () => {
    const chart = observationChart([
      reading('2025-06-01', 10), reading('2025-07-01', 12), reading('2025-09-01', 14),
    ], 'SST_MONTH');
    expect(chart?.segments.map((segment) => segment.length)).toEqual([2, 1]);
  });

  test('keeps a constant series centered in a nonzero numeric range', () => {
    const chart = observationChart([reading('2025-06-01', 4), reading('2025-06-02', 4)], 'SST');
    expect(chart!.ticks[0].value).toBeGreaterThan(4);
    expect(chart!.ticks.at(-1)!.value).toBeLessThan(4);
    expect(chart!.segments[0][0].y).toBe(chart!.segments[0][1].y);
  });

  test('distinguishes missing, zero, sample range and mean', () => {
    expect(observationSummary([reading('2025-06-01', null)])).toBeNull();
    expect(observationSummary([reading('2025-06-01', 0), reading('2025-06-02', null), reading('2025-06-03', 10)]))
      .toEqual({ count: 2, min: 0, max: 10, mean: 5, latest: { asOf: '2025-06-03', value: 10 } });
  });

});
