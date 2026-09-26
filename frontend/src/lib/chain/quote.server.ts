// POST /api/market/quote request validation + signing (docs/SALE-ROUTER.md). Validation is a pure
// function so it's unit-testable without astro:env or a live signer; signing needs the co-op key and
// stays a thin wrapper the API route calls with its own `astro:env/server` secret.
import { createWalletClient, http, isAddress, isHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { signSaleQuote, type Quote } from '@repo/shared';

/** Router's configured ceiling (packages/shared/src/addresses.ts DEPLOYED comment: maxReliefBps 1000). */
export const MAX_RELIEF_BPS = 1000;

export interface QuoteRequestInput {
  listingId?: unknown;
  buyer?: unknown;
  seller?: unknown;
  total?: unknown;
  reliefBps?: unknown;
}

export interface QuoteRequestFields {
  listingId: Hex;
  buyer: Address;
  seller: Address;
  total: bigint;
  reliefBps: number;
}

export type QuoteRequestResult =
  | { ok: true; value: QuoteRequestFields }
  | { ok: false; error: string };

/** Validates a POST /api/market/quote body: {listingId, buyer, seller, total, reliefBps <= MAX_RELIEF_BPS}. */
export function parseQuoteRequest(body: unknown): QuoteRequestResult {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'invalid-request' };
  const b = body as QuoteRequestInput;
  if (typeof b.listingId !== 'string' || !isHex(b.listingId) || b.listingId.length !== 66) {
    return { ok: false, error: 'invalid-listingId' };
  }
  if (typeof b.buyer !== 'string' || !isAddress(b.buyer)) return { ok: false, error: 'invalid-buyer' };
  if (typeof b.seller !== 'string' || !isAddress(b.seller)) return { ok: false, error: 'invalid-seller' };
  if (typeof b.total !== 'string' || !/^\d+$/.test(b.total)) return { ok: false, error: 'invalid-total' };
  const total = BigInt(b.total);
  if (total <= 0n) return { ok: false, error: 'invalid-total' };
  if (typeof b.reliefBps !== 'number' || !Number.isInteger(b.reliefBps) || b.reliefBps < 0 || b.reliefBps > MAX_RELIEF_BPS) {
    return { ok: false, error: 'invalid-reliefBps' };
  }
  return {
    ok: true,
    value: { listingId: b.listingId as Hex, buyer: b.buyer as Address, seller: b.seller as Address, total, reliefBps: b.reliefBps },
  };
}

const randomHex32 = (): Hex => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
};

/** Fresh per-order nonce; independent of orderId/listingId (docs/SALE-ROUTER.md). */
const randomNonce = (): bigint => BigInt(randomHex32());

export interface SignedQuote {
  quote: {
    orderId: Hex; listingId: Hex; buyer: Address; seller: Address;
    total: string; reliefBps: number; nonce: string; expiry: string;
  };
  signature: Hex;
  router: Address;
}

/** Builds a fresh Quote (orderId/nonce, 10-minute expiry) and signs it with the co-op quote-signer key.
 *  Server-only: `quoteSignerPrivateKey` must never reach the client. */
export async function signQuoteRequest(
  fields: QuoteRequestFields,
  quoteSignerPrivateKey: Hex,
  routerAddress: Address,
  rpcUrl: string,
): Promise<SignedQuote> {
  const account = privateKeyToAccount(quoteSignerPrivateKey);
  const client = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });

  const quote: Quote = {
    orderId: randomHex32(),
    listingId: fields.listingId,
    buyer: fields.buyer,
    seller: fields.seller,
    total: fields.total,
    reliefBps: fields.reliefBps,
    nonce: randomNonce(),
    expiry: BigInt(Math.floor(Date.now() / 1000) + 10 * 60),
  };

  const signature = await signSaleQuote(client, account, routerAddress, quote);

  return {
    quote: {
      orderId: quote.orderId,
      listingId: quote.listingId,
      buyer: quote.buyer,
      seller: quote.seller,
      total: quote.total.toString(),
      reliefBps: quote.reliefBps,
      nonce: quote.nonce.toString(),
      expiry: quote.expiry.toString(),
    },
    signature,
    router: routerAddress,
  };
}
