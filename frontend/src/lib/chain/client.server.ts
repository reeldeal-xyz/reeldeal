// Server-side Sepolia reads for ReliefPool/SaleRouter/HumanRegistry (frontend<->contracts wiring).
// Pure, typed functions over an injected PublicClient so tests can supply a mock -- no module-level
// singleton client and no network access at import time. astro:env/server's SEPOLIA_RPC_URL is read
// only by callers that construct a client with createSepoliaClient().
import {
  createPublicClient, getAbiItem, hexToString, http, zeroAddress,
  type AbiEvent, type Address, type Hex, type PublicClient,
} from 'viem';
import { sepolia } from 'viem/chains';
import { DEPLOYED, JPYC, JpycAbi, ReliefPoolAbi, HumanRegistryAbi } from '@repo/shared';

export function createSepoliaClient(rpcUrl: string): PublicClient {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
}

const RELIEF_POOL_EVENT_NAMES = ['Donated', 'Attested', 'Paid', 'Held', 'Claimed', 'Swept'] as const;
export type ReliefPoolEventName = (typeof RELIEF_POOL_EVENT_NAMES)[number];

export interface ReliefTriggerSnapshot {
  zoneId: Hex;
  speciesId: Hex;
  perilId: Hex;
  tier: number;
  seasonLabel: string;
  windowStart: string;
  windowEnd: string;
  firedAt: string;
  index: number;
  threshold: number;
  tempC: number;
  dataHash: Hex;
  deadline: string;
}

export interface ReliefPoolEvent {
  type: ReliefPoolEventName;
  blockNumber: number;
  txHash: Hex;
  logIndex: number;
  eventId?: Hex;
  plotLabel?: string;
  amountWei?: string;
  memo?: string;
  trigger?: ReliefTriggerSnapshot;
  eligibleUnits?: number;
  perUnitWei?: string;
  signers?: Address[];
  /** True when a Donated memo matches sale:<orderId> -- a SaleRouter marketplace checkout. */
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

function triggerSnapshot(value: unknown): ReliefTriggerSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const t = value as Record<string, unknown>;
  if (typeof t.seasonLabel !== 'string' || typeof t.zoneId !== 'string' || typeof t.speciesId !== 'string'
    || typeof t.perilId !== 'string' || typeof t.dataHash !== 'string') return undefined;
  return {
    zoneId: t.zoneId as Hex,
    speciesId: t.speciesId as Hex,
    perilId: t.perilId as Hex,
    tier: Number(t.tier),
    seasonLabel: t.seasonLabel,
    windowStart: String(t.windowStart),
    windowEnd: String(t.windowEnd),
    firedAt: String(t.firedAt),
    index: Number(t.index),
    threshold: Number(t.threshold),
    tempC: Number(t.tempC),
    dataHash: t.dataHash as Hex,
    deadline: String(t.deadline),
  };
}

/** Reads and maps ReliefPool logs. Callers decide how to handle an RPC/indexing failure. */
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
    const memo = type === 'Donated' ? args.memo as string | undefined : undefined;
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
      trigger: type === 'Attested' ? triggerSnapshot(args.t) : undefined,
      eligibleUnits: type === 'Attested' && args.eligibleUnits !== undefined ? Number(args.eligibleUnits) : undefined,
      perUnitWei: type === 'Attested' && args.perUnit !== undefined ? String(args.perUnit) : undefined,
      signers: type === 'Attested' && Array.isArray(args.signers) ? args.signers as Address[] : undefined,
      isMarketplaceSale: type === 'Donated' ? isMarketplaceSaleMemo(memo) : undefined,
      farmer: (args.farmer as Address | undefined) ?? (args.from as Address | undefined),
      reason: type === 'Held' ? args.reason as Hex | undefined : undefined,
    };
  });
}

export interface FundTotals {
  donatedWei: string;
  paidWei: string;
  heldCount: number;
}

export interface FundSummary {
  poolAddress: Address;
  fromBlock: string;
  /** Live JPYC token balance held by ReliefPool, before reservations are subtracted. */
  balanceWei: string | null;
  /** Spendable balance = max(balance - reserved, 0). */
  availableWei: string | null;
  /** ReliefPool.reserved(): JPYC committed to pending/held allocations. */
  reservedWei: string | null;
  totals: FundTotals;
  events: ReliefPoolEvent[];
  eventsAvailable: boolean;
  fetchedAt: string;
}

export function computeFundTotals(events: ReliefPoolEvent[]): FundTotals {
  let donated = 0n;
  let paid = 0n;
  let held = 0;
  let resolved = 0;
  for (const event of events) {
    if (event.type === 'Donated' && event.amountWei) donated += BigInt(event.amountWei);
    if ((event.type === 'Paid' || event.type === 'Claimed') && event.amountWei) paid += BigInt(event.amountWei);
    if (event.type === 'Held') held++;
    if (event.type === 'Claimed' || event.type === 'Swept') resolved++;
  }
  return { donatedWei: donated.toString(), paidWei: paid.toString(), heldCount: Math.max(0, held - resolved) };
}

