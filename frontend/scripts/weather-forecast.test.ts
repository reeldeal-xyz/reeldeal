import { describe, expect, test } from 'bun:test';
import { weatherForecast } from '@repo/shared';
import { createWeatherReader, fetchWeatherForecast } from '../src/lib/weather-forecast.server';

const location = { latitude: 38.88419, longitude: 141.636787 };
const initial = Date.UTC(2026, 8, 27, 0) / 1000;
const raw = (marine: boolean, now = initial) => ({
  latitude: 38.9, longitude: 141.625, utc_offset_seconds: 32400, timezone: 'Asia/Tokyo',
  hourly_units: marine
    ? { time: 'unixtime', sea_surface_temperature: '°C', wave_height: 'm', wave_period: 's' }
    : { time: 'unixtime', temperature_2m: '°C', precipitation: 'mm', wind_speed_10m: 'm/s', wind_direction_10m: '°', weather_code: 'wmo code' },
  hourly: {
    time: Array.from({ length: 72 }, (_, i) => Math.floor(now / 3600) * 3600 + i * 3600),
    ...(marine ? {
      sea_surface_temperature: Array<number | null>(72).fill(22), wave_height: Array<number | null>(72).fill(0), wave_period: Array<number | null>(72).fill(7),
    } : {
      temperature_2m: Array<number | null>(72).fill(18), precipitation: Array<number | null>(72).fill(0), wind_speed_10m: Array<number | null>(72).fill(3),
      wind_direction_10m: Array<number | null>(72).fill(0), weather_code: Array<number | null>(72).fill(0),
    }),
  },
});
const transport = async (url: URL) => Response.json(raw(url.pathname === '/v1/marine'));

describe('real forecast boundary', () => {
  test('uses only fixed provider hosts with documented units and 72 current hours', async () => {
    const requested: URL[] = [];
    const result = await fetchWeatherForecast(location, { now: initial, transport: async (url, init) => {
      requested.push(url); expect(init.redirect).toBe('error'); expect(init.signal).toBeDefined();
      expect(url.searchParams.get('forecast_hours')).toBe('72');
      expect(url.searchParams.get('timeformat')).toBe('unixtime');
      expect(url.searchParams.get('timezone')).toBe('Asia/Tokyo');
      return transport(url);
    } });
    expect(requested.map((url) => url.host)).toEqual(['api.open-meteo.com', 'marine-api.open-meteo.com']);
    expect(result.status).toBe('available');
    expect(result.hours).toHaveLength(72);
    expect(result.hours[0]).toMatchObject({ precipitationMm: 0, waveHeightM: 0, seaTemperatureC: 22, airTemperatureC: 18 });
    expect(result.kind).toBe('forecast');
    expect(weatherForecast.safeParse(result).success).toBe(true);
  });

  test('uses customer hosts and never exposes the key in the response', async () => {
    const result = await fetchWeatherForecast(location, { now: initial, apiKey: 'test-secret', transport: async (url) => {
      expect(url.host.startsWith('customer-')).toBe(true);
      expect(url.searchParams.get('apikey')).toBe('test-secret');
      return transport(url);
    } });
    expect(JSON.stringify(result)).not.toContain('test-secret');
  });

  test('retains missing marine values and independently reports unavailable weather', async () => {
    const result = await fetchWeatherForecast(location, { now: initial, transport: async (url) => {
      if (url.pathname !== '/v1/marine') return new Response('', { status: 503 });
      const data = raw(true); if ('wave_height' in data.hourly) data.hourly.wave_height[0] = null;
      return Response.json(data);
    } });
    expect(result.status).toBe('partial');
    expect(result.weather.status).toBe('unavailable');
    expect(result.marine.status).toBe('available');
    expect(result.hours[0].airTemperatureC).toBeNull();
    expect(result.hours[0].waveHeightM).toBeNull();
    expect(result.hours[1].waveHeightM).toBe(0);
  });

  test('rejects wrong units, coordinates, malformed and obsolete forecasts', async () => {
    const changes = [
      (data: ReturnType<typeof raw>) => { data.hourly_units.time = 'iso8601'; },
      (data: ReturnType<typeof raw>) => { data.latitude = 0; },
      (data: ReturnType<typeof raw>) => { data.hourly.time[1] = data.hourly.time[0]; },
      (data: ReturnType<typeof raw>) => { data.hourly.time = data.hourly.time.map((time) => time - 7200); },
      (data: ReturnType<typeof raw>) => { data.hourly.time.pop(); },
    ];
    for (const change of changes) {
      const result = await fetchWeatherForecast(location, { now: initial, transport: async (url) => { const data = raw(url.pathname === '/v1/marine'); change(data); return Response.json(data); } });
      expect(result.status).toBe('unavailable'); expect(result.hours).toEqual([]);
      expect(result.weather.status).toBe('invalid-payload');
    }
    await expect(fetchWeatherForecast({ latitude: 0, longitude: 0 })).rejects.toThrow();
  });

  test('bounds streaming provider data even without Content-Length', async () => {
    let cancelled = 0;
    const result = await fetchWeatherForecast(location, { now: initial, transport: async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled++; },
    }), { headers: { 'content-type': 'application/json' } }) });
    expect(result.status).toBe('unavailable'); expect(cancelled).toBe(2);
  });

  test('coalesces, caches, labels stale data, and expires stale data without fabricating', async () => {
    let calls = 0, now = initial, fail = false;
    const read = createWeatherReader({ now: () => now, transport: async (url) => { calls++; return fail ? new Response('', { status: 503 }) : Response.json(raw(url.pathname === '/v1/marine', now)); } });
    const [a, b] = await Promise.all([read(location), read(location)]);
    expect(calls).toBe(2); expect(a).toEqual(b);
    expect((await read(location)).status).toBe('available'); expect(calls).toBe(2);
    now += 901; fail = true;
    const stale = await read(location);
    expect(stale.status).toBe('stale'); expect(stale.fetchedAt).toBe(initial); expect(stale.hours).toEqual(a.hours);
    now = initial + 10801;
    const expired = await read(location);
    expect(expired.status).toBe('unavailable'); expect(expired.hours).toEqual([]);
  });

  test('limits concurrent distinct-location fetches', async () => {
    const release: (() => void)[] = [];
    const read = createWeatherReader({ now: () => initial, transport: async () => {
      await new Promise<void>((resolve) => release.push(resolve));
      return new Response('', { status: 503 });
    } });
    const jobs = Array.from({ length: 8 }, (_, i) => read({ ...location, latitude: 38.8 + i / 1000 }));
    const ninth = await read({ ...location, latitude: 39.1 });
    expect(ninth.status).toBe('unavailable'); expect(release).toHaveLength(16);
    release.forEach((resolve) => resolve()); await Promise.all(jobs);
  });
});
