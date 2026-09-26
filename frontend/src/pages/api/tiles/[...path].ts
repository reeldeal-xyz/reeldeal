import type { APIRoute } from 'astro';
import { PIPELINE_API_URL } from 'astro:env/server';
import { validTilePath } from '../../../lib/hab-layers';

const MAX_TILE_BYTES = 512 * 1024;

const fail = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

/** Same-origin proxy for pipeline map tiles (PIPELINE_API_URL is server-only). PNG only, validated paths only. */
export const GET: APIRoute = async ({ params, request }) => {
  const path = params.path ?? '';
  if (!validTilePath(path)) return fail(404);
  if (!PIPELINE_API_URL) return fail(503);
  let origin: URL;
  try {
    origin = new URL(PIPELINE_API_URL);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash) return fail(503);
  } catch { return fail(503); }
  const url = new URL(origin);
  url.pathname = `${origin.pathname.replace(/\/$/, '')}/${path}`;
  const headers: Record<string, string> = { accept: 'image/png' };
  const etag = request.headers.get('if-none-match');
  if (etag && etag.length < 200) headers['if-none-match'] = etag;
  try {
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]) });
    const passthrough: Record<string, string> = { 'cache-control': response.headers.get('cache-control') ?? 'public, max-age=3600' };
    const upstreamEtag = response.headers.get('etag');
    if (upstreamEtag) passthrough.etag = upstreamEtag;
    if (response.status === 304) return new Response(null, { status: 304, headers: passthrough });
    if (!response.ok || response.headers.get('content-type') !== 'image/png'
      || Number(response.headers.get('content-length')) > MAX_TILE_BYTES) {
      await response.body?.cancel().catch(() => {});
      return fail(response.status === 404 ? 404 : 502);
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_TILE_BYTES) return fail(502);
    return new Response(body, { headers: { ...passthrough, 'content-type': 'image/png', 'x-content-type-options': 'nosniff' } });
  } catch {
    return fail(502);
  }
};
