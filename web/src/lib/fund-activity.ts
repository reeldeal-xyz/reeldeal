// "Fund activity" panel data (sponsor-polish task, Curvegrid MultiBaas track): the donor-ledger dashboard's
// server-side data source. Reads ReliefPool's indexed Donated/Attested/Paid/Held/Claimed/Swept events from
// MultiBaas (docs.curvegrid.com/multibaas/event-indexing/ -- "Event Query"; confirmed shape against the live
// deployment 2026-09-26: GET /api/v0/events -> {status, message, result: Event[]}, contractLabel filter
// matches the `reliefpool` alias linked by scripts/multibaas-setup.ts) with a graceful fallback to direct
// viem `getLogs` reads (same event set the donor screen's useReliefPoolLedger hook already reads
// client-side) whenever MultiBaas is unconfigured or unreachable. The pool's available JPYC balance is
// always read directly on-chain (independent of which event source served the list) since MultiBaas has no
// query for it here.
import { createPublicClient, http, getAbiItem, type AbiEvent, type Address } from 'viem';
import { sepolia } from 'viem/chains';
import { ReliefPoolAbi, JPYC } from '@repo/shared';
import { Erc20Abi } from './erc20-abi';
import { env } from './env';
import { fetchMultiBaasEvents, type DonorLedgerEvent } from './multibaas';

export const FUND_EVENT_NAMES = ['Donated', 'Attested', 'Paid', 'Held', 'Claimed', 'Swept'] as const;
export type FundEventName = (typeof FUND_EVENT_NAMES)[number];

export interface FundActivityEvent {
  type: FundEventName;
  /** ISO timestamp when known (MultiBaas source only -- the viem fallback doesn't fetch block times). */
  triggeredAt: string | null;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  plotLabel?: string;
  amountWei?: string;
  memo?: string;
  /** True when a Donated memo matches `sale:<orderId>` (SaleRouter marketplace donations). */
  isMarketplaceSale?: boolean;
  farmer?: string;
  reason?: string;
}

export interface FundActivityTotals {
  donatedWei: string;
  paidWei: string;
  /** Held events not yet resolved by a later Claimed/Swept for the same eventId+plot, clamped to >= 0 --
   *  an approximation from the event list alone (no per-plot on-chain status read), not a wei amount. */
  heldCount: number;
  /** Pool's live JPYC balance; null when the pool address or an RPC URL isn't configured. */
  availableWei: string | null;
}

export interface FundActivityResult {
  /** Whether MULTIBAAS_URL/MULTIBAAS_API_KEY are set at all (independent of whether this response used it). */
  configured: boolean;
  /** Which source actually produced `events`/`totals` for this response. */
  source: 'multibaas' | 'viem' | 'unavailable';
  events: FundActivityEvent[];
  totals: FundActivityTotals | null;
  error?: string;
}

const MARKETPLACE_SALE_MEMO = /^sale:/i;

export const isMarketplaceSaleMemo = (memo: string | undefined): boolean => Boolean(memo && MARKETPLACE_SALE_MEMO.test(memo));

function fromDonorLedgerEvents(events: DonorLedgerEvent[]): FundActivityEvent[] {
  return events
    .filter((e): e is DonorLedgerEvent & { name: FundEventName } => (FUND_EVENT_NAMES as readonly string[]).includes(e.name))
    .map((e) => {
      const byName = (name: string) => e.inputs.find((i) => i.name === name)?.value;
      const memo = e.name === 'Donated' ? byName('memo') : undefined;
      return {
        type: e.name,
        triggeredAt: e.triggeredAt,
        blockNumber: e.blockNumber,
        txHash: e.txHash,
        // fetchMultiBaasEvents' mapped shape doesn't carry the raw event's indexInLog -- fine here, this
        // dashboard read is display-only. Push de-dup (web/src/lib/notification-log.ts) keys off the
        // webhook payload / viem log's real logIndex instead, never off this endpoint.
        logIndex: 0,
        plotLabel: byName('plotLabel'),
        amountWei: byName('amount'),
        memo,
        isMarketplaceSale: isMarketplaceSaleMemo(memo),
        farmer: byName('farmer') ?? byName('from'),
        reason: e.name === 'Held' ? byName('reason') : undefined,
      };
    });
}

