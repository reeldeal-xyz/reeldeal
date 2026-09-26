import { decodeEventLog, erc20Abi, type Address, type TransactionReceipt } from 'viem';
import { DEPLOYED, JPYC, ReliefPoolAbi } from '@repo/shared';
import type { PlotReliefStory } from './client.server';

export function hasMatchingPayment(
  plotLabel: string,
  settlement: NonNullable<PlotReliefStory['settlement']>,
  receipt: TransactionReceipt,
  poolAddress: Address = DEPLOYED.ReliefPool,
  tokenAddress: Address = JPYC,
): boolean {
  if (receipt.status !== 'success' || !settlement.txHash
    || receipt.transactionHash.toLowerCase() !== settlement.txHash.toLowerCase()
    || !['paid', 'claimed'].includes(settlement.state)
    || BigInt(settlement.amountWei) <= 0n) return false;
  const expected = settlement.state === 'claimed' ? 'Claimed' : 'Paid';
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== poolAddress.toLowerCase()) return false;
    try {
      const event = decodeEventLog({ abi: ReliefPoolAbi, data: log.data, topics: log.topics });
      if (event.eventName !== expected || (event.eventName !== 'Paid' && event.eventName !== 'Claimed')) return false;
      const { eventId, plotLabel: paidPlot, farmer, amount } = event.args;
      if (eventId.toLowerCase() !== settlement.eventId.toLowerCase() || paidPlot !== plotLabel
        || amount.toString() !== settlement.amountWei
        || (settlement.recipient && farmer.toLowerCase() !== settlement.recipient.toLowerCase())) return false;
      return receipt.logs.some((transferLog) => {
        if (transferLog.address.toLowerCase() !== tokenAddress.toLowerCase()) return false;
        try {
          const transfer = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: transferLog.data, topics: transferLog.topics });
          return transfer.args.from.toLowerCase() === poolAddress.toLowerCase()
            && transfer.args.to.toLowerCase() === farmer.toLowerCase()
            && transfer.args.value === amount;
        } catch { return false; }
      });
    } catch { return false; }
  });
}
