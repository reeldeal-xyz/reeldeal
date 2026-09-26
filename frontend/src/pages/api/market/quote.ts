import type { APIRoute } from 'astro';
import { COOP_SIGNER_PRIVATE_KEY, SEPOLIA_RPC_URL } from 'astro:env/server';
import { privateKeyToAccount } from 'viem/accounts';
import { type Hex } from 'viem';
import { DEPLOYED, JPYC, MARKET_RELIEF_BPS, QUOTE_EIP712_TYPES, SaleRouterAbi, buildQuote, randomBytes32, saleRouterEip712Domain, serializeQuote, soldListingsCall } from '@repo/shared';
import { createSepoliaClient } from '../../../lib/chain/client.server';

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
let active = 0;
export const POST: APIRoute = async ({ request, url }) => {
  const reply = (error: string, status: number) => Response.json({ error }, { status, headers });
  if (request.headers.get('origin') !== url.origin) return reply('invalid_origin', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply('invalid_body', 415);
  if (!COOP_SIGNER_PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(COOP_SIGNER_PRIVATE_KEY)) return reply('checkout_unavailable', 503);
  if (active >= 4) return reply('busy', 429);
  active++;
  const reader = request.body?.getReader();
  try {
    if (!reader) return reply('invalid_body', 400);
    let size = 0, body = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const timeout = setTimeout(() => { void reader.cancel().catch(() => {}); }, 5000);
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > 1024) return reply('invalid_body', 413);
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally { clearTimeout(timeout); }
    let input: unknown; try { input = JSON.parse(body); } catch { return reply('invalid_body', 400); }
    const account = privateKeyToAccount(COOP_SIGNER_PRIVATE_KEY as Hex);
    const client = createSepoliaClient(SEPOLIA_RPC_URL);
    const read = <T extends 'quoteSigner' | 'maxReliefBps' | 'paused' | 'jpyc' | 'pool'>(functionName: T) =>
      client.readContract({ address: DEPLOYED.SaleRouter, abi: SaleRouterAbi, functionName });
    const [signer, cap, paused, token, pool] = await Promise.all([read('quoteSigner'), read('maxReliefBps'), read('paused'), read('jpyc'), read('pool')]);
    if (signer.toLowerCase() !== account.address.toLowerCase() || cap < MARKET_RELIEF_BPS || paused
      || token.toLowerCase() !== JPYC.toLowerCase() || pool.toLowerCase() !== DEPLOYED.ReliefPool.toLowerCase()) return reply('checkout_unavailable', 503);
    const result = await buildQuote(input, {
      router: DEPLOYED.SaleRouter,
      isSold: (listingId) => client.readContract(soldListingsCall(DEPLOYED.SaleRouter, listingId)),
      sign: (quote) => account.signTypedData({ domain: saleRouterEip712Domain(DEPLOYED.SaleRouter), types: QUOTE_EIP712_TYPES, primaryType: 'Quote', message: quote }),
      randomBytes32, now: Date.now,
    });
    if (!result.ok) return reply(result.error, result.status);
    return Response.json({ router: DEPLOYED.SaleRouter, listing: result.listing.slug, lot: result.lot,
      quote: serializeQuote(result.quote), signature: result.signature }, { headers });
  } catch { return reply('checkout_unavailable', 503); }
  finally { active--; await reader?.cancel().catch(() => {}); }
};