async function fetchViaViem(poolAddress: Address, fromBlock: bigint, rpcUrl: string): Promise<FundActivityEvent[]> {
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const events = FUND_EVENT_NAMES.map((name) => {
    try {
      return getAbiItem({ abi: ReliefPoolAbi, name }) as AbiEvent | undefined;
    } catch {
      return undefined;
    }
  }).filter((e): e is AbiEvent => Boolean(e));

  const logs = await client.getLogs({ address: poolAddress, events, fromBlock, toBlock: 'latest' });
  return logs.map((log) => {
    const args = (log.args ?? {}) as Record<string, unknown>;
    const memo = log.eventName === 'Donated' ? (args.memo as string | undefined) : undefined;
    const amount = args.amount as bigint | undefined;
    return {
      type: log.eventName as FundEventName,
      triggeredAt: null,
      blockNumber: Number(log.blockNumber ?? 0n),
      txHash: log.transactionHash ?? '0x',
      logIndex: log.logIndex ?? 0,
      plotLabel: args.plotLabel as string | undefined,
      amountWei: amount !== undefined ? amount.toString() : undefined,
      memo,
      isMarketplaceSale: isMarketplaceSaleMemo(memo),
      farmer: (args.farmer as string | undefined) ?? (args.from as string | undefined),
      reason: log.eventName === 'Held' ? (args.reason as string | undefined) : undefined,
    };
  });
}

export function computeTotals(events: FundActivityEvent[], availableWei: string | null = null): FundActivityTotals {
  let donated = 0n;
  let paid = 0n;
  let held = 0;
  let resolved = 0;
  for (const e of events) {
    if (e.type === 'Donated' && e.amountWei) donated += BigInt(e.amountWei);
    if ((e.type === 'Paid' || e.type === 'Claimed') && e.amountWei) paid += BigInt(e.amountWei);
    if (e.type === 'Held') held++;
    if (e.type === 'Claimed' || e.type === 'Swept') resolved++;
  }
  return {
    donatedWei: donated.toString(),
    paidWei: paid.toString(),
    heldCount: Math.max(0, held - resolved),
    availableWei,
  };
}

async function readPoolBalance(poolAddress: Address | undefined, rpcUrl: string | undefined): Promise<string | null> {
  if (!poolAddress || !rpcUrl) return null;
  try {
    const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const balance = await client.readContract({ address: JPYC, abi: Erc20Abi, functionName: 'balanceOf', args: [poolAddress] });
    return balance.toString();
  } catch (err) {
    console.warn('[fund-activity] failed to read pool JPYC balance', err);
    return null;
  }
}

export interface GetFundActivityOptions {
  poolAddress?: Address;
  fromBlock?: bigint;
  limit?: number;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
}

/** Server-side data source for the /donate "Fund activity" panel (sponsor-polish task). */
export async function getFundActivity(opts: GetFundActivityOptions = {}): Promise<FundActivityResult> {
  const poolAddress = opts.poolAddress ?? (env.reliefPoolAddress() as Address | undefined);
  const fromBlock = opts.fromBlock ?? env.reliefPoolDeployBlock();
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const limit = opts.limit ?? 100;

  const availableWei = await readPoolBalance(poolAddress, rpcUrl);

  const baseUrl = env.multibaasUrl();
  const apiKey = env.multibaasApiKey();
  const configured = Boolean(baseUrl && apiKey);

  if (configured) {
    try {
      const raw = await fetchMultiBaasEvents({ baseUrl: baseUrl!, apiKey: apiKey!, contractLabel: 'reliefpool', limit, fetchFn: opts.fetchFn });
      const events = fromDonorLedgerEvents(raw);
      return { configured: true, source: 'multibaas', events, totals: computeTotals(events, availableWei) };
    } catch (err) {
      console.warn('[fund-activity] MultiBaas query failed, falling back to direct viem log reads', err);
      if (!poolAddress || !rpcUrl) {
        return {
          configured: true,
          source: 'unavailable',
          events: [],
          totals: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      const events = await fetchViaViem(poolAddress, fromBlock, rpcUrl);
      return {
        configured: true,
        source: 'viem',
        events,
        totals: computeTotals(events, availableWei),
        error: 'MultiBaas unreachable — showing direct on-chain log reads instead.',
      };
    }
  }

  if (!poolAddress || !rpcUrl) {
    return { configured: false, source: 'unavailable', events: [], totals: null };
  }
  const events = await fetchViaViem(poolAddress, fromBlock, rpcUrl);
  return { configured: false, source: 'viem', events, totals: computeTotals(events, availableWei) };
}