export interface GetFundSummaryOptions {
  poolAddress?: Address;
  fromBlock?: bigint;
  limit?: number;
}

export async function getFundSummary(client: PublicClient, opts: GetFundSummaryOptions = {}): Promise<FundSummary> {
  const poolAddress = opts.poolAddress ?? DEPLOYED.ReliefPool;
  const fromBlock = opts.fromBlock ?? BigInt(DEPLOYED.ReliefPoolDeployBlock);
  const limit = opts.limit ?? 100;

  const [balanceWei, reservedWei, eventResult] = await Promise.all([
    client.readContract({ address: JPYC, abi: JpycAbi, functionName: 'balanceOf', args: [poolAddress] })
      .then((v) => v.toString()).catch(() => null),
    client.readContract({ address: poolAddress, abi: ReliefPoolAbi, functionName: 'reserved' })
      .then((v) => v.toString()).catch(() => null),
    readReliefPoolEvents(client, poolAddress, fromBlock)
      .then((events) => ({ available: true as const, events }))
      .catch(() => ({ available: false as const, events: [] as ReliefPoolEvent[] })),
  ]);

  const availableWei = balanceWei !== null && reservedWei !== null
    ? (BigInt(balanceWei) > BigInt(reservedWei) ? BigInt(balanceWei) - BigInt(reservedWei) : 0n).toString()
    : null;
  const sorted = [...eventResult.events].sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);

  return {
    poolAddress,
    fromBlock: fromBlock.toString(),
    balanceWei,
    availableWei,
    reservedWei,
    totals: computeFundTotals(eventResult.events),
    events: sorted.slice(0, limit),
    eventsAvailable: eventResult.available,
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
  latestEvent: ReliefPoolEvent | null;
}

export interface GetPlotStatusOptions {
  poolAddress?: Address;
  fromBlock?: bigint;
  events?: ReliefPoolEvent[];
  eventsAvailable?: boolean;
  /** Known attested event ID for a direct settlement read when log indexing is unavailable. */
  eventIdHint?: Hex;
}

async function plotBase(
  client: PublicClient,
  poolAddress: Address,
  plotLabel: string,
  seasonLabel: string,
) {
  const [plot, target] = await Promise.all([
    client.readContract({ address: poolAddress, abi: ReliefPoolAbi, functionName: 'plots', args: [plotLabel] })
      .catch(() => null),
    client.readContract({ address: poolAddress, abi: ReliefPoolAbi, functionName: 'payoutTarget', args: [plotLabel, seasonLabel] })
      .catch(() => null),
  ]);
  const [zoneId, speciesId, enrolled] = (plot as readonly [Hex, Hex, boolean] | null) ?? [null, null, false];
  const [farmer, plotRegistry, slotExpiry] = (target as readonly [Address, Address, bigint] | null)
    ?? [zeroAddress, zeroAddress, 0n];
  return {
    zoneId: zoneId && zoneId !== `0x${'0'.repeat(64)}` ? zoneId : null,
    speciesId: speciesId && speciesId !== `0x${'0'.repeat(64)}` ? speciesId : null,
    enrolled,
    payoutTarget: farmer !== zeroAddress ? { farmer, plotRegistry, slotExpiry: slotExpiry.toString() } : null,
  };
}

async function eventSource(client: PublicClient, poolAddress: Address, fromBlock: bigint, opts: GetPlotStatusOptions) {
  if (opts.events) return { available: opts.eventsAvailable ?? true, events: opts.events };
  return readReliefPoolEvents(client, poolAddress, fromBlock)
    .then((events) => ({ available: true, events }))
    .catch(() => ({ available: false, events: [] as ReliefPoolEvent[] }));
}

export async function getPlotStatus(
  client: PublicClient,
  plotLabel: string,
  seasonLabel: string,
  opts: GetPlotStatusOptions = {},
): Promise<PlotStatus> {
  const poolAddress = opts.poolAddress ?? DEPLOYED.ReliefPool;
  const fromBlock = opts.fromBlock ?? BigInt(DEPLOYED.ReliefPoolDeployBlock);
  const [base, source] = await Promise.all([
    plotBase(client, poolAddress, plotLabel, seasonLabel),
    eventSource(client, poolAddress, fromBlock, opts),
  ]);
  const matching = source.events
    .filter((event) => event.plotLabel === plotLabel)
    .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  return { plotLabel, seasonLabel, ...base, latestEvent: matching[0] ?? null };
}

export interface GetHumanLevelOptions {
  registryAddress?: Address;
}

