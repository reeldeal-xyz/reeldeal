/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { stringToHex, type PublicClient } from 'viem';
import {
  computeFundTotals, getFundSummary, getHumanLevel, getPlotReliefStory, getPlotStatus, isMarketplaceSaleMemo,
  type ReliefPoolEvent,
} from '../src/lib/chain/client.server';

const POOL = '0xB25888A81B6F2D337c2f0CBFB863324F258c43e5' as const;
const REGISTRY = '0xc713c174b33B071f7Bf6dC571E3dd7BfB441D4F8' as const;
const WALLET = '0x1111111111111111111111111111111111111111' as const;

type Log = {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  logIndex: number;
};

function mockClient(overrides: {
  readContract?: (args: { functionName: string; args?: unknown[] }) => unknown;
  logs?: Log[];
  logsError?: Error;
} = {}): PublicClient {
  return {
    readContract: (async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      if (overrides.readContract) return overrides.readContract({ functionName, args });
      throw new Error(`unexpected readContract(${functionName})`);
    }) as PublicClient['readContract'],
    getLogs: (async () => {
      if (overrides.logsError) throw overrides.logsError;
      return overrides.logs ?? [];
    }) as PublicClient['getLogs'],
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
  test('sums Donated/Paid/Claimed and nets Held against Claimed+Swept', () => {
    const events: ReliefPoolEvent[] = [
      { type: 'Donated', amountWei: '1000', blockNumber: 1, txHash: '0x1', logIndex: 0 },
      { type: 'Donated', amountWei: '2000', blockNumber: 2, txHash: '0x2', logIndex: 0 },
      { type: 'Paid', amountWei: '500', blockNumber: 3, txHash: '0x3', logIndex: 0 },
      { type: 'Held', blockNumber: 4, txHash: '0x4', logIndex: 0 },
      { type: 'Held', blockNumber: 5, txHash: '0x5', logIndex: 0 },
      { type: 'Claimed', amountWei: '300', blockNumber: 6, txHash: '0x6', logIndex: 0 },
    ];
    expect(computeFundTotals(events)).toEqual({ donatedWei: '3000', paidWei: '800', heldCount: 1 });
  });

  test('never returns a negative heldCount', () => {
    const events: ReliefPoolEvent[] = [
      { type: 'Held', blockNumber: 1, txHash: '0x1', logIndex: 0 },
      { type: 'Claimed', blockNumber: 2, txHash: '0x2', logIndex: 0 },
      { type: 'Swept', blockNumber: 3, txHash: '0x3', logIndex: 0 },
    ];
    expect(computeFundTotals(events).heldCount).toBe(0);
  });
});

describe('getFundSummary', () => {
  test('separates raw balance, reserved and spendable balance', async () => {
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
    expect(summary.balanceWei).toBe('500000');
    expect(summary.availableWei).toBe('488000');
    expect(summary.reservedWei).toBe('12000');
    expect(summary.eventsAvailable).toBe(true);
    expect(summary.totals).toEqual({ donatedWei: '105000', paidWei: '10000', heldCount: 0 });
    expect(summary.events.map((e) => e.blockNumber)).toEqual([200, 150, 100]);
    expect(summary.events[0]?.isMarketplaceSale).toBe(true);
  });

  test('keeps event-index failure distinct from zero events', async () => {
    const client = mockClient({
      readContract: () => { throw new Error('rpc down'); },
      logsError: new Error('log query failed'),
    });
    const summary = await getFundSummary(client, { poolAddress: POOL, fromBlock: 0n });
    expect(summary.balanceWei).toBeNull();
    expect(summary.availableWei).toBeNull();
    expect(summary.reservedWei).toBeNull();
    expect(summary.events).toEqual([]);
    expect(summary.eventsAvailable).toBe(false);
  });
});

describe('getPlotStatus', () => {
  test('combines plots()/payoutTarget() with the latest matching event', async () => {
    const client = mockClient({
      readContract: ({ functionName }) => {
        if (functionName === 'plots') return [`0x${'1'.repeat(64)}`, `0x${'2'.repeat(64)}`, true];
        if (functionName === 'payoutTarget') return [WALLET, POOL, 1_800_000_000n];
        throw new Error(`unexpected ${functionName}`);
      },
      logs: [
        { eventName: 'Held', args: { plotLabel: 'p1213-001', reason: `0x${'3'.repeat(64)}` }, blockNumber: 10n, transactionHash: '0xa', logIndex: 0 },
        { eventName: 'Paid', args: { plotLabel: 'p1213-001', amount: 10_000n, farmer: WALLET }, blockNumber: 20n, transactionHash: '0xb', logIndex: 0 },
      ],
    });
    const status = await getPlotStatus(client, 'p1213-001', '2026', { poolAddress: POOL, fromBlock: 0n });
    expect(status.enrolled).toBe(true);
    expect(status.payoutTarget).toEqual({ farmer: WALLET, plotRegistry: POOL, slotExpiry: '1800000000' });
    expect(status.latestEvent?.type).toBe('Paid');
  });
});

