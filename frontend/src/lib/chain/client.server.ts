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
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 8000, retryCount: 1 }) });
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
  blockNumber?: bigint,
): Promise<ReliefPoolEvent[]> {
  const events = reliefPoolEvents(names);
  if (!events.length) return [];
  const toBlock = blockNumber ?? await client.getBlockNumber({ cacheTime: 0 });
  const batchSize = 25_000n;
  if (fromBlock < 0n || (toBlock - fromBlock) / batchSize >= 80n) throw new Error('Event range requires an indexer');
  const fetchLogs = (start: bigint, end: bigint) => client.getLogs({ address: poolAddress, events, fromBlock: start, toBlock: end });
  const logs: Awaited<ReturnType<typeof fetchLogs>> = [];
  for (let start = fromBlock; start <= toBlock; start += batchSize) {
    const end = start + batchSize - 1n;
    logs.push(...await fetchLogs(start, end < toBlock ? end : toBlock));
  }
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
  totals: FundTotals | null;
  atBlock: string;
  eventsComplete: boolean;
  events: ReliefPoolEvent[];
  eventsAvailable: boolean;
  fetchedAt: string;
}

export function computeFundTotals(events: ReliefPoolEvent[]): FundTotals {
  let donated = 0n;
  let paid = 0n;
  const held = new Set<string>();
  for (const event of [...events].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)) {
    if (event.type === 'Donated' && event.amountWei) donated += BigInt(event.amountWei);
    if ((event.type === 'Paid' || event.type === 'Claimed') && event.amountWei) paid += BigInt(event.amountWei);
    if (!event.eventId || !event.plotLabel) continue;
    const key = `${event.eventId}:${event.plotLabel}`;
    if (event.type === 'Held') held.add(key);
    if (event.type === 'Paid' || event.type === 'Claimed' || event.type === 'Swept') held.delete(key);
  }
  return { donatedWei: donated.toString(), paidWei: paid.toString(), heldCount: held.size };
}

export interface GetFundSummaryOptions {
  poolAddress?: Address;
  fromBlock?: bigint;
  limit?: number;
  blockNumber?: bigint;
}

