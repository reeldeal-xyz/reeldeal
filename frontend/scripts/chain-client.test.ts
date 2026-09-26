/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { PublicClient } from 'viem';
import {
  computeFundTotals, getFundSummary, getHumanLevel, getPlotStatus, isMarketplaceSaleMemo,
  type ReliefPoolEvent,
} from '../src/lib/chain/client.server';

const POOL = '0xB25888A81B6F2D337c2f0CBFB863324F258c43e5' as const;
const REGISTRY = '0xc713c174b33B071f7Bf6dC571E3dd7BfB441D4F8' as const;
const WALLET = '0x1111111111111111111111111111111111111111'.slice(0, 42) as `0x${string}`;

type Log = { eventName: string; args: Record<string, unknown>; blockNumber: bigint; transactionHash: `0x${string}`; logIndex: number };

/** Minimal mock: only the two viem methods client.server.ts actually calls. */
function mockClient(overrides: {
  readContract?: (args: { functionName: string; args?: unknown[] }) => unknown;
  logs?: Log[];
} = {}): PublicClient {
  return {
    readContract: (async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      if (overrides.readContract) return overrides.readContract({ functionName, args });
      throw new Error(`unexpected readContract(${functionName})`);
    }) as PublicClient['readContract'],
    getLogs: (async () => overrides.logs ?? []) as PublicClient['getLogs'],
  } as unknown as PublicClient;
}

describe('isMarketplaceSaleMemo', () => {
  test('matches a sale: memo case-insensitively, rejects everything else', () => {
    expect(isMarketplaceSaleMemo('sale:0xabc')).toBe(true);
    expect(isMarketplaceSaleMemo('SALE:0xabc')).toBe(true);
    expect(isMarketplaceSaleMemo('donor gift')).toBe(false);
    expect(isMarketplaceSaleMemo(undefined)).toBe(false);
  });
});

describe('computeFundTotals', () => {
  test('sums Donated/Paid and nets Held against Claimed+Swept, clamped at zero', () => {
    const events: ReliefPoolEvent[] = [
      { type: 'Donated', amountWei: '1000', blockNumber: 1, txHash: '0x1', logIndex: 0 },
      { type: 'Donated', amountWei: '2000', blockNumber: 2, txHash: '0x2', logIndex: 0 },
      { type: 'Paid', amountWei: '500', blockNumber: 3, txHash: '0x3', logIndex: 0 },
      { type: 'Held', blockNumber: 4, txHash: '0x4', logIndex: 0 },
      { type: 'Held', blockNumber: 5, txHash: '0x5', logIndex: 0 },
      { type: 'Claimed', amountWei: '300', blockNumber: 6, txHash: '0x6', logIndex: 0 },
    ];
    expect(computeFundTotals(events)).toEqual({ donatedWei: '3000', paidWei: '500', heldCount: 1 });
  });

  test('never returns a negative heldCount when resolutions outnumber holds', () => {
    const events: ReliefPoolEvent[] = [
      { type: 'Held', blockNumber: 1, txHash: '0x1', logIndex: 0 },
      { type: 'Claimed', blockNumber: 2, txHash: '0x2', logIndex: 0 },
      { type: 'Swept', blockNumber: 3, txHash: '0x3', logIndex: 0 },
    ];
    expect(computeFundTotals(events).heldCount).toBe(0);
  });
});

