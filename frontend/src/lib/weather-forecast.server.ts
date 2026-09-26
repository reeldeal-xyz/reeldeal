import { forecastLocation, openMeteoMarine, openMeteoWeather, weatherForecast, type ForecastLocation, type WeatherForecast, type WeatherForecastPoint } from '@repo/shared';
import { readJson } from './heat-risk.server';

type Transport = (url: URL, init: RequestInit) => Promise<Response>;
const HOUR = 3600;
const TTL = 15 * 60;
const STALE_LIMIT = 3 * HOUR;
const source = (marine: boolean): WeatherForecast['weather'] => ({
  status: 'unavailable', provider: 'Open-Meteo', model: marine ? 'Marine best match' : 'JMA GSM/MSM seamless',
  url: marine ? 'https://open-meteo.com/en/docs/marine-weather-api' : 'https://open-meteo.com/en/docs/jma-api', grid: null,
});

export function gridDistance(a: ForecastLocation, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const v = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.min(1, Math.sqrt(v))) * 10) / 10;
}

export async function fetchWeatherForecast(
  location: ForecastLocation,
  options: { apiKey?: string; now?: number; transport?: Transport } = {},
): Promise<WeatherForecast> {
  forecastLocation.parse(location);
  const now = Math.floor(options.now ?? Date.now() / 1000);
  const transport = options.transport ?? fetch;
  const get = async (marine: boolean) => {
    const metadata = source(marine);
    const prefix = options.apiKey ? 'customer-' : '';
    const url = new URL(marine ? `https://${prefix}marine-api.open-meteo.com/v1/marine` : `https://${prefix}api.open-meteo.com/v1/jma`);
    url.search = new URLSearchParams({
      latitude: String(location.latitude), longitude: String(location.longitude),
      hourly: marine ? 'wave_height,wave_period,sea_surface_temperature' : 'temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,weather_code',
      forecast_hours: '72', timezone: 'Asia/Tokyo', timeformat: 'unixtime', cell_selection: marine ? 'sea' : 'nearest',
      ...(marine ? {} : { wind_speed_unit: 'ms', temperature_unit: 'celsius', precipitation_unit: 'mm' }),
    }).toString();
    if (options.apiKey) url.searchParams.set('apikey', options.apiKey);
    const signal = AbortSignal.timeout(8000);
    let json: unknown;
    try {
      const response = await transport(url, { signal, redirect: 'error', headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); return { metadata, hours: [] as WeatherForecastPoint[] }; }
      json = await readJson(response, signal);
    } catch { return { metadata, hours: [] as WeatherForecastPoint[] }; }
    try {
      const data = marine ? openMeteoMarine.parse(json) : openMeteoWeather.parse(json);
      const times = data.hourly.time;
      const distanceKm = gridDistance(location, data);
      if (distanceKm > 150 || Math.abs(times[0] - Math.floor(now / HOUR) * HOUR) > HOUR
        || times.some((time, i) => i > 0 && time !== times[i - 1] + HOUR)) throw new Error('Wrong location or forecast time');
      const hours = times.map((time): WeatherForecastPoint => ({
        time, airTemperatureC: null, precipitationMm: null, windSpeedMs: null, windDirectionDeg: null,
        weatherCode: null, seaTemperatureC: null, waveHeightM: null, wavePeriodS: null,
      }));
      if (marine) {
        const raw = openMeteoMarine.parse(json).hourly;
        hours.forEach((hour, i) => Object.assign(hour, { seaTemperatureC: raw.sea_surface_temperature[i], waveHeightM: raw.wave_height[i], wavePeriodS: raw.wave_period[i] }));
      } else {
        const raw = openMeteoWeather.parse(json).hourly;
        hours.forEach((hour, i) => Object.assign(hour, { airTemperatureC: raw.temperature_2m[i], precipitationMm: raw.precipitation[i], windSpeedMs: raw.wind_speed_10m[i], windDirectionDeg: raw.wind_direction_10m[i], weatherCode: raw.weather_code[i] }));
      }
      if (!hours.some((hour) => Object.entries(hour).some(([key, value]) => key !== 'time' && value !== null))) return { metadata, hours: [] as WeatherForecastPoint[] };
      return { metadata: { ...metadata, status: 'available' as const, grid: { latitude: data.latitude, longitude: data.longitude, distanceKm } }, hours };
    } catch { return { metadata: { ...metadata, status: 'invalid-payload' as const }, hours: [] as WeatherForecastPoint[] }; }
  };
  const [weather, marine] = await Promise.all([get(false), get(true)]);
  const times = [...new Set([...weather.hours, ...marine.hours].map((hour) => hour.time))].sort((a, b) => a - b).slice(0, 72);
  const hours = times.map((time) => {
    const w = weather.hours.find((hour) => hour.time === time), m = marine.hours.find((hour) => hour.time === time);
    return {
      time, airTemperatureC: w?.airTemperatureC ?? null, precipitationMm: w?.precipitationMm ?? null,
      windSpeedMs: w?.windSpeedMs ?? null, windDirectionDeg: w?.windDirectionDeg ?? null, weatherCode: w?.weatherCode ?? null,
      seaTemperatureC: m?.seaTemperatureC ?? null, waveHeightM: m?.waveHeightM ?? null, wavePeriodS: m?.wavePeriodS ?? null,
    };
  });
  const both = weather.metadata.status === 'available' && marine.metadata.status === 'available';
  const complete = both && hours.every((hour) => Object.values(hour).every((v) => v !== null));
  return weatherForecast.parse({ kind: 'forecast', status: !hours.length ? 'unavailable' : complete ? 'available' : 'partial', requested: location, timezone: 'Asia/Tokyo', fetchedAt: now, weather: weather.metadata, marine: marine.metadata, hours });
}