export async function getFundSummary(client: PublicClient, opts: GetFundSummaryOptions = {}): Promise<FundSummary> {
  const poolAddress = opts.poolAddress ?? DEPLOYED.ReliefPool;
  const fromBlock = opts.fromBlock ?? BigInt(DEPLOYED.ReliefPoolDeployBlock);
  const limit = Math.max(0, Math.min(opts.limit ?? 100, 1000));
  const blockNumber = opts.blockNumber ?? await client.getBlockNumber({ cacheTime: 0 });

  const [balanceWei, reservedWei, eventResult] = await Promise.all([
    client.readContract({ address: JPYC, abi: JpycAbi, functionName: 'balanceOf', args: [poolAddress], blockNumber })
      .then((v) => v.toString()).catch(() => null),
    client.readContract({ address: poolAddress, abi: ReliefPoolAbi, functionName: 'reserved', blockNumber })
      .then((v) => v.toString()).catch(() => null),
    readReliefPoolEvents(client, poolAddress, fromBlock, RELIEF_POOL_EVENT_NAMES, blockNumber)
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
    totals: eventResult.available ? computeFundTotals(eventResult.events) : null,
    atBlock: blockNumber.toString(),
    eventsComplete: eventResult.available && sorted.length <= limit,
    events: sorted.slice(0, limit),
    eventsAvailable: eventResult.available,
    fetchedAt: new Date().toISOString(),
  };
}

export interface PlotStatus {
  plotLabel: string;
  seasonLabel: string;
  enrolled: boolean | null;
  plotReadAvailable: boolean;
  targetReadAvailable: boolean;
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
  eventsComplete?: boolean;
  blockNumber?: bigint;
  eventId?: Hex;
  /** Known attested event ID for a direct settlement read when log indexing is unavailable. */
  eventIdHint?: Hex;
}

async function plotBase(
  client: PublicClient,
  poolAddress: Address,
  plotLabel: string,
  seasonLabel: string,
  blockNumber: bigint,
) {
  const [plot, target] = await Promise.all([
    client.readContract({ address: poolAddress, abi: ReliefPoolAbi, functionName: 'plots', args: [plotLabel], blockNumber })
      .catch(() => null),
    client.readContract({ address: poolAddress, abi: ReliefPoolAbi, functionName: 'payoutTarget', args: [plotLabel, seasonLabel], blockNumber })
      .catch(() => null),
  ]);
  const [zoneId, speciesId, enrolled] = (plot as readonly [Hex, Hex, boolean] | null) ?? [null, null, false];
  const [farmer, plotRegistry, slotExpiry] = (target as readonly [Address, Address, bigint] | null)
    ?? [zeroAddress, zeroAddress, 0n];
  return {
    zoneId: zoneId && zoneId !== `0x${'0'.repeat(64)}` ? zoneId : null,
    speciesId: speciesId && speciesId !== `0x${'0'.repeat(64)}` ? speciesId : null,
    enrolled: plot ? enrolled : null,
    plotReadAvailable: plot !== null,
    targetReadAvailable: target !== null,
    payoutTarget: farmer !== zeroAddress ? { farmer, plotRegistry, slotExpiry: slotExpiry.toString() } : null,
  };
}

async function eventSource(client: PublicClient, poolAddress: Address, fromBlock: bigint, opts: GetPlotStatusOptions) {
  if (opts.events && opts.eventsComplete !== false) return { available: opts.eventsAvailable ?? true, events: opts.events };
  return readReliefPoolEvents(client, poolAddress, fromBlock, RELIEF_POOL_EVENT_NAMES, opts.blockNumber)
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
  const blockNumber = opts.blockNumber ?? await client.getBlockNumber({ cacheTime: 0 });
  const [base, source] = await Promise.all([
    plotBase(client, poolAddress, plotLabel, seasonLabel, blockNumber),
    eventSource(client, poolAddress, fromBlock, { ...opts, blockNumber }),
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
  atBlock: string;
  eventsAvailable: boolean;
  settlementReadStatus: 'available' | 'not-found' | 'unavailable';
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
    recipient: Address | null;
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
  const blockNumber = opts.blockNumber ?? await client.getBlockNumber({ cacheTime: 0 });
  const [base, source] = await Promise.all([
    plotBase(client, poolAddress, plotLabel, seasonLabel, blockNumber),
    eventSource(client, poolAddress, fromBlock, { ...opts, blockNumber }),
  ]);

  const plotEvents = source.events
    .filter((event) => event.plotLabel === plotLabel && ['Paid', 'Held', 'Claimed', 'Swept'].includes(event.type))
    .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  let latestEvent: ReliefPoolEvent | null = null;

  const identity = base.payoutTarget
    ? await client.readContract({
        address: DEPLOYED.HumanRegistry,
        abi: HumanRegistryAbi,
        functionName: 'levelOf',
        args: [base.payoutTarget.farmer], blockNumber,
      }).then((level) => ({ status: 'available' as const, level: Number(level) }))
        .catch(() => ({ status: 'unavailable' as const, level: null }))
    : null;

  let settlement: PlotReliefStory['settlement'] = null;
  let settlementReadStatus: PlotReliefStory['settlementReadStatus'] = source.available ? 'not-found' : 'unavailable';
  const candidates = opts.eventId ? [opts.eventId] : [...new Set([
    ...plotEvents.flatMap((event) => event.eventId ? [event.eventId] : []),
    ...(opts.eventIdHint ? [opts.eventIdHint] : []),
  ])];
  if (candidates.length > 32) settlementReadStatus = 'unavailable';
  for (const eventId of candidates.slice(0, 32)) {
    const [settlementRaw, attestationRaw] = await Promise.all([
      client.readContract({
        address: poolAddress, abi: ReliefPoolAbi, functionName: 'plotSettlements',
        args: [eventId, plotLabel], blockNumber,
      }).catch(() => null),
      client.readContract({
        address: poolAddress, abi: ReliefPoolAbi, functionName: 'attestations',
        args: [eventId], blockNumber,
      }).catch(() => null),
    ]);
    if (!settlementRaw || !attestationRaw) {
      settlementReadStatus = 'unavailable';
      break;
    }
    const [statusCode, holdReason] = settlementRaw as readonly [number, Hex];
    const [zone, species, attestationSeason, eligibleUnits, perUnit, reservedAmount, attestedAt, claimDeadline] =
      attestationRaw as readonly [Hex, Hex, string, number, bigint, bigint, bigint, bigint];
    if (attestationSeason !== seasonLabel || attestedAt === 0n) continue;
    const state = settlementStates[Number(statusCode)];
    if (!state) { settlementReadStatus = 'unavailable'; break; }
    if (state === 'unsettled' && (!base.enrolled || base.zoneId !== zone || base.speciesId !== species)) continue;
    latestEvent = plotEvents.find((event) => event.eventId === eventId) ?? null;
    const attested = source.events.find((event) => event.type === 'Attested' && event.eventId === eventId);
    settlement = {
      eventId, state, holdReason: decodeReason(holdReason),
      amountWei: latestEvent?.amountWei ?? perUnit.toString(),
      eligibleUnits: Number(eligibleUnits), reservedAmountWei: reservedAmount.toString(),
      attestedAt: attestedAt.toString(), claimDeadline: claimDeadline.toString(),
      trigger: attested?.trigger ?? null,
      txHash: latestEvent && latestEvent.txHash !== '0x' ? latestEvent.txHash : null,
      blockNumber: latestEvent?.blockNumber || null,
      signers: attested?.signers ?? [],
      recipient: (state === 'paid' || state === 'claimed') ? latestEvent?.farmer ?? null : null,
    };
    settlementReadStatus = 'available';
    break;
  }

  return {
    plotLabel,
    seasonLabel,
    ...base,
    latestEvent,
    eventsAvailable: source.available,
    settlementReadStatus,
    atBlock: blockNumber.toString(),
    identity,
    settlement,
  };
}
