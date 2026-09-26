// Server-side Sepolia reads for ReliefPool/SaleRouter/HumanRegistry (frontend<->contracts wiring).
// Pure, typed functions over an injected PublicClient so tests can supply a mock -- no module-level
// singleton client and no network access at import time. `astro:env/server`'s SEPOLIA_RPC_URL is read
// once by the API routes/pages that call `createSepoliaClient`, never here.
import {
  createPublicClient, http, getAbiItem,
  type AbiEvent, type Address, type Hex, type PublicClient,
} from 'viem';
import { sepolia } from 'viem/chains';
import { DEPLOYED, JPYC, JpycAbi, ReliefPoolAbi, HumanRegistryAbi } from '@repo/shared';

export function createSepoliaClient(rpcUrl: string): PublicClient {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
}

/** Event names read off ReliefPool for the fund dashboard and per-plot settlement lookups. */
const RELIEF_POOL_EVENT_NAMES = ['Donated', 'Attested', 'Paid', 'Held', 'Claimed', 'Swept'] as const;
export type ReliefPoolEventName = (typeof RELIEF_POOL_EVENT_NAMES)[number];

export interface ReliefPoolEvent {
  type: ReliefPoolEventName;
  blockNumber: number;
  txHash: Hex;
  logIndex: number;
  eventId?: Hex;
  plotLabel?: string;
  amountWei?: string;
  memo?: string;
  /** True when a Donated memo matches `sale:<orderId>` -- a SaleRouter marketplace checkout, not a direct donor. */
  isMarketplaceSale?: boolean;
  farmer?: Address;
  reason?: Hex;
}

const MARKETPLACE_SALE_MEMO = /^sale:/i;
export const isMarketplaceSaleMemo = (memo: string | undefined): boolean =>
  Boolean(memo && MARKETPLACE_SALE_MEMO.test(memo));

function reliefPoolEvents(names: readonly ReliefPoolEventName[]): AbiEvent[] {
  return names
    .map((name) => {
      try { return getAbiItem({ abi: ReliefPoolAbi, name }) as AbiEvent; } catch { return undefined; }
    })
    .filter((event): event is AbiEvent => Boolean(event));
}

/** Fetches and maps the requested ReliefPool events from `fromBlock` to `latest`. Never throws on a
 *  read/parse problem in an individual log; callers decide fallback behavior for a failed `getLogs` call. */
export async function readReliefPoolEvents(
  client: PublicClient,
  poolAddress: Address,
  fromBlock: bigint,
  names: readonly ReliefPoolEventName[] = RELIEF_POOL_EVENT_NAMES,
): Promise<ReliefPoolEvent[]> {
  const events = reliefPoolEvents(names);
  if (!events.length) return [];
  const logs = await client.getLogs({ address: poolAddress, events, fromBlock, toBlock: 'latest' });
  return logs.map((log) => {
    const args = (log.args ?? {}) as Record<string, unknown>;
    const type = log.eventName as ReliefPoolEventName;
    const memo = type === 'Donated' ? (args.memo as string | undefined) : undefined;
    const amount = args.amount as bigint | undefined;
    return {
      type,
      blockNumber: Number(log.blockNumber ?? 0n),
      txHash: (log.transactionHash ?? '0x') as Hex,
      logIndex: log.logIndex ?? 0,
      eventId: args.eventId as Hex | undefined,
      plotLabel: args.plotLabel as string | undefined,
      amountWei: amount !== undefined ? amount.toString() : undefined,
      memo,
      isMarketplaceSale: type === 'Donated' ? isMarketplaceSaleMemo(memo) : undefined,
      farmer: (args.farmer as Address | undefined) ?? (args.from as Address | undefined),
      reason: type === 'Held' ? (args.reason as Hex | undefined) : undefined,
    };
  });
}

export interface FundTotals {
  /** Sum of Donated.amount over the scanned range, JPYC base units (18 decimals). */
  donatedWei: string;
  /** Sum of Paid.amount over the scanned range, JPYC base units. */
  paidWei: string;
  /** Held events not yet followed by a Claimed/Swept for the same eventId -- an approximation from the
   *  event list alone, clamped to >= 0, not a per-plot on-chain status read. */
  heldCount: number;
}

export interface FundSummary {
  poolAddress: Address;
  fromBlock: string;
  /** Pool's live JPYC balance; null when the read failed (RPC down, bad address). */
  availableWei: string | null;
  /** ReliefPool.reserved() -- JPYC already committed to attested-but-unclaimed payouts. */
  reservedWei: string | null;
  totals: FundTotals;
  /** Most recent events first. */
  events: ReliefPoolEvent[];
  fetchedAt: string;
}

