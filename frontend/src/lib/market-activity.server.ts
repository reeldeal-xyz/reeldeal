import { getAbiItem, type Hex, type PublicClient } from 'viem';
import { DEPLOYED, LISTINGS, MAX_LOTS, SaleRouterAbi, listingIdFor, splitSale } from '@repo/shared';
import { readReliefPoolEvents } from './chain/client.server';

export type MarketSale = {
  orderId: Hex; listingId: Hex; txHash: Hex; blockNumber: string;
  total: string; sellerAmount: string; reliefAmount: string; reliefBps: number;
  listing: string | null; lot: number | null;
};
export type MarketActivity = { available: boolean; atBlock: string | null; sales: MarketSale[] };
const lots = new Map(LISTINGS.flatMap((listing) => Array.from({ length: MAX_LOTS }, (_, i) =>
  [listingIdFor(listing.slug, i + 1).toLowerCase(), { listing: listing.slug, lot: i + 1 }] as const)));

export function validSaleSplit(total: bigint, sellerAmount: bigint, reliefAmount: bigint, reliefBps: number) {
  if (total <= 0n || !Number.isInteger(reliefBps) || reliefBps < 0 || reliefBps > 10_000) return false;
  const expected = splitSale(total, reliefBps);
  return sellerAmount === expected.seller && reliefAmount === expected.relief;
}

export async function getMarketActivity(client: PublicClient, atBlock?: bigint): Promise<MarketActivity> {
  try {
    const block = atBlock ?? (await client.getBlockNumber({ cacheTime: 0 })) - 1n;
    const fromBlock = BigInt(DEPLOYED.ReliefPoolDeployBlock);
    if (block < fromBlock || block - fromBlock >= 2_000_000n) throw new Error('Unbounded sale history');
    const event = getAbiItem({ abi: SaleRouterAbi, name: 'Checkout' });
    const donations = await readReliefPoolEvents(client, DEPLOYED.ReliefPool, fromBlock, ['Donated'], block);
    const sales: MarketSale[] = [];
    for (let start = fromBlock; start <= block; start += 25_000n) {
      const end = start + 24_999n;
      const logs = await client.getLogs({ address: DEPLOYED.SaleRouter, event, fromBlock: start, toBlock: end < block ? end : block, strict: true });
      for (const log of logs) {
        const q = log.args;
        if (log.removed || !log.transactionHash || log.blockNumber === null
          || !validSaleSplit(q.total, q.sellerAmount, q.reliefAmount, q.reliefBps)
          || (q.reliefAmount > 0n && !donations.some((donation) => donation.txHash === log.transactionHash
            && donation.farmer?.toLowerCase() === DEPLOYED.SaleRouter.toLowerCase()
            && donation.memo === `sale:${q.orderId}` && donation.amountWei === q.reliefAmount.toString()))) {
          throw new Error('Sale contribution could not be verified');
        }
        const known = lots.get(q.listingId.toLowerCase());
        sales.push({ orderId: q.orderId, listingId: q.listingId, txHash: log.transactionHash, blockNumber: log.blockNumber.toString(),
          total: q.total.toString(), sellerAmount: q.sellerAmount.toString(), reliefAmount: q.reliefAmount.toString(), reliefBps: q.reliefBps,
          listing: known?.listing ?? null, lot: known?.lot ?? null });
      }
    }
    return { available: true, atBlock: block.toString(), sales: sales.reverse() };
  } catch { return { available: false, atBlock: null, sales: [] }; }
}
