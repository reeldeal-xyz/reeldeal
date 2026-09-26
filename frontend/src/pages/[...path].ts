import type { APIRoute } from 'astro';
import { LEGACY_WEB_ORIGIN } from 'astro:env/server';
import { isLegacyPage } from '../lib/legacy-routes';

const unavailable = () => new Response('This page is temporarily unavailable.', {
  status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '60' },
});

export const GET: APIRoute = ({ url, redirect }) => {
  if (!isLegacyPage(url.pathname)) return new Response('Not found', { status: 404 });
  if (!LEGACY_WEB_ORIGIN) return unavailable();
  const origin = new URL(LEGACY_WEB_ORIGIN);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin === url.origin) {
    return unavailable();
  }
  return redirect(new URL(url.pathname + url.search, origin.origin).href, 307);
};