export function createWeatherReader(options: { apiKey?: string; transport?: Transport; now?: () => number } = {}) {
  const cache = new Map<string, { expires: number; value: WeatherForecast }>();
  const pending = new Map<string, Promise<WeatherForecast>>();
  const budgets = [{ duration: 60, max: 30, window: -1, count: 0 }, { duration: 3600, max: 1000, window: -1, count: 0 }, { duration: 86400, max: 4000, window: -1, count: 0 }];
  return async (requested: ForecastLocation): Promise<WeatherForecast> => {
    const location = forecastLocation.parse(requested);
    const now = Math.floor(options.now?.() ?? Date.now() / 1000);
    const key = `${location.latitude},${location.longitude}`;
    const cached = cache.get(key);
    if (cached && cached.expires > now) return cached.value;
    const running = pending.get(key);
    if (running) return running;
    const unavailable = (): WeatherForecast => ({ kind: 'forecast', status: 'unavailable', requested: location, timezone: 'Asia/Tokyo', fetchedAt: now, weather: source(false), marine: source(true), hours: [] });
    for (const budget of budgets) {
      const window = Math.floor(now / budget.duration);
      if (window !== budget.window) { budget.window = window; budget.count = 0; }
    }
    if (pending.size >= 8 || budgets.some((budget) => budget.count >= budget.max)) return unavailable();
    budgets.forEach((budget) => { budget.count++; });
    const task = fetchWeatherForecast(location, { ...options, now }).then((fresh) => {
      let value = fresh;
      if (fresh.status === 'unavailable' && cached?.value.hours.length && now - cached.value.fetchedAt <= STALE_LIMIT
        && cached.value.hours.some((hour) => hour.time >= now)) value = { ...cached.value, status: 'stale' };
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: now + (value.status === 'unavailable' || value.status === 'stale' ? 30 : TTL), value });
      return value;
    }).finally(() => { pending.delete(key); });
    pending.set(key, task);
    return task;
  };
}
