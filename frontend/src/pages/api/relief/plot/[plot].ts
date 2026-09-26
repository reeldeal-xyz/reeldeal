import type { APIRoute } from 'astro';
import { SEPOLIA_RPC_URL } from 'astro:env/server';
import { createSepoliaClient, getPlotReliefStory } from '../../../../lib/chain/client.server';
import { deployedEventHint } from '../../../../lib/relief-evidence';
import { parseReliefRequest } from '../../../../lib/relief-request';

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export const GET: APIRoute = async ({ params, url }) => {
  const input = parseReliefRequest(params.plot, url.searchParams);
  if (!input) return Response.json({ error: 'invalid-request' }, { status: 400, headers });
  try {
    const client = createSepoliaClient(SEPOLIA_RPC_URL);
    const story = await getPlotReliefStory(client, input.plotLabel, input.season, {
      eventId: input.eventId,
      eventIdHint: deployedEventHint(input.plotLabel, input.season),
    });
    const unavailable = !story.plotReadAvailable || !story.targetReadAvailable || story.settlementReadStatus === 'unavailable';
    const status = unavailable ? 503 : (story.enrolled === false || input.eventId) && !story.settlement ? 404 : 200;
    return Response.json(story, { status, headers: { ...headers, ...(unavailable ? { 'retry-after': '15' } : {}) } });
  } catch {
    return Response.json({ error: 'unavailable' }, { status: 503, headers: { ...headers, 'retry-after': '15' } });
  }
};
