import type { WeatherForecastPoint } from '@repo/shared';

export type ForecastMetric = 'seaTemperatureC' | 'windSpeedMs' | 'waveHeightM' | 'airTemperatureC' | 'precipitationMm';

export function forecastChart(hours: readonly WeatherForecastPoint[], metric: ForecastMetric, fahrenheit = false, references: readonly number[] = []) {
  const temperature = metric === 'seaTemperatureC' || metric === 'airTemperatureC';
  const readings = hours.map((hour) => ({ time: hour.time, value: hour[metric] === null ? null
    : temperature && fahrenheit ? hour[metric]! * 9 / 5 + 32 : hour[metric] }));
  const valid = readings.flatMap((reading) => reading.value === null ? [] : [reading.value]);
  if (!valid.length) return null;
  const min = Math.min(...valid), max = Math.max(...valid);
  const extentMin = Math.min(min, ...references), extentMax = Math.max(max, ...references);
  const padding = Math.max((extentMax - extentMin) * 0.15, temperature ? 0.5 : 0.2);
  const low = temperature ? extentMin - padding : Math.max(0, extentMin - padding), high = extentMax + padding;
  const start = readings[0].time, end = readings.at(-1)!.time;
  const x = (time: number) => end === start ? 250 : 44 + (time - start) / (end - start) * 412;
  const y = (value: number) => 144 - (value - low) / (high - low) * 120;
  const segments: { x: number; y: number; time: number; value: number }[][] = [];
  let segment: (typeof segments)[number] | undefined;
  let previous: number | undefined;
  for (const reading of readings) {
    if (reading.value === null) { segment = undefined; previous = undefined; continue; }
    if (!segment || previous === undefined || reading.time - previous !== 3600) {
      segment = []; segments.push(segment);
    }
    segment.push({ x: x(reading.time), y: y(reading.value), time: reading.time, value: reading.value });
    previous = reading.time;
  }
  return { readings, segments, x, y, min, max, ticks: [high, (high + low) / 2, low].map((value) => ({ value, y: y(value) })) };
}
