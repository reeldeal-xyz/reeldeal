import type { APIRoute } from 'astro';
import { SEPOLIA_RPC_URL } from 'astro:env/server';
import { createSepoliaClient, getFundSummary } from '../../../lib/chain/client.server';

export const GET: APIRoute = async () => {
  try {
    const client = createSepoliaClient(SEPOLIA_RPC_URL);
    const summary = await getFundSummary(client);
    return Response.json(summary, { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch {
    return Response.json(
      { error: 'unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '15' } },
    );
  }
};
