import { describe, expect, mock, test } from 'bun:test';
import { stringToHex, zeroHash, type Address, type Hex } from 'viem';
import { eventIdOf, idOf } from '@repo/shared';
import type { EscalatedRun } from '@/lib/keeper-runs';
import type { KeeperPublicClient } from './chain-clients';
import { listEventStatuses } from './event-status';
import { getReferenceEvent } from './reference-events';

const POOL = '0x1111111111111111111111111111111111111111' as Address;
const FARMER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const BAN = getReferenceEvent('2026-scallop-banweeks-karakuwa');
const HEAT = getReferenceEvent('2023-scallop-tier2');
const BAN_ID = eventIdOf(BAN.zone, BAN.species, BAN.peril, BAN.tier, BAN.payoutSeasonLabel);

function fakeClient(opts: { attested: Set<Hex>; statuses: Record<string, [number, Hex]> }) {
  return {
    readContract: mock(async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      switch (functionName) {
        case 'attestations': {
          const on = opts.attested.has(args[0] as Hex);
          return [idOf('karakuwa-east'), idOf('scallop'), '2026', 2, 10n ** 22n, 2n * 10n ** 22n, on ? 1_700_000_000n : 0n, 1_900_000_000n];
        }
        case 'plots':
          return [idOf('karakuwa-east'), idOf('scallop'), true];
        case 'plotSettlements':
          return opts.statuses[args[1] as string] ?? [0, zeroHash];
        default:
          throw new Error(`unexpected ${functionName}`);
      }
    }),
    getLogs: mock(async ({ event }: { event?: { name: string } }) => {
      if (event?.name === 'Enrolled') return [{ args: { plotLabel: 'p1' } }, { args: { plotLabel: 'p2' } }];
      if (event?.name === 'Attested')
        return [{ eventName: 'Attested', transactionHash: '0xa77e57', args: { eventId: BAN_ID, t: { dataHash: '0xdada' }, signers: [FARMER, FARMER] } }];
      if (event?.name === 'Paid')
        return [{ eventName: 'Paid', transactionHash: '0x9a1d', args: { eventId: BAN_ID, plotLabel: 'p1', farmer: FARMER, amount: 10n ** 22n } }];
      if (event?.name === 'Held') return [{ eventName: 'Held', transactionHash: '0x4e1d', args: { eventId: BAN_ID, plotLabel: 'p2' } }];
      return [];
    }),
  } as unknown as KeeperPublicClient;
}

const escalation = (referenceEventId: string): EscalatedRun => ({
  id: 'r1',
  referenceEventId,
  eventId: '0x',
  status: 'escalated',
  jevDecision: 'co_op_review',
  jevConfidence: 0.53,
  jevReason: 'low_confidence',
  jevProbabilities: null,
  createdAt: '2026-09-26T00:00:00Z',
  resolvedAt: null,
});

describe('listEventStatuses', () => {
  test('unattested events are not_fired, or awaiting_coop when Jev escalated them', async () => {
    const publicClient = fakeClient({ attested: new Set(), statuses: {} });
    const [ban, heat] = await listEventStatuses(
      { publicClient, poolAddress: POOL, fromBlock: 0n, escalatedRuns: async () => [escalation(HEAT.id)] },
      [BAN, HEAT],
    );
    expect(ban?.stage).toBe('not_fired');
    expect(heat?.stage).toBe('awaiting_coop');
    expect(heat?.escalation?.jevConfidence).toBe(0.53);
  });

  test('an attested event with an unsettled plot is anchored, with the attest tx and data hash', async () => {
    const publicClient = fakeClient({ attested: new Set([BAN_ID]), statuses: { p1: [1, zeroHash] } });
    const [ban] = await listEventStatuses({ publicClient, poolAddress: POOL, fromBlock: 0n, escalatedRuns: async () => [] }, [BAN]);
    expect(ban?.stage).toBe('anchored');
    expect(ban?.attestation).toMatchObject({ txHash: '0xa77e57', dataHash: '0xdada', eligibleUnits: 2 });
    expect(ban?.plots.map((p) => p.state)).toEqual(['Paid', 'Unsettled']);
  });

  test('every plot settled makes the event settled, with amounts and hold reasons', async () => {
    const reason = stringToHex('UNVERIFIED', { size: 32 });
    const publicClient = fakeClient({ attested: new Set([BAN_ID]), statuses: { p1: [1, zeroHash], p2: [2, reason] } });
    const [ban] = await listEventStatuses({ publicClient, poolAddress: POOL, fromBlock: 0n, escalatedRuns: async () => [] }, [BAN]);
    expect(ban?.stage).toBe('settled');
    expect(ban?.plots).toEqual([
      { plotLabel: 'p1', state: 'Paid', amount: (10n ** 22n).toString(), farmer: FARMER, txHash: '0x9a1d' },
      { plotLabel: 'p2', state: 'Held', reason: 'UNVERIFIED', txHash: '0x4e1d' },
    ]);
  });
});
