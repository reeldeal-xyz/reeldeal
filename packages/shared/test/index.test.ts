// Smoke tests for @repo/shared. `bun run test` at the repo root runs this package's "test"
// script too (see package.json), but until now there were zero test files here, which made the
// root command fail before it ever reached `forge test`. This is deliberately not a duplicate
// of pipeline/test/rules.test.ts (the pipeline's own regression target) - it just covers the
// pieces of @repo/shared (ids, trigger EIP-712 shape, feed schemas) that had no coverage.
import { expect, test, describe } from 'bun:test';
import {
  ZONES,
  SPECIES,
  PERILS,
  idOf,
  eventIdOf,
  RULES,
  REFERENCE_FIRES,
  TRIGGER_EIP712_TYPES,
  eip712Domain,
  Source,
  BuoyFile,
  TriggersFile,
} from '../src/index';

describe('identifiers', () => {
  test('ZONES/SPECIES/PERILS include the values the pipeline and contracts rely on', () => {
    expect(ZONES).toContain('karakuwa-east');
    expect(ZONES).toContain('kesennuma-bay');
    expect(SPECIES).toContain('scallop');
    expect(PERILS).toContain('BANWEEKS');
  });

  test('idOf is deterministic and 0x-prefixed 32-byte hex', () => {
    const a = idOf('karakuwa-east');
    const b = idOf('karakuwa-east');
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(idOf('kesennuma-bay')).not.toBe(a);
  });

  test('eventIdOf is deterministic and varies with every argument', () => {
    const base = eventIdOf('karakuwa-east', 'scallop', 'BANWEEKS', 1, '2026');
    expect(base).toBe(eventIdOf('karakuwa-east', 'scallop', 'BANWEEKS', 1, '2026'));
    expect(base).not.toBe(eventIdOf('kesennuma-bay', 'scallop', 'BANWEEKS', 1, '2026'));
    expect(base).not.toBe(eventIdOf('karakuwa-east', 'hoya', 'BANWEEKS', 1, '2026'));
    expect(base).not.toBe(eventIdOf('karakuwa-east', 'scallop', 'HEAT24', 1, '2026'));
    expect(base).not.toBe(eventIdOf('karakuwa-east', 'scallop', 'BANWEEKS', 2, '2026'));
    expect(base).not.toBe(eventIdOf('karakuwa-east', 'scallop', 'BANWEEKS', 1, '2025'));
  });
});

describe('rules and regression targets', () => {
  test('RULES has a BANWEEKS rule per shellfish species with threshold 4', () => {
    const banweeks = RULES.filter((r) => r.peril === 'BANWEEKS');
    expect(banweeks.length).toBeGreaterThan(0);
    for (const r of banweeks) expect(r.threshold).toBe(4);
  });

  test('REFERENCE_FIRES 2022 has no fires and 2023 matches the documented regression target', () => {
    expect(Object.keys(REFERENCE_FIRES['2022'])).toHaveLength(0);
    expect(REFERENCE_FIRES['2023']['scallop:2']).toBe('2023-08-14');
    expect(REFERENCE_FIRES['2023']['scallop:1']).toBe('2023-08-13');
  });
});

describe('EIP-712 trigger shape', () => {
  test('eip712Domain matches docs/INTERFACE.md (ReliefPool, v1, Sepolia)', () => {
    const domain = eip712Domain('0x0000000000000000000000000000000000000001');
    expect(domain.name).toBe('ReliefPool');
    expect(domain.version).toBe('1');
    expect(domain.chainId).toBe(11155111);
  });

  test('TRIGGER_EIP712_TYPES.Trigger field order matches the Trigger interface', () => {
    const names = TRIGGER_EIP712_TYPES.Trigger.map((f) => f.name);
    expect(names).toEqual([
      'zoneId',
      'speciesId',
      'perilId',
      'tier',
      'seasonLabel',
      'windowStart',
      'windowEnd',
      'firedAt',
      'index',
      'threshold',
      'dataHash',
      'deadline',
    ]);
  });
});

describe('feed schemas', () => {
  test('Source requires a real URL and a 32-byte sha256 hex string', () => {
    expect(() =>
      Source.parse({
        dataset: 'jplMURSST41',
        url: 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.csv',
        sha256: 'a'.repeat(64),
        fetchedAt: '2026-09-26T00:00:00Z',
      }),
    ).not.toThrow();
    expect(() => Source.parse({ dataset: 'x', url: 'not-a-url', sha256: 'a'.repeat(64), fetchedAt: 'x' })).toThrow();
    expect(() => Source.parse({ dataset: 'x', url: 'https://x.test', sha256: 'not-hex', fetchedAt: 'x' })).toThrow();
  });

  test('BuoyFile accepts an unsigned reading list with an optional vsSatellite', () => {
    const parsed = BuoyFile.parse({
      station: 'futatsune',
      month: '2026-08',
      source: {
        dataset: 'futatsune-buoy',
        url: 'http://hydro.browse.jp/hydrolift/54-miyagi/miyagi_data/data0_last.csv',
        sha256: 'b'.repeat(64),
        fetchedAt: '2026-09-26T00:00:00Z',
      },
      readings: [{ at: '2026-08-01T00:21:32+09:00', tempC: 21.9 }],
      vsSatellite: { meanDiffC: -0.25, minDiffC: -1.22, maxDiffC: 0.71 },
    });
    expect(parsed.readings).toHaveLength(1);
  });

  test('TriggersFile accepts an unsigned trigger (empty signatures array)', () => {
    const parsed = TriggersFile.parse({
      zone: 'karakuwa-east',
      season: '2026',
      triggers: [
        {
          label: 'scallop:1',
          zone: 'karakuwa-east',
          species: 'scallop',
          peril: 'BANWEEKS',
          firedOn: '2026-06-02',
          trigger: {
            zoneId: idOf('karakuwa-east'),
            speciesId: idOf('scallop'),
            perilId: idOf('BANWEEKS'),
            tier: 1,
            seasonLabel: '2026',
            windowStart: '1',
            windowEnd: '2',
            firedAt: '2',
            index: 4,
            threshold: 4,
            dataHash: `0x${'c'.repeat(64)}`,
            deadline: '3',
          },
          signatures: [],
        },
      ],
    });
    expect(parsed.triggers[0]?.signatures).toEqual([]);
  });
});
