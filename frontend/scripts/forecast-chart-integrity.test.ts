import { describe, expect, test } from 'bun:test';
import type { WeatherForecastPoint } from '@repo/shared';
import { forecastChart } from '../src/lib/forecast-chart';

const start = Date.UTC(2026, 8, 27) / 1000;
const point = (index: number, value: number | null): WeatherForecastPoint => ({
  time: start + index * 3600, airTemperatureC: value, seaTemperatureC: value,
  precipitationMm: value, windSpeedMs: value, waveHeightM: value,
  windDirectionDeg: null, wavePeriodS: null, weatherCode: null,
});

describe('local forecast chart integrity', () => {
  test('empty and entirely missing forecasts do not create a line', () => {
    expect(forecastChart([], 'seaTemperatureC')).toBeNull();
    expect(forecastChart([point(0, null), point(1, null)], 'seaTemperatureC')).toBeNull();
  });

  test('retains zero and breaks segments at nulls and omitted hours', () => {
    const result = forecastChart([point(0, 0), point(1, 1), point(2, null), point(3, 2), point(5, 4)], 'waveHeightM')!;
    expect(result.min).toBe(0);
    expect(result.segments.map((segment) => segment.length)).toEqual([2, 1, 1]);
    expect(result.readings[2].value).toBeNull();
    expect(result.x(start)).toBe(44);
    expect(result.x(start + 5 * 3600)).toBe(456);
  });

  test('converts only temperature and leaves the underlying forecast untouched', () => {
    const hours = [point(0, 0), point(1, 10), point(2, null)];
    const before = structuredClone(hours);
    expect(forecastChart(hours, 'seaTemperatureC', true)!.readings.map((item) => item.value)).toEqual([32, 50, null]);
    expect(forecastChart(hours, 'airTemperatureC', true)!.max).toBe(50);
    expect(forecastChart(hours, 'windSpeedMs', true)!.max).toBe(10);
    expect(hours).toEqual(before);
  });

  test('a constant or single-hour forecast always has finite chart coordinates', () => {
    for (const metric of ['seaTemperatureC', 'precipitationMm'] as const) {
      for (const hours of [[point(0, 0)], [point(0, 0), point(1, 0)]]) {
        const result = forecastChart(hours, metric)!;
        expect(Number.isFinite(result.y(0))).toBe(true);
        expect(result.ticks.every((tick) => Number.isFinite(tick.y))).toBe(true);
        expect(result.segments.flat().every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
      }
    }
  });
});