export function computeFundTotals(events: ReliefPoolEvent[]): FundTotals {
  let donated = 0n;
  let paid = 0n;
  let held = 0;
  let resolved = 0;
  for (const event of events) {
    if (event.type === 'Donated' && event.amountWei) donated += BigInt(event.amountWei);
    if (event.type === 'Paid' && event.amountWei) paid += BigInt(event.amountWei);
    if (event.type === 'Held') held++;
    if (event.type === 'Claimed' || event.type === 'Swept') resolved++;
  }
  return { donatedWei: donated.toString(), paidWei: paid.toString(), heldCount: Math.max(0, held - resolved) };
}

export interface GetFundSummaryOptions {
  poolAddress?: Address;
  fromBlock?: bigint;
  /** How many most-recent events to return (after sorting), independent of how many are scanned for totals. */
  limit?: number;
}

export async function getFundSummary(client: PublicClient, opts: GetFundSummaryOptions = {}): Promise<FundSummary> {
  const poolAddress = opts.poolAddress ?? DEPLOYED.ReliefPool;
  const fromBlock = opts.fromBlock ?? BigInt(DEPLOYED.ReliefPoolDeployBlock);
  const limit = opts.limit ?? 100;

  const [availableWei, reservedWei, events] = await Promise.all([
    client.readContract({ address: JPYC, abi: JpycAbi, functionName: 'balanceOf', args: [poolAddress] })
      .then((v) => v.toString()).catch(() => null),
    client.readContract({ address: poolAddress, abi: ReliefPoolAbi, functionName: 'reserved' })
      .then((v) => v.toString()).catch(() => null),
    readReliefPoolEvents(client, poolAddress, fromBlock, ['Donated', 'Paid', 'Held', 'Claimed', 'Swept']).catch(() => []),
  ]);

  const sorted = [...events].sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);

  return {
    poolAddress,
    fromBlock: fromBlock.toString(),
    availableWei,
    reservedWei,
    totals: computeFundTotals(events),
    events: sorted.slice(0, limit),
    fetchedAt: new Date().toISOString(),
  };
}

export interface PlotStatus {
  plotLabel: string;
  seasonLabel: string;
  enrolled: boolean;
  zoneId: Hex | null;
  speciesId: Hex | null;
  payoutTarget: { farmer: Address; plotRegistry: Address; slotExpiry: string } | null;
  /** Best-effort settlement read from recent Attested/Held/Paid/Claimed/Swept logs mentioning this plot --
   *  not a direct `plotSettlements(eventId, plotLabel)` read, since that mapping is keyed by an `eventId`
   *  this endpoint isn't given. `latestEvent` is the most recent matching log, if any. */
  latestEvent: ReliefPoolEvent | null;
}

export interface GetPlotStatusOptions {
  poolAddress?: Address;
  fromBlock?: bigint;
}

export async function getPlotStatus(
  client: PublicClient,
  plotLabel: string,
  seasonLabel: string,
  opts: GetPlotStatusOptions = {},
): Promise<PlotStatus> {
  const poolAddress = opts.poolAddress ?? DEPLOYED.ReliefPool;
  const fromBlock = opts.fromBlock ?? BigInt(DEPLOYED.ReliefPoolDeployBlock);

  const [plot, target, events] = await Promise.all([
    client.readContract({ address: poolAddress, abi: ReliefPoolAbi, functionName: 'plots', args: [plotLabel] })
      .catch(() => null),
    client.readContract({
      address: poolAddress, abi: ReliefPoolAbi, functionName: 'payoutTarget', args: [plotLabel, seasonLabel],
    }).catch(() => null),
    readReliefPoolEvents(client, poolAddress, fromBlock, ['Attested', 'Held', 'Paid', 'Claimed', 'Swept']).catch(() => []),
  ]);

  const [zoneId, speciesId, enrolled] = (plot as [Hex, Hex, boolean] | null) ?? [null, null, false];
  const [farmer, plotRegistry, slotExpiry] = (target as [Address, Address, bigint] | null) ?? [null, null, null];

  const matching = events
    .filter((event) => event.plotLabel === plotLabel)
    .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);

  return {
    plotLabel,
    seasonLabel,
    enrolled,
    zoneId: zoneId && zoneId !== `0x${'0'.repeat(64)}` ? zoneId : null,
    speciesId: speciesId && speciesId !== `0x${'0'.repeat(64)}` ? speciesId : null,
    payoutTarget: farmer ? { farmer, plotRegistry: plotRegistry as Address, slotExpiry: (slotExpiry as bigint).toString() } : null,
    latestEvent: matching[0] ?? null,
  };
}

export interface GetHumanLevelOptions {
  registryAddress?: Address;
}

/** ReliefPool/HumanRegistry identity level for `wallet`: 0 when unbound or the read fails. */
export async function getHumanLevel(client: PublicClient, wallet: Address, opts: GetHumanLevelOptions = {}): Promise<number> {
  const registryAddress = opts.registryAddress ?? DEPLOYED.HumanRegistry;
  try {
    return await client.readContract({ address: registryAddress, abi: HumanRegistryAbi, functionName: 'levelOf', args: [wallet] });
  } catch {
    return 0;
  }
}
