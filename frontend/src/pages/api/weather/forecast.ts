import type { APIRoute } from 'astro';
import { OPEN_METEO_API_KEY } from 'astro:env/server';
import { forecastLocation } from '@repo/shared';
import { createWeatherReader } from '../../../lib/weather-forecast.server';

const read = createWeatherReader({ apiKey: OPEN_METEO_API_KEY });
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams;
  if (query.getAll('latitude').length !== 1 || query.getAll('longitude').length !== 1
    || [...query.keys()].some((key) => !['latitude', 'longitude'].includes(key))
    || ['latitude', 'longitude'].some((key) => !/^-?\d{1,3}(?:\.\d{1,6})?$/.test(query.get(key) ?? ''))) {
    return Response.json({ error: 'invalid-location' }, { status: 400, headers });
  }
  const parsed = forecastLocation.safeParse({ latitude: Number(query.get('latitude')), longitude: Number(query.get('longitude')) });
  if (!parsed.success) return Response.json({ error: 'invalid-location' }, { status: 400, headers });
  try {
    const result = await read(parsed.data);
    return Response.json(result, { status: result.status === 'unavailable' ? 503 : 200, headers: { ...headers, ...(result.status === 'unavailable' ? { 'retry-after': '30' } : {}) } });
  } catch {
    return Response.json({ error: 'forecast-unavailable' }, { status: 503, headers: { ...headers, 'retry-after': '30' } });
  }
};
