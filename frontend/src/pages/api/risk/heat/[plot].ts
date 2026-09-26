import type { APIRoute } from 'astro';
import { PIPELINE_API_URL } from 'astro:env/server';
import { readHeatRisk } from '../../../../lib/heat-risk.server';

export const GET: APIRoute = async ({ params, url, request }) => {
  const result = await readHeatRisk({
    origin: PIPELINE_API_URL, plotCode: params.plot ?? '',
    season: url.searchParams.get('season') ?? '', signal: request.signal,
  });
  const status = result.data ? 200
    : result.status === 'invalid-request' ? 400
    : result.status === 'not-found' ? 404
    : result.status === 'unimplemented' ? 501
    : result.status === 'invalid-payload' ? 502
    : result.status === 'timeout' ? 504
    : result.status === 'cancelled' ? 499 : 503;
  return Response.json(result, { status, headers: {
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  } });
};
