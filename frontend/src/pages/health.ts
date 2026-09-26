import type { APIRoute } from 'astro';

export const GET: APIRoute = () => Response.json(
  { status: 'ok', service: 'umi-frontend' },
  { headers: { 'cache-control': 'no-store' } },
);
