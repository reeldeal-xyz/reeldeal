import { describe, expect, mock, test } from 'bun:test';
import type { Address, Hex } from 'viem';
import { idOf } from '@repo/shared';
import { batchPlots, listEnrolledPlots } from './plots';
import type { KeeperPublicClient } from './chain-clients';

const POOL_ADDRESS = '0xpool0000000000000000000000000000000000' as Address;
const ZONE_ID = idOf('karakuwa-east');
const SPECIES_ID = idOf('scallop');
const OTHER_SPECIES_ID = idOf('hoya');

function fakeClient(opts: {
  logs: { plotLabel: string }[];
  plots: Record<string, { zoneId: Hex; speciesId: Hex; enrolled: boolean }>;
}): KeeperPublicClient {
  return {
    getLogs: mock(async () => opts.logs.map((l) => ({ args: { plotLabel: l.plotLabel } }))),
    readContract: mock(async ({ args }: { args: readonly [string] }) => {
      const label = args[0];
      const p = opts.plots[label] ?? { zoneId: '0x0' as Hex, speciesId: '0x0' as Hex, enrolled: false };
      return [p.zoneId, p.speciesId, p.enrolled];
    }),
  } as unknown as KeeperPublicClient;
}

describe('listEnrolledPlots', () => {
  test('returns only plots currently enrolled for the target zone/species, sorted', async () => {
    const client = fakeClient({
      logs: [{ plotLabel: 'p3' }, { plotLabel: 'p1' }, { plotLabel: 'p2' }, { plotLabel: 'p-other-species' }, { plotLabel: 'p-unenrolled' }],
      plots: {
        p1: { zoneId: ZONE_ID, speciesId: SPECIES_ID, enrolled: true },
        p2: { zoneId: ZONE_ID, speciesId: SPECIES_ID, enrolled: true },
        p3: { zoneId: ZONE_ID, speciesId: SPECIES_ID, enrolled: true },
        'p-other-species': { zoneId: ZONE_ID, speciesId: OTHER_SPECIES_ID, enrolled: true },
        'p-unenrolled': { zoneId: ZONE_ID, speciesId: SPECIES_ID, enrolled: false },
      },
    });

    const result = await listEnrolledPlots({ publicClient: client, poolAddress: POOL_ADDRESS, zoneId: ZONE_ID, speciesId: SPECIES_ID });
    expect(result).toEqual(['p1', 'p2', 'p3']);
  });

  test('dedupes a plot enrolled (or reindexed) multiple times in the event log', async () => {
    const client = fakeClient({
      logs: [{ plotLabel: 'p1' }, { plotLabel: 'p1' }, { plotLabel: 'p1' }],
      plots: { p1: { zoneId: ZONE_ID, speciesId: SPECIES_ID, enrolled: true } },
    });
    const result = await listEnrolledPlots({ publicClient: client, poolAddress: POOL_ADDRESS, zoneId: ZONE_ID, speciesId: SPECIES_ID });
    expect(result).toEqual(['p1']);
  });

  test('excludes a plot that was reindexed away from the target species since being enrolled', async () => {
    const client = fakeClient({
      logs: [{ plotLabel: 'p1' }],
      plots: { p1: { zoneId: ZONE_ID, speciesId: OTHER_SPECIES_ID, enrolled: true } }, // current state moved on
    });
    const result = await listEnrolledPlots({ publicClient: client, poolAddress: POOL_ADDRESS, zoneId: ZONE_ID, speciesId: SPECIES_ID });
    expect(result).toEqual([]);
  });

  test('returns an empty array when there are no Enrolled logs', async () => {
    const client = fakeClient({ logs: [], plots: {} });
    const result = await listEnrolledPlots({ publicClient: client, poolAddress: POOL_ADDRESS, zoneId: ZONE_ID, speciesId: SPECIES_ID });
    expect(result).toEqual([]);
  });
});

describe('batchPlots', () => {
  test('splits into batches of 5 by default', () => {
    const labels = Array.from({ length: 13 }, (_, i) => `p${i}`);
    const batches = batchPlots(labels);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(5);
    expect(batches[1]).toHaveLength(5);
    expect(batches[2]).toHaveLength(3);
  });

  test('returns no batches for an empty list', () => {
    expect(batchPlots([])).toEqual([]);
  });

  test('honors a custom batch size', () => {
    expect(batchPlots(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
  });
});
