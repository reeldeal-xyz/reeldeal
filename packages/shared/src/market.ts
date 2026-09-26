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
  slug: string;
  name: string;
  nameJa: string;
  origin: string;
  unit: string;
  /** Whole yen. */
  priceYen: number;
  species: 'scallop' | 'hoya' | 'oyster' | 'katsuo' | 'sanma' | 'wakame';
  blurb: string;
}

export const LISTINGS: readonly Listing[] = [
  {
    slug: 'karakuwa-scallops',
    name: 'Karakuwa scallops',
    nameJa: '唐桑産ホタテ',
    origin: 'Karakuwa, Kesennuma',
    unit: '1 kg, in shell',
    priceYen: 3200,
    species: 'scallop',
    blurb: 'Hanging-culture scallops from the plots this fund protects.',
  },
  {
    slug: 'kesennuma-hoya',
    name: 'Sea pineapple (hoya)',
    nameJa: '気仙沼産ホヤ',
    origin: 'Kesennuma Bay',
    unit: '5 pieces',
    priceYen: 1800,
    species: 'hoya',
    blurb: 'Sweet, briny and in season through summer.',
  },
  {
    slug: 'karakuwa-oysters',
    name: 'Karakuwa oysters',
    nameJa: '唐桑産カキ',
    origin: 'Karakuwa, Kesennuma',
    unit: '12 pieces',
    priceYen: 4200,
    species: 'oyster',
    blurb: 'Raised in the same waters as the scallops, shucked to order.',
  },
  {
    slug: 'kesennuma-katsuo',
    name: 'Whole bonito (katsuo)',
    nameJa: '気仙沼産カツオ',
    origin: 'Kesennuma port',
    unit: '1 fish, ~2.5 kg',
    priceYen: 12000,
    species: 'katsuo',
    blurb: "Landed at Japan's top bonito port.",
  },
  {
    slug: 'kesennuma-sanma',
    name: 'Pacific saury (sanma)',
    nameJa: '気仙沼産サンマ',
    origin: 'Kesennuma port',
    unit: '10 fish',
    priceYen: 2500,
    species: 'sanma',
    blurb: 'Autumn saury, best salted and grilled.',
  },
  {
    slug: 'karakuwa-wakame',
    name: 'Wakame seaweed',
    nameJa: '唐桑産ワカメ',
    origin: 'Karakuwa, Kesennuma',
    unit: '500 g, salted',
    priceYen: 900,
    species: 'wakame',
    blurb: 'Farmed alongside the shellfish lines in winter.',
  },
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
