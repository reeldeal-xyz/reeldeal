// Fixed demo listing for /market/checkout-demo. This is the only listing the SaleRouter checkout island
// knows about -- there is no listings API/database yet (tracked separately from this vertical slice).
// `sellerAddress` is a clearly-labeled demo wallet (the common "burn"/placeholder address), not a real
// fisher's payout wallet; swap it for a real seller once a listings source exists.
import { idOf } from '@repo/shared';
import type { Address, Hex } from 'viem';

export interface DemoListing {
  listingId: Hex;
  titleJa: string;
  titleEn: string;
  sellerAddress: Address;
  /** JPYC base units (18 decimals). ¥12,000. */
  totalWei: bigint;
  /** Contribution rate snapshotted into the quote at request time; must be <= the router's maxReliefBps. */
  reliefBps: number;
}

export const DEMO_LISTING: DemoListing = {
  listingId: idOf('reeldeal-demo-listing-katsuo-1'),
  titleJa: '本鰹 一本 (デモ出品)',
  titleEn: 'Whole bonito (demo listing)',
  sellerAddress: '0x000000000000000000000000000000000000dEaD',
  totalWei: 12_000n * 10n ** 18n,
  reliefBps: 500,
};
