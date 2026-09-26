export type Listing = { id: string; status: 'open' | 'closed'; priceJpy: number };
export type SignedOffer = { listingId: string; amountJpy: number; bidder: string; signature: string };
export type Receipt = { id: string; amountJpy: number; bidder: string };

/** Presentation boundary. The marketplace adapter supplies chain/API behavior in #66. */
export interface BidServices {
  load(lotId: string): Promise<Listing>;
  connect(): Promise<string>;
  sign(offer: Omit<SignedOffer, 'signature'>): Promise<SignedOffer>;
  submit(offer: SignedOffer): Promise<Receipt>;
}

export function parseOffer(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value.trim())) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}
