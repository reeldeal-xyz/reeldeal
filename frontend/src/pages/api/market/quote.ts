import type { APIRoute } from 'astro';
import { QUOTE_SIGNER_PRIVATE_KEY, SEPOLIA_RPC_URL } from 'astro:env/server';
import type { Hex } from 'viem';
import { DEPLOYED } from '@repo/shared';
import { matchesDemoListing, parseQuoteRequest, signQuoteRequest } from '../../../lib/chain/quote.server';

export const POST: APIRoute = async ({ request }) => {
  if (!QUOTE_SIGNER_PRIVATE_KEY) {
    return Response.json({ error: 'not-configured' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid-json' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const parsed = parseQuoteRequest(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  if (!matchesDemoListing(parsed.value)) {
    return Response.json({ error: 'listing-unavailable' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  try {
    const signed = await signQuoteRequest(parsed.value, QUOTE_SIGNER_PRIVATE_KEY as Hex, DEPLOYED.SaleRouter, SEPOLIA_RPC_URL);
    return Response.json(signed, { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch {
    return Response.json({ error: 'signing-failed' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
};
