import { decodeEventLog, type TransactionReceipt } from 'viem';
import { DEPLOYED, ReliefPoolAbi, SaleRouterAbi, splitSale, type Quote } from '@repo/shared';

export function hasMatchingCheckout(receipt: Pick<TransactionReceipt, 'status' | 'logs'>, quote: Quote) {
  if (receipt.status !== 'success') return false;
  const split = splitSale(quote.total, quote.reliefBps);
  let checkout = false, contribution = split.relief === 0n;
  for (const log of receipt.logs) {
    try {
      if (log.address.toLowerCase() === DEPLOYED.SaleRouter.toLowerCase()) {
        const event = decodeEventLog({ abi: SaleRouterAbi, eventName: 'Checkout', data: log.data, topics: log.topics });
        const q = event.args;
        checkout ||= q.orderId === quote.orderId && q.listingId === quote.listingId
          && q.buyer.toLowerCase() === quote.buyer.toLowerCase() && q.seller.toLowerCase() === quote.seller.toLowerCase()
          && q.total === quote.total && q.reliefBps === quote.reliefBps && q.sellerAmount === split.seller && q.reliefAmount === split.relief;
      }
      if (log.address.toLowerCase() === DEPLOYED.ReliefPool.toLowerCase()) {
        const event = decodeEventLog({ abi: ReliefPoolAbi, eventName: 'Donated', data: log.data, topics: log.topics });
        contribution ||= event.args.from.toLowerCase() === DEPLOYED.SaleRouter.toLowerCase()
          && event.args.amount === split.relief && event.args.memo === `sale:${quote.orderId}`;
      }
    } catch { /* Unrelated receipt log. */ }
  }
  return checkout && contribution;
}
