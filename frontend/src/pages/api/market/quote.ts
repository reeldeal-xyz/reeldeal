// Same-origin proxy for marketplace quotes. The co-op quote-signing key lives only in the web app
// (LEGACY_WEB_ORIGIN, /api/market/quote); this forwards {listing, buyer} server-to-server so the browser
// never needs cross-origin access and this box never holds the key.
import { getListing } from '@repo/shared';
import type { APIRoute } from 'astro';
import { LEGACY_WEB_ORIGIN } from 'astro:env/server';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  if (!LEGACY_WEB_ORIGIN) return json({ error: 'quote_signer_not_configured' }, 503);
  const body = await request.json().catch(() => null) as { listing?: unknown; buyer?: unknown } | null;
  if (!body || typeof body.listing !== 'string' || typeof body.buyer !== 'string'
    || !getListing(body.listing) || !/^0x[0-9a-fA-F]{40}$/.test(body.buyer)) {
    return json({ error: 'invalid_request' }, 400);
  }
  try {
    const upstream = await fetch(new URL('/api/market/quote', new URL(LEGACY_WEB_ORIGIN).origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ listing: body.listing, buyer: body.buyer }),
      signal: AbortSignal.timeout(15_000),
    });
    return json(await upstream.json(), upstream.status);
  } catch {
    return json({ error: 'quote_failed' }, 502);
  }
};
