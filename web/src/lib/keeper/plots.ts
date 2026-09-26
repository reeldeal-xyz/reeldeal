// Discovers which plots to settle for a zone/species (issue #17: "settle ... plot labels from the pool's
// enrolled plots"). ReliefPool has no enumerable plot list, only `plots(label)` keyed by label and an
// `Enrolled` event emitted by every `enroll`/`reindex` call -- so the keeper scans that event's history for
// every plotLabel ever seen, then reads each one's *current* `plots(label)` to filter to plots presently
// enrolled for the target zone/species (a plot can be reindexed away after being enrolled; `plots()` is
// the authoritative current state, the event log is only used to discover candidate labels).
import { getAbiItem, type Address, type Hex } from 'viem';
import { ReliefPoolAbi } from '@repo/shared';
import type { KeeperPublicClient } from './chain-clients';

const ENROLLED_EVENT = getAbiItem({ abi: ReliefPoolAbi, name: 'Enrolled' });

export interface ListEnrolledPlotsParams {
  publicClient: KeeperPublicClient;
  poolAddress: Address;
  zoneId: Hex;
  speciesId: Hex;
  /** Defaults to 0n (scan from genesis) -- set RELIEF_POOL_DEPLOY_BLOCK on a public RPC to bound this. */
  fromBlock?: bigint;
}

/** Plot labels currently enrolled for `zoneId`/`speciesId`, sorted for deterministic batching. */
export async function listEnrolledPlots(params: ListEnrolledPlotsParams): Promise<string[]> {
  const logs = await params.publicClient.getLogs({
    address: params.poolAddress,
    event: ENROLLED_EVENT,
    fromBlock: params.fromBlock ?? 0n,
    toBlock: 'latest',
  });

  const candidates = new Set<string>();
  for (const log of logs) {
    const plotLabel = (log as unknown as { args: { plotLabel?: string } }).args.plotLabel;
    if (plotLabel) candidates.add(plotLabel);
  }

  const matches: string[] = [];
  for (const plotLabel of candidates) {
    const [zoneId, speciesId, enrolled] = await params.publicClient.readContract({
      address: params.poolAddress,
      abi: ReliefPoolAbi,
      functionName: 'plots',
      args: [plotLabel],
    });
    if (enrolled && zoneId === params.zoneId && speciesId === params.speciesId) {
      matches.push(plotLabel);
    }
  }

  return matches.sort();
}

/** Splits `plotLabels` into fixed-size batches (issue #17: "settle in batches of 5 plots"). */
export function batchPlots(plotLabels: readonly string[], batchSize = 5): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < plotLabels.length; i += batchSize) {
    batches.push(plotLabels.slice(i, i + batchSize));
  }
  return batches;
}
