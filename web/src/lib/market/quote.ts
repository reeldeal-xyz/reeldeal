// Server-side quote builder for the fish market (issue #65 / SP-11). Picks the next unsold lot of a
// listing, fills in a fresh orderId / nonce / 10-minute expiry, and signs it with the co-op quote key
// (COOP_SIGNER_PRIVATE_KEY == SaleRouter.quoteSigner). The key never leaves the server.
import { isAddress, parseUnits, toHex, type Address, type Hex } from 'viem';
import { JPYC_DECIMALS, SaleRouterAbi, type Quote } from '@repo/shared';
import { getListing, listingIdFor, MARKET_RELIEF_BPS, MARKET_SELLER, MAX_LOTS, type Listing } from './listings';

const QUOTE_TTL_SECONDS = 600;

export interface QuoteDeps {
  router: Address;
  /** SaleRouter.soldListings(listingId). */
  isSold: (listingId: Hex) => Promise<boolean>;
  sign: (quote: Quote) => Promise<Hex>;
  randomBytes32: () => Hex;
  now: () => number;
}

export type QuoteResult =
  | { ok: true; listing: Listing; lot: number; quote: Quote; signature: Hex }
  | { ok: false; status: number; error: string };

export async function buildQuote(input: unknown, deps: QuoteDeps): Promise<QuoteResult> {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const listing = typeof record.listing === 'string' ? getListing(record.listing) : undefined;
  if (!listing) return { ok: false, status: 400, error: 'unknown_listing' };
  const buyer = record.buyer;
  if (typeof buyer !== 'string' || !isAddress(buyer)) return { ok: false, status: 400, error: 'invalid_buyer' };

  let lot = 0;
  for (let n = 1; n <= MAX_LOTS; n++) {
    if (!(await deps.isSold(listingIdFor(listing.slug, n)))) {
      lot = n;
      break;
    }
  }
  if (!lot) return { ok: false, status: 409, error: 'sold_out' };

  const quote: Quote = {
    orderId: deps.randomBytes32(),
    listingId: listingIdFor(listing.slug, lot),
    buyer: buyer as Address,
    seller: MARKET_SELLER,
    total: parseUnits(String(listing.priceYen), JPYC_DECIMALS),
    reliefBps: MARKET_RELIEF_BPS,
    nonce: BigInt(deps.randomBytes32()),
    expiry: BigInt(Math.floor(deps.now() / 1000) + QUOTE_TTL_SECONDS),
  };
  const signature = await deps.sign(quote);
  return { ok: true, listing, lot, quote, signature };
}

/** JSON-safe quote (bigints as decimal strings). */
export function serializeQuote(quote: Quote) {
  return { ...quote, total: quote.total.toString(), nonce: quote.nonce.toString(), expiry: quote.expiry.toString() };
}

export const soldListingsCall = (router: Address, listingId: Hex) =>
  ({ address: router, abi: SaleRouterAbi, functionName: 'soldListings', args: [listingId] }) as const;

export const randomBytes32 = (): Hex => toHex(crypto.getRandomValues(new Uint8Array(32)));

