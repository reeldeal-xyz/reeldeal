/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { encodeAbiParameters, encodeEventTopics, getAbiItem, erc20Abi, type PublicClient, type TransactionReceipt } from 'viem';
import { JPYC, ReliefPoolAbi } from '@repo/shared';
import { getFundSummary, getPlotReliefStory, computeFundTotals, readReliefPoolEvents, type ReliefPoolEvent } from '../src/lib/chain/client.server';
import { hasMatchingPayment } from '../src/lib/chain/relief-proof';
import { parseReliefRequest } from '../src/lib/relief-request';

const POOL = '0x1111111111111111111111111111111111111111';
const WALLET = '0x2222222222222222222222222222222222222222';
const ZERO = `0x${'0'.repeat(64)}` as const;
const ZONE = `0x${'1'.repeat(64)}` as const;
const SPECIES = `0x${'2'.repeat(64)}` as const;
const EVENT = `0x${'a'.repeat(64)}` as const;
const OTHER_EVENT = `0x${'b'.repeat(64)}` as const;
const TX = `0x${'c'.repeat(64)}` as const;
const paid: ReliefPoolEvent = { type: 'Paid', plotLabel: 'p1213-001', eventId: EVENT, farmer: WALLET, amountWei: '10000', txHash: TX, blockNumber: 100, logIndex: 1 };
const attestation = [ZONE, SPECIES, '2026', 8, 10000n, 70000n, 1780358500n, 1800000000n] as const;
const options = { poolAddress: POOL, fromBlock: 0n, events: [paid] } as const;

function clientWith(overrides: Record<string, unknown> = {}): PublicClient {
  return {
    getBlockNumber: async () => 200n,
    getLogs: async () => [],
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'plots') return [ZONE, SPECIES, true];
      if (functionName === 'payoutTarget') return [WALLET, POOL, 1800000000n];
      if (functionName === 'levelOf') return 2;
      if (functionName === 'plotSettlements') return [1, ZERO];
      if (functionName === 'attestations') return attestation;
      if (functionName === 'balanceOf') return 90000n;
      if (functionName === 'reserved') return 70000n;
      throw new Error(`Unexpected read: ${functionName}`);
    },
    ...overrides,
  } as unknown as PublicClient;
}

async function story(overrides: Record<string, unknown> = {}) {
  return getPlotReliefStory(clientWith(overrides), 'p1213-001', '2026', { ...options, events: [...options.events] });
}

describe('relief selection', () => {
  test('defaults only omitted season, not malformed selections', () => {
    expect(parseReliefRequest('p1213-001', new URLSearchParams())).toEqual({ plotLabel: 'p1213-001', season: '2026' });
    for (const q of ['season=', 'season=bad', 'season=2026&season=2025', 'eventId=0x1', 'plot=p1&plot=p2']) {
      expect(parseReliefRequest('p1213-001', new URLSearchParams(q))).toBeNull();
    }
    for (const plot of ['', undefined, '%ZZ', 'p/../other', 'a'.repeat(81)]) {
      expect(parseReliefRequest(plot, new URLSearchParams())).toBeNull();
    }
    expect(parseReliefRequest('p1213-001', new URLSearchParams(`season=2025&eventId=${EVENT}`))?.eventId).toBe(EVENT);
  });
});

