// Recent activity for the LIFF wallet tab (issue #15 wallet management): merges ReliefPool Paid/Claimed
// (relief payouts landing on this wallet) with JPYC Transfer in/out (gasless sends via
// lib/liff/wallet-relay.ts, plus anything else that moved JPYC to/from this address) into one
// newest-first feed. Pure function over an injectable viem-shaped client (mirrors lib/liff/status.ts's
// `LiffStatusClient` pattern) so tests never touch a real RPC.
import { getAbiItem, type Address, type Hex, type PublicClient } from 'viem';
import { JpycAbi, ReliefPoolAbi } from '@repo/shared';

export type LiffWalletActivityClient = Pick<PublicClient, 'getLogs'>;

export type WalletActivityKind = 'paid' | 'claimed' | 'sent' | 'received';

export interface WalletActivityItem {
  kind: WalletActivityKind;
  amountWei: bigint;
  txHash: Hex;
  blockNumber: bigint;
  /** The other party for a JPYC transfer (recipient for 'sent', sender for 'received'). Absent for
   *  'paid'/'claimed' -- those already show the plot instead. */
  counterparty?: Address;
  plotLabel?: string;
}

const PAID_EVENT = getAbiItem({ abi: ReliefPoolAbi, name: 'Paid' });
const CLAIMED_EVENT = getAbiItem({ abi: ReliefPoolAbi, name: 'Claimed' });
const TRANSFER_EVENT = getAbiItem({ abi: JpycAbi, name: 'Transfer' });

export interface FetchWalletActivityParams {
  client: LiffWalletActivityClient;
  /** Omitted entirely when ReliefPool isn't deployed yet -- Paid/Claimed are just skipped. */
  reliefPoolAddress?: Address;
  jpycAddress: Address;
  wallet: Address;
  /** Bounds every log scan (NEXT_PUBLIC_RELIEF_POOL_DEPLOY_BLOCK). Defaults to 0n (genesis). */
  fromBlock?: bigint;
  limit?: number;
}

function sameAddress(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export async function fetchWalletActivity(params: FetchWalletActivityParams): Promise<WalletActivityItem[]> {
  const { client, reliefPoolAddress, jpycAddress, wallet, fromBlock = 0n, limit = 20 } = params;

  const [paidLogs, claimedLogs, sentLogs, receivedLogs] = await Promise.all([
    reliefPoolAddress
      ? client.getLogs({ address: reliefPoolAddress, event: PAID_EVENT, args: { farmer: wallet }, fromBlock, toBlock: 'latest' })
      : Promise.resolve([]),
    // `Claimed` doesn't index `farmer` (see ReliefPool.sol) -- fetch the range and filter client-side, like
    // lib/keeper/plots.ts's `listEnrolledPlots` does for its own non-indexed filter.
    reliefPoolAddress
      ? client.getLogs({ address: reliefPoolAddress, event: CLAIMED_EVENT, fromBlock, toBlock: 'latest' })
      : Promise.resolve([]),
    client.getLogs({ address: jpycAddress, event: TRANSFER_EVENT, args: { from: wallet }, fromBlock, toBlock: 'latest' }),
    client.getLogs({ address: jpycAddress, event: TRANSFER_EVENT, args: { to: wallet }, fromBlock, toBlock: 'latest' }),
  ]);

  const items: WalletActivityItem[] = [];

  for (const log of paidLogs) {
    const { amount, plotLabel } = log.args as { amount: bigint; plotLabel: string };
    items.push({
      kind: 'paid',
      amountWei: amount,
      txHash: (log.transactionHash ?? '0x') as Hex,
      blockNumber: log.blockNumber ?? 0n,
      plotLabel,
    });
  }

  for (const log of claimedLogs) {
    const { farmer, amount, plotLabel } = log.args as { farmer: Address; amount: bigint; plotLabel: string };
    if (!sameAddress(farmer, wallet)) continue;
    items.push({
      kind: 'claimed',
      amountWei: amount,
      txHash: (log.transactionHash ?? '0x') as Hex,
      blockNumber: log.blockNumber ?? 0n,
      plotLabel,
    });
  }

  for (const log of sentLogs) {
    const { to, value } = log.args as { to: Address; value: bigint };
    items.push({
      kind: 'sent',
      amountWei: value,
      txHash: (log.transactionHash ?? '0x') as Hex,
      blockNumber: log.blockNumber ?? 0n,
      counterparty: to,
    });
  }

  for (const log of receivedLogs) {
    const { from, value } = log.args as { from: Address; value: bigint };
    // A relief payout already appears as 'paid' above -- skip it here so it isn't double-counted as a
    // generic JPYC receive too.
    if (reliefPoolAddress && sameAddress(from, reliefPoolAddress)) continue;
    items.push({
      kind: 'received',
      amountWei: value,
      txHash: (log.transactionHash ?? '0x') as Hex,
      blockNumber: log.blockNumber ?? 0n,
      counterparty: from,
    });
  }

  items.sort((a, b) => Number(b.blockNumber - a.blockNumber));
  return items.slice(0, limit);
}
