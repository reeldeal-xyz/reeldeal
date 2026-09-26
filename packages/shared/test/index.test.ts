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
  IndicesFile,
} from '../src/index';

describe('identifiers', () => {
  test('ZONES/SPECIES/PERILS include the values the pipeline and contracts rely on', () => {
    expect(ZONES).toContain('karakuwa-east');
    expect(ZONES).toContain('kesennuma-bay');
    expect(SPECIES).toContain('scallop');
    expect(PERILS).toContain('BANWEEKS');
    expect(PERILS).toContain('HEAT');
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
    expect(base).not.toBe(eventIdOf('karakuwa-east', 'scallop', 'HEAT', 1, '2026'));
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

  test('RULES has a tempC for every HEAT rule, and none for BANWEEKS', () => {
    for (const r of RULES) {
      if (r.peril === 'HEAT') expect(typeof r.tempC).toBe('number');
      else expect(r.tempC).toBeUndefined();
    }
  });

  test('REFERENCE_FIRES 2022 has no fires and 2023 matches the documented regression target', () => {
    expect(Object.keys(REFERENCE_FIRES['2022'])).toHaveLength(0);
    expect(REFERENCE_FIRES['2023']['scallop:2']).toBe('2023-08-14');
    expect(REFERENCE_FIRES['2023']['scallop:1']).toBe('2023-08-13');
  });
});

describe('EIP-712 trigger shape', () => {
  test('eip712Domain matches docs/INTERFACE.md (ReliefPool, v2, Sepolia)', () => {
    const domain = eip712Domain('0x0000000000000000000000000000000000000001');
    expect(domain.name).toBe('ReliefPool');
    expect(domain.version).toBe('2');
    expect(domain.chainId).toBe(11155111);
  });

  test('TRIGGER_EIP712_TYPES.Trigger field order matches the Trigger interface, tempC just before dataHash', () => {
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
      'tempC',
      'dataHash',
      'deadline',
    ]);
  });
});

describe('feed schemas', () => {
  test('Source requires a product name and a 32-byte sha256 hex string', () => {
    expect(() =>
      Source.parse({
        product: 'GCOM-C_SGLI_L3-SST.nighttime.v3',
        sha256: 'a'.repeat(64),
        url: 'https://gportal.jaxa.jp/gpr/search',
        fetchedAt: '2026-09-26T00:00:00Z',
      }),
    ).not.toThrow();
    // url/fetchedAt are optional (e.g. a hand-transcribed prefecture bulletin has no query URL)
    expect(() => Source.parse({ product: 'hab-bans-miyagi-2025', sha256: 'b'.repeat(64) })).not.toThrow();
    expect(() => Source.parse({ product: 'x', sha256: 'not-hex' })).toThrow();
    expect(() => Source.parse({ product: 'x', sha256: 'a'.repeat(64), url: 'not-a-url' })).toThrow();
  });

  test('IndicesFile accepts one daily series per index, keyed by module', () => {
    const parsed = IndicesFile.parse({
      module: 'heat',
      module_version: 'heat-0.1.0',
      zone: 'karakuwa-east',
      season: '2023',
      series: [
        {
          index: 'SST',
          unit: 'degC',
          source: { product: 'GCOM-C_SGLI_L3-SST.nighttime.v3', sha256: 'a'.repeat(64) },
          days: [{ date: '2023-08-11', value: 26.4 }],
        },
      ],
    });
    expect(parsed.series[0]?.days[0]?.value).toBe(26.4);
  });
});
