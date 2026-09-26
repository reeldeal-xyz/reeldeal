import { describe, expect, test } from 'bun:test';
import { weatherForecast } from '@repo/shared';
import { createWeatherReader, fetchWeatherForecast } from '../src/lib/weather-forecast.server';
import { parseForecastResponse } from '../src/lib/weather-forecast.client';

const location = { latitude: 38.88419, longitude: 141.636787 };
const now = Date.UTC(2026, 8, 27) / 1000;
function payload(marine: boolean, missing = false) {
  const numbers = (value: number) => Array<number | null>(72).fill(missing ? null : value);
  return {
    latitude: location.latitude, longitude: location.longitude, utc_offset_seconds: 32400, timezone: 'Asia/Tokyo',
    hourly_units: marine
      ? { time: 'unixtime', sea_surface_temperature: '°C', wave_height: 'm', wave_period: 's' }
      : { time: 'unixtime', temperature_2m: '°C', precipitation: 'mm', wind_speed_10m: 'm/s', wind_direction_10m: '°', weather_code: 'wmo code' },
    hourly: { time: Array.from({ length: 72 }, (_, i) => now + i * 3600), ...(marine
      ? { sea_surface_temperature: numbers(22), wave_height: numbers(1), wave_period: numbers(7) }
      : { temperature_2m: numbers(18), precipitation: numbers(0), wind_speed_10m: numbers(2), wind_direction_10m: numbers(0), weather_code: numbers(0) }) },
  };
}
const valid = () => fetchWeatherForecast(location, { now, transport: async (url) => Response.json(payload(url.pathname === '/v1/marine')) });

describe('forecast integrity and bounded usage', () => {
  test('all-null products are unavailable, not a successful forecast', async () => {
    const result = await fetchWeatherForecast(location, { now, transport: async (url) => Response.json(payload(url.pathname === '/v1/marine', true)) });
    expect(result.status).toBe('unavailable');
    expect(result.hours).toHaveLength(0);
    expect(result.weather.status).toBe('unavailable');
    expect(result.marine.status).toBe('unavailable');
  });

  test('refuses source and availability contradictions at the browser boundary', async () => {
    const original = await valid();
    const mutations = [
      (data: any) => { data.weather.url = 'javascript:alert(1)'; },
      (data: any) => { data.marine.url = data.weather.url; },
      (data: any) => { data.weather.status = 'unavailable'; },
      (data: any) => { data.marine.grid = null; },
      (data: any) => { data.status = 'unavailable'; },
      (data: any) => { data.hours[0].seaTemperatureC = null; },
      (data: any) => { data.weather.grid.latitude = 200; },
      (data: any) => { data.hours[0].time += 60; },
      (data: any) => { data.fetchedAt += 86400; },
    ];
    for (const change of mutations) {
      const copy = structuredClone(original);
      change(copy);
      expect(weatherForecast.safeParse(copy).success).toBe(false);
    }
    expect(weatherForecast.safeParse({ ...original, status: 'stale' }).success).toBe(true);
  });

  test('rate limits sequential unique locations as well as concurrent requests', async () => {
    let calls = 0;
    const read = createWeatherReader({ now: () => now, transport: async () => { calls++; return new Response('', { status: 503 }); } });
    for (let i = 0; i < 35; i++) await read({ latitude: 38.8 + i / 1000, longitude: location.longitude });
    expect(calls).toBe(60);
    expect((await read({ latitude: 40, longitude: 140 })).status).toBe('unavailable');
    expect(calls).toBe(60);
  });

  test('one failed source never fabricates the other product', async () => {
    const result = await fetchWeatherForecast(location, { now, transport: async (url) => url.pathname === '/v1/marine'
      ? new Response('provider error', { status: 503 }) : Response.json(payload(false)) });
    expect(result.status).toBe('partial');
    expect(result.hours.every((hour) => hour.waveHeightM === null && hour.seaTemperatureC === null)).toBe(true);
    expect(result.hours[0].airTemperatureC).toBe(18);
    expect(weatherForecast.safeParse(result).success).toBe(true);
  });
});


describe('forecast browser response boundary', () => {
  test('accepts valid envelopes and rejects oversized chunked bodies', async () => {
    const data = await valid();
    const parsed = await parseForecastResponse(Response.json(data), new AbortController().signal);
    expect(parsed.hours).toHaveLength(72);
    let cancelled = false;
    const response = new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(128 * 1024)); },
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'application/json' } });
    await expect(parseForecastResponse(response, new AbortController().signal)).rejects.toThrow('too large');
    expect(cancelled).toBe(true);
  });

  test('cancels an obsolete stalled forecast body', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } });
    const task = parseForecastResponse(response, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(task).rejects.toThrow();
    expect(cancelled).toBe(true);
  });
});
