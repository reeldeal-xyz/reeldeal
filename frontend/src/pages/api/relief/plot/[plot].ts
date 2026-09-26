import type { APIRoute } from 'astro';
import { SEPOLIA_RPC_URL } from 'astro:env/server';
import { createSepoliaClient, getPlotReliefStory } from '../../../../lib/chain/client.server';
import { deployedEventHint } from '../../../../lib/relief-evidence';

export const GET: APIRoute = async ({ params, url }) => {
  const plotLabel = params.plot ? decodeURIComponent(params.plot) : '';
  if (!plotLabel) {
    return Response.json({ error: 'invalid-request' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  const requestedSeason = url.searchParams.get('season') ?? '';
  const season = /^20\d{2}$/.test(requestedSeason) ? requestedSeason : '2026';
  try {
    const client = createSepoliaClient(SEPOLIA_RPC_URL);
    const status = await getPlotReliefStory(client, plotLabel, season, { eventIdHint: deployedEventHint(plotLabel, season) });
    return Response.json(status, { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch {
    return Response.json(
      { error: 'unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '15' } },
    );
  }
};