/** Legacy convenience read. Use getPlotReliefStory when unavailable must remain distinct from level 0. */
export async function getHumanLevel(client: PublicClient, wallet: Address, opts: GetHumanLevelOptions = {}): Promise<number> {
  const registryAddress = opts.registryAddress ?? DEPLOYED.HumanRegistry;
  try {
    return Number(await client.readContract({
      address: registryAddress, abi: HumanRegistryAbi, functionName: 'levelOf', args: [wallet],
    }));
  } catch {
    return 0;
  }
}

export type PlotSettlementState = 'unsettled' | 'paid' | 'held' | 'claimed' | 'swept';

export interface PlotReliefStory extends PlotStatus {
  eventsAvailable: boolean;
  identity: { status: 'available'; level: number } | { status: 'unavailable'; level: null } | null;
  settlement: null | {
    eventId: Hex;
    state: PlotSettlementState;
    holdReason: string | null;
    amountWei: string;
    eligibleUnits: number;
    reservedAmountWei: string;
    attestedAt: string;
    claimDeadline: string;
    trigger: ReliefTriggerSnapshot | null;
    txHash: Hex | null;
    blockNumber: number | null;
    signers: Address[];
  };
}

const settlementStates: PlotSettlementState[] = ['unsettled', 'paid', 'held', 'claimed', 'swept'];

function decodeReason(value: Hex | undefined): string | null {
  if (!value || value === `0x${'0'.repeat(64)}`) return null;
  try { return hexToString(value).replace(/\u0000+$/g, ''); } catch { return null; }
}

/** Exact one-plot story from ReliefPool + HumanRegistry. No fixture-derived eligibility. */
export async function getPlotReliefStory(
  client: PublicClient,
  plotLabel: string,
  seasonLabel: string,
  opts: GetPlotStatusOptions = {},
): Promise<PlotReliefStory> {
  const poolAddress = opts.poolAddress ?? DEPLOYED.ReliefPool;
  const fromBlock = opts.fromBlock ?? BigInt(DEPLOYED.ReliefPoolDeployBlock);
  const [base, source] = await Promise.all([
    plotBase(client, poolAddress, plotLabel, seasonLabel),
    eventSource(client, poolAddress, fromBlock, opts),
  ]);

  const plotEvents = source.events
    .filter((event) => event.plotLabel === plotLabel && ['Paid', 'Held', 'Claimed', 'Swept'].includes(event.type))
    .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  const latestEvent = plotEvents[0] ?? null;

  const identity = base.payoutTarget
    ? await client.readContract({
        address: DEPLOYED.HumanRegistry,
        abi: HumanRegistryAbi,
        functionName: 'levelOf',
        args: [base.payoutTarget.farmer],
      }).then((level) => ({ status: 'available' as const, level: Number(level) }))
        .catch(() => ({ status: 'unavailable' as const, level: null }))
    : null;

  let settlement: PlotReliefStory['settlement'] = null;
  const eventId = latestEvent?.eventId ?? opts.eventIdHint;
  if (eventId) {
    const [settlementRaw, attestationRaw] = await Promise.all([
      client.readContract({
        address: poolAddress,
        abi: ReliefPoolAbi,
        functionName: 'plotSettlements',
        args: [eventId, plotLabel],
      }).catch(() => null),
      client.readContract({
        address: poolAddress,
        abi: ReliefPoolAbi,
        functionName: 'attestations',
        args: [eventId],
      }).catch(() => null),
    ]);
    if (settlementRaw && attestationRaw) {
      const [statusCode, holdReason] = settlementRaw as readonly [number, Hex];
      const [, , attestationSeason, eligibleUnits, perUnit, reservedAmount, attestedAt, claimDeadline] =
        attestationRaw as readonly [Hex, Hex, string, number, bigint, bigint, bigint, bigint];
      if (attestationSeason === seasonLabel) {
        const attested = source.events.find((event) => event.type === 'Attested' && event.eventId === eventId);
        settlement = {
          eventId,
          state: settlementStates[Number(statusCode)] ?? 'unsettled',
          holdReason: decodeReason(holdReason),
          amountWei: latestEvent?.amountWei ?? perUnit.toString(),
          eligibleUnits: Number(eligibleUnits),
          reservedAmountWei: reservedAmount.toString(),
          attestedAt: attestedAt.toString(),
          claimDeadline: claimDeadline.toString(),
          trigger: attested?.trigger ?? null,
          txHash: latestEvent && latestEvent.txHash !== '0x' ? latestEvent.txHash : null,
          blockNumber: latestEvent?.blockNumber || null,
          signers: attested?.signers ?? [],
        };
      }
    }
  }

  return {
    plotLabel,
    seasonLabel,
    ...base,
    latestEvent,
    eventsAvailable: source.available,
    identity,
    settlement,
  };
}
