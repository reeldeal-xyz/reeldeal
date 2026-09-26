import type { APIRoute } from 'astro';
import { PIPELINE_API_URL } from 'astro:env/server';
import { pipelineDay, pipelineHeatRisk } from '@repo/shared';

const bounds = { west: 140.5, south: 37.2, east: 143.1, north: 40.5 };

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    if (Number(request.headers.get('content-length')) > 64_000) return Response.json({ error: 'Area is too large.' }, { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: 'Invalid area request.' }, { status: 400 });
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64_000) { await reader.cancel(); return Response.json({ error: 'Area is too large.' }, { status: 413 }); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    reader.releaseLock();
    body = JSON.parse(text);
  } catch { return Response.json({ error: 'Invalid area request.' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid area request.' }, { status: 400 });
  const { feature, start, end } = body as { feature?: { type?: unknown; properties?: unknown; geometry?: { type?: unknown; coordinates?: unknown } }; start?: unknown; end?: unknown };
  const coordinates = feature?.geometry?.type === 'Polygon' ? feature.geometry.coordinates : null;
  const ring = Array.isArray(coordinates) ? coordinates[0] : null;
  const validRing = Array.isArray(ring) && ring.length >= 4 && ring.length <= 250
    && ring.every((point: unknown) => Array.isArray(point) && point.length === 2
      && typeof point[0] === 'number' && Number.isFinite(point[0]) && point[0] >= bounds.west && point[0] <= bounds.east
      && typeof point[1] === 'number' && Number.isFinite(point[1]) && point[1] >= bounds.south && point[1] <= bounds.north)
    && ring[0][0] === ring.at(-1)?.[0] && ring[0][1] === ring.at(-1)?.[1]
    && new Set(ring.slice(0, -1).map((point: number[]) => point.join(','))).size >= 3;
  const area = validRing ? Math.abs(ring.slice(0, -1).reduce((sum: number, point: number[], index: number, points: number[][]) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2 : 0;
  if (feature?.type !== 'Feature' || !Array.isArray(ring) || ring.length < 4 || ring.length > 250
    || !validRing || area === 0 || (feature.properties !== null && (typeof feature.properties !== 'object' || Array.isArray(feature.properties)))
    || typeof start !== 'string' || typeof end !== 'string'
    || !pipelineDay.safeParse(start).success || !pipelineDay.safeParse(end).success
    || (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 > 366
    || end < start)
    return Response.json({ error: 'Draw a closed polygon inside the Miyagi map area.' }, { status: 400 });
  if (!PIPELINE_API_URL) return Response.json({ error: 'Heat pipeline is not configured.' }, { status: 503 });
  try {
    const origin = new URL(PIPELINE_API_URL);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash)
      return Response.json({ error: 'Heat pipeline is not configured.' }, { status: 503 });
    const url = new URL(origin);
    url.pathname = `${origin.pathname.replace(/\/$/, '')}/heat/risk`;
    const response = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(10_000), redirect: 'error', cache: 'no-store',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ feature, start, end }),
    });
    if (!response.ok) return Response.json({ error: response.status === 404
      ? 'No built satellite data covers this area and date range.' : 'Area analysis is unavailable.' }, { status: response.status === 501 ? 501 : 503 });
    const result = pipelineHeatRisk.parse(await response.json());
    return Response.json(result, { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch { return Response.json({ error: 'Area analysis returned invalid or unavailable data.' }, { status: 502 }); }
};
