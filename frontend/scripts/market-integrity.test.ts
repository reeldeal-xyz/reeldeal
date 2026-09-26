import { expect, test } from 'bun:test';
import { encodeAbiParameters, encodeEventTopics, type PublicClient, type TransactionReceipt } from 'viem';
import { DEPLOYED, LISTINGS, MARKET_SELLER, ReliefPoolAbi, SaleRouterAbi, listingIdFor } from '@repo/shared';
import { parseMarketQuote } from '../src/lib/market-quote';
import { hasMatchingCheckout } from '../src/lib/market-proof';
import { getMarketActivity, validSaleSplit } from '../src/lib/market-activity.server';

const buyer = '0x1111111111111111111111111111111111111111';
const hash = `0x${'a'.repeat(64)}` as const;
const now = 1790000000;
const listing = LISTINGS[0];
const response = () => ({ router: DEPLOYED.SaleRouter, listing: listing.slug, lot: 1, signature: `0x${'b'.repeat(130)}`,
  quote: { orderId: hash, listingId: listingIdFor(listing.slug, 1), buyer, seller: MARKET_SELLER,
    total: '3200000000000000000000', reliefBps: 500, nonce: '1', expiry: String(now + 600) } });

test('checkout refuses changed buyer, seller, amount, split, router, lot, signature and expiry', () => {
  expect(parseMarketQuote(response(), listing, buyer, now).quote.total).toBe(3200n * 10n ** 18n);
  for (const mutation of [
    { total: '1' }, { seller: buyer }, { buyer: MARKET_SELLER }, { reliefBps: 0 }, { reliefBps: 1000 },
    { listingId: hash }, { nonce: '-1' }, { nonce: (2n ** 256n).toString() }, { expiry: String(now - 1) }, { expiry: String(now + 1000) },
  ]) expect(() => parseMarketQuote({ ...response(), quote: { ...response().quote, ...mutation } }, listing, buyer, now)).toThrow();
  for (const mutation of [{ router: buyer }, { listing: 'other' }, { lot: 2 }, { lot: 41 }, { signature: '0x12' }]) {
    expect(() => parseMarketQuote({ ...response(), ...mutation }, listing, buyer, now)).toThrow();
  }
});

const quote = parseMarketQuote(response(), listing, buyer, now).quote;
function receipt(): TransactionReceipt {
  return { status: 'success', logs: [
    { address: DEPLOYED.SaleRouter,
      topics: encodeEventTopics({ abi: SaleRouterAbi, eventName: 'Checkout', args: { orderId: quote.orderId, listingId: quote.listingId, buyer } }),
      data: encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint16' }],
        [MARKET_SELLER, quote.total, 3040n * 10n ** 18n, 160n * 10n ** 18n, 500]),
    },
    { address: DEPLOYED.ReliefPool,
      topics: encodeEventTopics({ abi: ReliefPoolAbi, eventName: 'Donated', args: { from: DEPLOYED.SaleRouter } }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'string' }], [160n * 10n ** 18n, `sale:${quote.orderId}`]),
    },
  ] } as unknown as TransactionReceipt;
}

test('success requires both the matching checkout and relief contribution in the successful receipt', () => {
  const r = receipt();
  expect(hasMatchingCheckout(r, quote)).toBe(true);
  expect(hasMatchingCheckout({ ...r, status: 'reverted' }, quote)).toBe(false);
  expect(hasMatchingCheckout({ ...r, logs: r.logs.slice(0, 1) }, quote)).toBe(false);
  expect(hasMatchingCheckout({ ...r, logs: r.logs.slice(1) }, quote)).toBe(false);
  expect(hasMatchingCheckout(r, { ...quote, total: 1n })).toBe(false);
  expect(hasMatchingCheckout(r, { ...quote, buyer: MARKET_SELLER })).toBe(false);
  r.logs[1].address = buyer;
  expect(hasMatchingCheckout(r, quote)).toBe(false);
  expect(validSaleSplit(101n, 96n, 5n, 500)).toBe(true);
  expect(validSaleSplit(101n, 95n, 6n, 500)).toBe(false);
});

test('market history distinguishes RPC failure from no sales and excludes unconfirmed blocks', async () => {
  const blocks: bigint[] = [];
  const reader = { getBlockNumber: async () => BigInt(DEPLOYED.ReliefPoolDeployBlock) + 10n,
    getLogs: async ({ toBlock }: { toBlock: bigint }) => { blocks.push(toBlock); return []; },
  } as unknown as PublicClient;
  expect(await getMarketActivity(reader)).toMatchObject({ available: true, sales: [] });
  expect(blocks.every((block) => block === BigInt(DEPLOYED.ReliefPoolDeployBlock) + 9n)).toBe(true);
  reader.getLogs = async () => { throw new Error('offline'); };
  expect(await getMarketActivity(reader)).toEqual({ available: false, atBlock: null, sales: [] });
});

test('market history requires a matching router donation, not a sale-shaped memo', async () => {
  const block = BigInt(DEPLOYED.ReliefPoolDeployBlock) + 10n;
  let from: string = DEPLOYED.SaleRouter;
  const reader = { getLogs: async ({ address }: { address: string }) => address === DEPLOYED.ReliefPool
    ? [{ eventName: 'Donated', transactionHash: hash, blockNumber: block, logIndex: 0,
      args: { from, amount: 160n * 10n ** 18n, memo: `sale:${quote.orderId}` } }]
    : [{ transactionHash: hash, blockNumber: block, removed: false,
      args: { ...quote, sellerAmount: 3040n * 10n ** 18n, reliefAmount: 160n * 10n ** 18n } }],
  } as unknown as PublicClient;
  const valid = await getMarketActivity(reader, block);
  expect(valid.available).toBe(true);
  expect(valid.sales[0]).toMatchObject({ listing: listing.slug, total: quote.total.toString(), reliefAmount: (160n * 10n ** 18n).toString() });
  from = buyer;
  expect(await getMarketActivity(reader, block)).toEqual({ available: false, atBlock: null, sales: [] });
});
