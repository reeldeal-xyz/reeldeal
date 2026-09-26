// Fish market listings (issue #65 / SP-11): seafood from the Karakuwa / Kesennuma coast, sold in JPYC
// through SaleRouter, which pays the seller and donates `reliefBps` of every sale to ReliefPool in the
// same transaction. Each listing is sold in numbered lots: SaleRouter marks a listingId sold forever
// (double-sale protection), so every lot is its own on-chain listingId and the quote route hands out
// the next unsold lot.
import { keccak256, stringToHex, type Address, type Hex } from 'viem';

/** The Karakuwa licence holder's wallet (HOLDER_ADDRESS), selling on the co-op's behalf. */
export const MARKET_SELLER: Address = '0xF0A306A21C44d32C83C4D6a357A4d512B1A48600';

/** 5% of every sale goes to the relief fund (SaleRouter caps it at maxReliefBps = 10%). */
export const MARKET_RELIEF_BPS = 500;

/** How many lots of each listing exist; the quote route scans 1..MAX_LOTS for the first unsold one. */
export const MAX_LOTS = 40;

export interface Listing {
  /** Matches the Astro storefront's lot id (frontend/src/fixtures/preview-lots.ts), lowercased. */
  slug: string;
  name: string;
  nameJa: string;
  origin: string;
  unit: string;
  /** Whole yen. Must match the storefront's priceJpy -- the quote route signs this price. */
  priceYen: number;
  species: 'katsuo' | 'sanma' | 'saba' | 'hotate' | 'mebachi' | 'awabi';
  blurb: string;
}

// Eric's storefront catalogue (frontend/src/fixtures/preview-lots.ts), made purchasable.
export const LISTINGS: readonly Listing[] = [
  { slug: 'rd-lot-001', name: 'Skipjack tuna (katsuo)', nameJa: 'カツオ', origin: 'Kesennuma port', unit: '1,480 g · 412 mm', priceYen: 2800, species: 'katsuo', blurb: "Landed at Japan's top bonito port." },
  { slug: 'rd-lot-002', name: 'Pacific saury (sanma)', nameJa: 'サンマ', origin: 'Kesennuma port', unit: '265 g · 318 mm', priceYen: 760, species: 'sanma', blurb: 'Autumn saury, best salted and grilled.' },
  { slug: 'rd-lot-003', name: 'Chub mackerel (saba)', nameJa: 'サバ', origin: 'Kesennuma port', unit: '690 g · 365 mm', priceYen: 1240, species: 'saba', blurb: 'Rich winter mackerel.' },
  { slug: 'rd-lot-004', name: 'Scallop (hotate)', nameJa: 'ホタテ', origin: 'Karakuwa, Kesennuma', unit: '220 g · 110 mm', priceYen: 3800, species: 'hotate', blurb: 'Hanging-culture scallops from the plots this fund protects.' },
  { slug: 'rd-lot-005', name: 'Bigeye tuna (mebachi)', nameJa: 'メバチマグロ', origin: 'Kesennuma port', unit: '18,000 g · 1,100 mm', priceYen: 4500, species: 'mebachi', blurb: 'Longline-caught bigeye.' },
  { slug: 'rd-lot-006', name: 'Abalone (awabi)', nameJa: 'アワビ', origin: 'Karakuwa, Kesennuma', unit: '180 g · 95 mm', priceYen: 12000, species: 'awabi', blurb: 'Wild abalone from the Sanriku coast.' },
];

export function getListing(slug: string): Listing | undefined {
  return LISTINGS.find((l) => l.slug === slug);
}

/** The on-chain listingId for one lot of a listing. */
export function listingIdFor(slug: string, lot: number): Hex {
  return keccak256(stringToHex(`reeldeal:market:${slug}:${lot}`));
}

/** Seller and relief split of a price, mirroring SaleRouter._settle (relief rounds down). */
export function splitSale(total: bigint, reliefBps: number = MARKET_RELIEF_BPS): { seller: bigint; relief: bigint } {
  const relief = (total * BigInt(reliefBps)) / 10_000n;
  return { seller: total - relief, relief };
}