describe('getHumanLevel', () => {
  test('returns the on-chain level', async () => {
    const client = mockClient({ readContract: ({ functionName }) => (functionName === 'levelOf' ? 2 : 0) });
    expect(await getHumanLevel(client, WALLET, { registryAddress: REGISTRY })).toBe(2);
  });

  test('legacy helper degrades to 0 when the read fails', async () => {
    const client = mockClient({ readContract: () => { throw new Error('rpc down'); } });
    expect(await getHumanLevel(client, WALLET, { registryAddress: REGISTRY })).toBe(0);
  });
});

describe('getPlotReliefStory', () => {
  const EVENT = `0x${'a'.repeat(64)}` as `0x${string}`;
  const ZONE = `0x${'1'.repeat(64)}` as `0x${string}`;
  const SPECIES = `0x${'2'.repeat(64)}` as `0x${string}`;
  const ZERO = `0x${'0'.repeat(64)}` as `0x${string}`;
  const DATA_HASH = `0x${'3'.repeat(64)}` as `0x${string}`;
  const trigger = {
    zoneId: ZONE, speciesId: SPECIES, perilId: `0x${'4'.repeat(64)}`, tier: 1,
    seasonLabel: '2026', windowStart: 1780358400n, windowEnd: 1780358400n,
    firedAt: 1780358400n, index: 4, threshold: 4, tempC: 0, dataHash: DATA_HASH, deadline: 1800000000n,
  };
  const attestation = [ZONE, SPECIES, '2026', 8, 10_000n, 70_000n, 1_780_358_500n, 1_800_000_000n] as const;

  test('reads exact Paid settlement, attestation and current HumanRegistry level', async () => {
    const client = mockClient({
      readContract: ({ functionName }) => {
        if (functionName === 'plots') return [ZONE, SPECIES, true];
        if (functionName === 'payoutTarget') return [WALLET, POOL, 1_806_537_599n];
        if (functionName === 'levelOf') return 2;
        if (functionName === 'plotSettlements') return [1, ZERO];
        if (functionName === 'attestations') return attestation;
        throw new Error(`unexpected ${functionName}`);
      },
      logs: [
        { eventName: 'Attested', args: { eventId: EVENT, t: trigger, eligibleUnits: 8, perUnit: 10_000n, signers: [WALLET] }, blockNumber: 10n, transactionHash: '0xaa', logIndex: 0 },
        { eventName: 'Paid', args: { eventId: EVENT, plotLabel: 'p1213-001', amount: 10_000n, farmer: WALLET }, blockNumber: 11n, transactionHash: '0xbb', logIndex: 0 },
      ],
    });
    const story = await getPlotReliefStory(client, 'p1213-001', '2026', { poolAddress: POOL, fromBlock: 0n });
    expect(story.identity).toEqual({ status: 'available', level: 2 });
    expect(story.settlement).toMatchObject({
      eventId: EVENT, state: 'paid', holdReason: null, amountWei: '10000',
      eligibleUnits: 8, reservedAmountWei: '70000', claimDeadline: '1800000000',
      txHash: '0xbb', blockNumber: 11,
    });
    expect(story.settlement?.trigger?.dataHash).toBe(DATA_HASH);
  });

  test('decodes Held(UNVERIFIED) and uses attested per-unit amount', async () => {
    const reason = stringToHex('UNVERIFIED', { size: 32 });
    const client = mockClient({
      readContract: ({ functionName }) => {
        if (functionName === 'plots') return [ZONE, SPECIES, true];
        if (functionName === 'payoutTarget') return [WALLET, POOL, 1_806_537_599n];
        if (functionName === 'levelOf') return 0;
        if (functionName === 'plotSettlements') return [2, reason];
        if (functionName === 'attestations') return attestation;
        throw new Error(`unexpected ${functionName}`);
      },
      logs: [
        { eventName: 'Attested', args: { eventId: EVENT, t: trigger, eligibleUnits: 8, perUnit: 10_000n, signers: [WALLET] }, blockNumber: 10n, transactionHash: '0xaa', logIndex: 0 },
        { eventName: 'Held', args: { eventId: EVENT, plotLabel: 'p1213-002', reason }, blockNumber: 11n, transactionHash: '0xcc', logIndex: 0 },
      ],
    });
    const story = await getPlotReliefStory(client, 'p1213-002', '2026', { poolAddress: POOL, fromBlock: 0n });
    expect(story.identity).toEqual({ status: 'available', level: 0 });
    expect(story.settlement).toMatchObject({ state: 'held', holdReason: 'UNVERIFIED', amountWei: '10000' });
  });

  test('keeps unavailable log indexing distinct from no settlement', async () => {
    const client = mockClient({
      readContract: ({ functionName }) => {
        if (functionName === 'plots') return [ZONE, SPECIES, true];
        if (functionName === 'payoutTarget') return [WALLET, POOL, 1_806_537_599n];
        if (functionName === 'levelOf') return 0;
        throw new Error(`unexpected ${functionName}`);
      },
      logsError: new Error('rpc log limit'),
    });
    const story = await getPlotReliefStory(client, 'p1213-009', '2026', { poolAddress: POOL, fromBlock: 0n });
    expect(story.eventsAvailable).toBe(false);
    expect(story.settlement).toBeNull();
  });
});
