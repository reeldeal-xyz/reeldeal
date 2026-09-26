import type { APIRoute } from 'astro';
import { PIPELINE_API_URL } from 'astro:env/server';
import { pipelineDay, pipelineHeatRisk } from '@repo/shared';
import { validAreaPolygon } from '../../../../lib/area-polygon';

const bounds = { west: 140.5, south: 37.2, east: 143.1, north: 40.5 };
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function readJson(response: Response, signal: AbortSignal) {
  if (!/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
    || !response.body || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new Error('Invalid pipeline response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const cancel = () => { void reader.cancel().catch(() => {}); };
  let size = 0, text = '';
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Pipeline response too large');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

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
  if (feature?.type !== 'Feature' || !Array.isArray(ring) || ring.length < 4 || ring.length > 250
    || !validAreaPolygon(coordinates, bounds) || (feature.properties !== null && (typeof feature.properties !== 'object' || Array.isArray(feature.properties)))
    || typeof start !== 'string' || typeof end !== 'string'
    || !pipelineDay.safeParse(start).success || !pipelineDay.safeParse(end).success
    || (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 >= 366
    || end < start)
    return Response.json({ error: 'Draw a closed polygon inside the Miyagi map area.' }, { status: 400 });
  if (!PIPELINE_API_URL) return Response.json({ error: 'Heat pipeline is not configured.' }, { status: 503 });
  try {
    const origin = new URL(PIPELINE_API_URL);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash)
      return Response.json({ error: 'Heat pipeline is not configured.' }, { status: 503 });
    const url = new URL(origin);
    url.pathname = `${origin.pathname.replace(/\/$/, '')}/heat/risk`;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    const response = await fetch(url, {
      method: 'POST', signal, redirect: 'error', cache: 'no-store',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ feature, start, end }),
    });
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel().catch(() => {});
      return Response.json({ error: status === 404
        ? 'No built satellite data covers this area and date range.' : 'Area analysis is unavailable.' }, { status: status === 501 ? 501 : 503 });
    }
    const result = pipelineHeatRisk.parse(await readJson(response, signal));
    return Response.json(result, { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch { return Response.json({ error: 'Area analysis returned invalid or unavailable data.' }, { status: 502 }); }
};
