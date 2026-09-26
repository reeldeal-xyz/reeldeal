import { describe, expect, test } from 'bun:test';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { QUOTE_EIP712_TYPES, saleRouterEip712Domain, type Quote } from '@repo/shared';
import { listingIdFor, MARKET_SELLER, splitSale } from './listings';
import { buildQuote, type QuoteDeps } from './quote';

const ROUTER = '0xfc178e7fA7b3119e2E233FeDF5e2E317D95658bd' as const;
const BUYER = '0x1aEDC8476f15BdF1Ac742544c58Be3a187eEAB51' as const;
const signer = privateKeyToAccount(`0x${'22'.repeat(32)}`);

function deps(sold: Set<Hex> = new Set()): QuoteDeps {
  let n = 0;
  return {
    router: ROUTER,
    isSold: async (id) => sold.has(id),
    sign: (quote) =>
      signer.signTypedData({ domain: saleRouterEip712Domain(ROUTER), types: QUOTE_EIP712_TYPES, primaryType: 'Quote', message: quote }),
    randomBytes32: () => `0x${(++n).toString(16).padStart(64, '0')}`,
    now: () => Date.parse('2026-09-27T00:00:00Z'),
  };
}

describe('buildQuote', () => {
  test('signs a quote for lot 1 that recovers to the co-op signer', async () => {
    const r = await buildQuote({ listing: 'rd-lot-004', buyer: BUYER }, deps());
    if (!r.ok) throw new Error(r.error);
    expect(r.lot).toBe(1);
    expect(r.quote).toMatchObject({ listingId: listingIdFor('rd-lot-004', 1), buyer: BUYER, seller: MARKET_SELLER, total: 3800n * 10n ** 18n, reliefBps: 500 });
    expect(r.quote.expiry).toBe(BigInt(Date.parse('2026-09-27T00:10:00Z') / 1000));
    const recovered = await recoverTypedDataAddress({
      domain: saleRouterEip712Domain(ROUTER),
      types: QUOTE_EIP712_TYPES,
      primaryType: 'Quote',
      message: r.quote as Quote,
      signature: r.signature,
    });
    expect(recovered).toBe(signer.address);
  });

  test('skips sold lots and reports sold out when every lot is gone', async () => {
    const sold = new Set<Hex>([listingIdFor('rd-lot-002', 1), listingIdFor('rd-lot-002', 2)]);
    const r = await buildQuote({ listing: 'rd-lot-002', buyer: BUYER }, deps(sold));
    expect(r.ok && r.lot).toBe(3);

    const all = new Set<Hex>(Array.from({ length: 40 }, (_, i) => listingIdFor('rd-lot-002', i + 1)));
    expect(await buildQuote({ listing: 'rd-lot-002', buyer: BUYER }, deps(all))).toEqual({ ok: false, status: 409, error: 'sold_out' });
  });

  test('rejects unknown listings and bad buyers', async () => {
    expect(await buildQuote({ listing: 'tuna', buyer: BUYER }, deps())).toMatchObject({ ok: false, error: 'unknown_listing' });
    expect(await buildQuote({ listing: 'rd-lot-004', buyer: '0x123' }, deps())).toMatchObject({ ok: false, error: 'invalid_buyer' });
  });

  test('splitSale rounds the relief share down like SaleRouter', () => {
    expect(splitSale(3800n * 10n ** 18n)).toEqual({ seller: 3610n * 10n ** 18n, relief: 190n * 10n ** 18n });
    expect(splitSale(19n)).toEqual({ seller: 19n, relief: 0n });
  });

  test('aquaculture purchases retain their seller and relief allocation', async () => {
    for (const [listing, price] of [['rd-lot-004', 3800], ['kesennuma-hoya', 1800], ['karakuwa-oysters', 4200]] as const) {
      const result = await buildQuote({ listing, buyer: BUYER }, deps());
      if (!result.ok) throw new Error(result.error);
      expect(result.quote.total).toBe(BigInt(price) * 10n ** 18n);
      expect(result.quote.reliefBps).toBe(500);
      expect(result.quote.listingId).toBe(listingIdFor(listing, 1));
    }
  });
});