describe('getFundSummary', () => {
  test('reads balance/reserved, sums totals, marks marketplace-memo donations, and sorts newest first', async () => {
    const client = mockClient({
      readContract: ({ functionName }) => {
        if (functionName === 'balanceOf') return 500_000n;
        if (functionName === 'reserved') return 12_000n;
        throw new Error(`unexpected ${functionName}`);
      },
      logs: [
        { eventName: 'Donated', args: { from: WALLET, amount: 100_000n, memo: 'seed' }, blockNumber: 100n, transactionHash: '0xa', logIndex: 0 },
        { eventName: 'Donated', args: { from: WALLET, amount: 5_000n, memo: 'sale:0xdead' }, blockNumber: 200n, transactionHash: '0xb', logIndex: 1 },
        { eventName: 'Paid', args: { plotLabel: 'p1213-001', amount: 10_000n, farmer: WALLET }, blockNumber: 150n, transactionHash: '0xc', logIndex: 0 },
      ],
    });
    const summary = await getFundSummary(client, { poolAddress: POOL, fromBlock: 0n });
    expect(summary.availableWei).toBe('500000');
    expect(summary.reservedWei).toBe('12000');
    expect(summary.totals).toEqual({ donatedWei: '105000', paidWei: '10000', heldCount: 0 });
    expect(summary.events.map((e) => e.blockNumber)).toEqual([200, 150, 100]);
    expect(summary.events[0]?.isMarketplaceSale).toBe(true);
    expect(summary.events[2]?.isMarketplaceSale).toBe(false);
  });

  test('degrades to null balance/reserved instead of throwing when reads fail', async () => {
    const client = mockClient({ readContract: () => { throw new Error('rpc down'); }, logs: [] });
    const summary = await getFundSummary(client, { poolAddress: POOL, fromBlock: 0n });
    expect(summary.availableWei).toBeNull();
    expect(summary.reservedWei).toBeNull();
    expect(summary.events).toEqual([]);
  });
});

describe('getPlotStatus', () => {
  test('combines plots()/payoutTarget() with the latest matching event for that plot', async () => {
    const client = mockClient({
      readContract: ({ functionName }) => {
        if (functionName === 'plots') return [`0x${'1'.repeat(64)}`, `0x${'2'.repeat(64)}`, true];
        if (functionName === 'payoutTarget') return [WALLET, POOL, 1_800_000_000n];
        throw new Error(`unexpected ${functionName}`);
      },
      logs: [
        { eventName: 'Held', args: { plotLabel: 'p1213-001', reason: `0x${'3'.repeat(64)}` }, blockNumber: 10n, transactionHash: '0xa', logIndex: 0 },
        { eventName: 'Paid', args: { plotLabel: 'p1213-001', amount: 10_000n, farmer: WALLET }, blockNumber: 20n, transactionHash: '0xb', logIndex: 0 },
        { eventName: 'Paid', args: { plotLabel: 'other-plot', amount: 1n, farmer: WALLET }, blockNumber: 30n, transactionHash: '0xc', logIndex: 0 },
      ],
    });
    const status = await getPlotStatus(client, 'p1213-001', '2025', { poolAddress: POOL, fromBlock: 0n });
    expect(status.enrolled).toBe(true);
    expect(status.payoutTarget).toEqual({ farmer: WALLET, plotRegistry: POOL, slotExpiry: '1800000000' });
    expect(status.latestEvent?.type).toBe('Paid');
    expect(status.latestEvent?.blockNumber).toBe(20);
  });

  test('degrades to nulls/false instead of throwing when a plot is unknown', async () => {
    const client = mockClient({ readContract: () => { throw new Error('reverted'); }, logs: [] });
    const status = await getPlotStatus(client, 'unknown-plot', '2025', { poolAddress: POOL, fromBlock: 0n });
    expect(status.enrolled).toBe(false);
    expect(status.zoneId).toBeNull();
    expect(status.payoutTarget).toBeNull();
    expect(status.latestEvent).toBeNull();
  });
});

describe('getHumanLevel', () => {
  test('returns the on-chain level', async () => {
    const client = mockClient({ readContract: ({ functionName }) => (functionName === 'levelOf' ? 2 : 0) });
    expect(await getHumanLevel(client, WALLET, { registryAddress: REGISTRY })).toBe(2);
  });

  test('degrades to 0 instead of throwing when the read fails', async () => {
    const client = mockClient({ readContract: () => { throw new Error('rpc down'); } });
    expect(await getHumanLevel(client, WALLET, { registryAddress: REGISTRY })).toBe(0);
  });
});