describe('relief read integrity', () => {
  test('RPC failure stays unknown, not unenrolled, unverified or zero paid', async () => {
    const unavailable = { readContract: async () => { throw new Error('RPC failed'); }, getLogs: async () => { throw new Error('RPC failed'); } };
    const fund = await getFundSummary(clientWith(unavailable), { poolAddress: POOL, fromBlock: 0n });
    expect(fund.totals).toBeNull();
    expect(fund.availableWei).toBeNull();
    const result = await story(unavailable);
    expect(result.enrolled).toBeNull();
    expect(result.targetReadAvailable).toBe(false);
    expect(result.settlementReadStatus).toBe('unavailable');
  });

  test('pins balances, reservations and event range to one block', async () => {
    const reads: bigint[] = [];
    const ranges: bigint[] = [];
    const c = clientWith({
      readContract: async ({ blockNumber, functionName }: { blockNumber: bigint; functionName: string }) => { reads.push(blockNumber); return functionName === 'balanceOf' ? 90000n : 70000n; },
      getLogs: async ({ toBlock }: { toBlock: bigint }) => { ranges.push(toBlock); return []; },
    });
    const fund = await getFundSummary(c, { poolAddress: POOL, fromBlock: 0n });
    expect(fund.availableWei).toBe('20000');
    expect(fund.atBlock).toBe('200');
    expect(reads).toEqual([200n, 200n]);
    expect(ranges).toEqual([200n]);
  });

  test('uses bounded, contiguous log ranges', async () => {
    const ranges: [bigint, bigint][] = [];
    const c = clientWith({ getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => { ranges.push([fromBlock, toBlock]); return []; } });
    await readReliefPoolEvents(c, POOL, 10n, ['Paid'], 60010n);
    expect(ranges).toEqual([[10n, 25009n], [25010n, 50009n], [50010n, 60010n]]);
  });

  test('newer payment from another season does not hide requested-season payment', async () => {
    const c = clientWith();
    const original = c.readContract;
    c.readContract = (async (args: { functionName: string; args?: unknown[] }) => {
      if (args.functionName === 'attestations' && args.args?.[0] === OTHER_EVENT) return [ZONE, SPECIES, '2027', ...attestation.slice(3)];
      return original(args as never);
    }) as PublicClient['readContract'];
    const result = await getPlotReliefStory(c, 'p1213-001', '2026', { ...options, events: [{ ...paid, eventId: OTHER_EVENT, blockNumber: 150 }, paid] });
    expect(result.settlement?.eventId).toBe(EVENT);
    expect(result.latestEvent?.eventId).toBe(EVENT);
  });

  test('explicit event selection is not replaced with a newer unrelated event', async () => {
    const result = await getPlotReliefStory(clientWith(), 'p1213-001', '2026', { ...options, events: [paid], eventId: OTHER_EVENT });
    expect(result.settlement?.eventId).toBe(OTHER_EVENT);
    expect(result.settlement?.txHash).toBeNull();
  });

  test('refetches a truncated activity list rather than treating it as complete history', async () => {
    let queries = 0;
    const result = await getPlotReliefStory(clientWith({ getLogs: async () => { queries++; return [{ eventName: 'Paid', args: { eventId: EVENT, plotLabel: 'p1213-001', farmer: WALLET, amount: 10000n }, blockNumber: 100n, transactionHash: TX, logIndex: 1 }]; } }), 'p1213-001', '2026', { ...options, events: [], eventsComplete: false });
    expect(queries).toBe(1);
    expect(result.settlement?.eventId).toBe(EVENT);
  });

  test('event-keyed hold accounting handles out-of-order and different-event resolutions', () => {
    expect(computeFundTotals([
      { ...paid, type: 'Swept', eventId: EVENT, blockNumber: 30 },
      { ...paid, type: 'Held', eventId: OTHER_EVENT, blockNumber: 20 },
      { ...paid, type: 'Held', eventId: EVENT, blockNumber: 10 },
    ]).heldCount).toBe(1);
  });
});

function receiptFor(amount = 10000n, plotLabel = 'p1213-001'): TransactionReceipt {
  const args = { eventId: EVENT, plotLabel, farmer: WALLET, nullifier: SPECIES, amount } as const;
  const event = getAbiItem({ abi: ReliefPoolAbi, name: 'Paid' });
  const inputs = event.inputs.filter((input) => !input.indexed);
  const log = {
    address: POOL,
    topics: encodeEventTopics({ abi: ReliefPoolAbi, eventName: 'Paid', args }),
    data: encodeAbiParameters(inputs, inputs.map((input) => args[input.name as keyof typeof args])),
  };
  const transfer = { address: JPYC,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: POOL, to: WALLET } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
  };
  return { status: 'success', transactionHash: TX, blockNumber: 100n, logs: [log, transfer] } as unknown as TransactionReceipt;
}

describe('receipt-backed relief payment label', () => {
  test('requires a matching nonzero Paid log from the configured pool', async () => {
    const settlement = (await story()).settlement!;
    expect(hasMatchingPayment('p1213-001', settlement, receiptFor(), POOL)).toBe(true);
    expect(hasMatchingPayment('p1213-002', settlement, receiptFor(), POOL)).toBe(false);
    expect(hasMatchingPayment('p1213-001', settlement, receiptFor(9000n), POOL)).toBe(false);
    expect(hasMatchingPayment('p1213-001', settlement, receiptFor(), WALLET)).toBe(false);
    expect(hasMatchingPayment('p1213-001', settlement, { ...receiptFor(), status: 'reverted' }, POOL)).toBe(false);
    expect(hasMatchingPayment('p1213-001', settlement, { ...receiptFor(), logs: [] }, POOL)).toBe(false);
    expect(hasMatchingPayment('p1213-001', settlement, { ...receiptFor(), logs: receiptFor().logs.slice(0, 1) }, POOL)).toBe(false);
    expect(hasMatchingPayment('p1213-001', { ...settlement, amountWei: '0' }, receiptFor(0n), POOL)).toBe(false);
    expect(hasMatchingPayment('p1213-001', { ...settlement, txHash: OTHER_EVENT }, receiptFor(), POOL)).toBe(false);
  });
});
