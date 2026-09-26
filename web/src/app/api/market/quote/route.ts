// POST /api/market/quote {listing, buyer} -> a co-op-signed SaleRouter quote for the next unsold lot.
// Public: a quote only lets the named buyer pay the fixed price to the co-op seller, with the relief share
// going to ReliefPool, so there's nothing to protect beyond the signing key itself.
import { createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { DEPLOYED, signSaleQuote } from '@repo/shared';
import { env } from '@/lib/env';
import { getKeeperPublicClient } from '@/lib/keeper/chain-clients';
import { buildQuote, randomBytes32, serializeQuote, soldListingsCall } from '@/lib/market/quote';
import { sepoliaTransport } from '@/lib/rpc';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const key = env.coopSignerPrivateKey();
  if (!key) return Response.json({ error: 'quote_signer_not_configured' }, { status: 503 });
  const router = DEPLOYED.SaleRouter as Address;
  const account = privateKeyToAccount(key as Hex);
  const wallet = createWalletClient({ account, chain: sepolia, transport: sepoliaTransport() });
  const publicClient = getKeeperPublicClient();

  const body = await req.json().catch(() => null);
  try {
    const result = await buildQuote(body, {
      router,
      isSold: (listingId) => publicClient.readContract(soldListingsCall(router, listingId)) as Promise<boolean>,
      sign: (quote) => signSaleQuote(wallet, account, router, quote),
      randomBytes32,
      now: () => Date.now(),
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({
      router,
      listing: result.listing.slug,
      lot: result.lot,
      quote: serializeQuote(result.quote),
      signature: result.signature,
    });
  } catch (err) {
    console.error('[market/quote] failed', err);
    return Response.json({ error: 'quote_failed', message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
