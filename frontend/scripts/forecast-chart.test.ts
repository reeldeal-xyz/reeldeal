import { expect, test } from 'bun:test';
import type { WeatherForecastPoint } from '@repo/shared';
import { forecastChart } from '../src/lib/forecast-chart';

const hour = (time: number, seaTemperatureC: number | null): WeatherForecastPoint => ({
  time, seaTemperatureC, airTemperatureC: 20, windSpeedMs: 0, precipitationMm: 0, waveHeightM: null,
  windDirectionDeg: null, weatherCode: null, wavePeriodS: null,
});

test('forecast preserves gaps, elapsed time and missing values when scrubbing', () => {
  const hours = [hour(0, 20), hour(3600, 21), hour(7200, null), hour(10800, 22), hour(18000, 23)];
  const chart = forecastChart(hours, 'seaTemperatureC')!;
  expect(chart.segments.map((segment) => segment.length)).toEqual([2, 1, 1]);
  expect(chart.readings[2].value).toBeNull();
  expect(chart.x(3600) - chart.x(0)).toBeCloseTo((chart.x(18000) - chart.x(10800)) / 2);
  expect(forecastChart(hours, 'waveHeightM')).toBeNull();
  expect(forecastChart([], 'seaTemperatureC')).toBeNull();
  expect(forecastChart(hours, 'windSpeedMs')?.min).toBe(0);
});

test('temperature conversion and relief references preserve the actual data range', () => {
  const chart = forecastChart([hour(0, 20), hour(3600, 21)], 'seaTemperatureC', true, [77, 78.8])!;
  expect(chart.readings.map((reading) => reading.value)).toEqual([68, 69.8]);
  expect(chart.max).toBe(69.8);
  expect(chart.y(78.8)).toBeGreaterThan(24);
  expect(chart.y(78.8)).toBeLessThan(chart.y(69.8));
  expect(forecastChart([hour(0, 20)], 'windSpeedMs', true)?.readings[0].value).toBe(0);
});
