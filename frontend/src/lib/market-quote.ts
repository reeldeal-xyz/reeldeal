import { isAddress, isHex, parseUnits, size, type Address, type Hex } from 'viem';
import { DEPLOYED, JPYC_DECIMALS, MARKET_RELIEF_BPS, MARKET_SELLER, MAX_LOTS, listingIdFor, type Listing, type Quote } from '@repo/shared';

export function parseMarketQuote(input: unknown, listing: Listing, buyer: Address, now = Date.now() / 1000) {
  const fail = () => { throw new Error('Quote did not match this purchase. No payment sent.'); };
  if (!input || typeof input !== 'object') return fail();
  const body = input as Record<string, unknown>, q = body.quote as Record<string, unknown> | undefined;
  const address = (value: unknown, expected: Address) => typeof value === 'string' && isAddress(value) && value.toLowerCase() === expected.toLowerCase();
  const hex = (value: unknown, bytes: number) => typeof value === 'string' && isHex(value, { strict: true }) && size(value) === bytes;
  const decimal = (value: unknown) => typeof value === 'string' && /^\d{1,78}$/.test(value) && BigInt(value) < 2n ** 256n;
  const lot = body.lot;
  if (!q || !address(body.router, DEPLOYED.SaleRouter) || body.listing !== listing.slug
    || typeof lot !== 'number' || !Number.isInteger(lot) || lot < 1 || lot > MAX_LOTS
    || !address(q.buyer, buyer) || !address(q.seller, MARKET_SELLER)
    || !hex(q.orderId, 32) || !hex(q.listingId, 32) || q.listingId !== listingIdFor(listing.slug, lot)
    || !hex(body.signature, 65) || !decimal(q.total) || !decimal(q.nonce) || !decimal(q.expiry)
    || q.reliefBps !== MARKET_RELIEF_BPS) return fail();
  const quote: Quote = { orderId: q.orderId as Hex, listingId: q.listingId as Hex, buyer, seller: MARKET_SELLER,
    total: BigInt(q.total as string), nonce: BigInt(q.nonce as string), expiry: BigInt(q.expiry as string), reliefBps: MARKET_RELIEF_BPS };
  if (quote.total !== parseUnits(String(listing.priceYen), JPYC_DECIMALS)
    || quote.expiry < BigInt(Math.floor(now) + 30) || quote.expiry > BigInt(Math.floor(now) + 660)) return fail();
  return { quote, signature: body.signature as Hex, lot };
}
