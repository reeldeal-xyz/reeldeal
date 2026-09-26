import { expect, test, describe } from 'bun:test';
import { TriggersFile, RULES, idOf } from '@repo/shared';
import {
  buildWeeklySeries,
  banweeksIndex,
  findFireEntry,
  buildBanweeksTrigger,
  buildZoneTriggersFile,
  sha256Hex,
  type ToxinSourceData,
} from '../src/banweeks';

const dataDir = new URL('../data/toxin/', import.meta.url);
const toxin: ToxinSourceData = await Bun.file(new URL('scallop-ban-2026.json', dataDir)).json();

describe('BANWEEKS rule (#28)', () => {
  test('RULES has a scallop tier-1 BANWEEKS rule with threshold 4', () => {
    const rule = RULES.find((r) => r.peril === 'BANWEEKS' && r.species === 'scallop' && r.tier === 1);
    expect(rule).toBeDefined();
    expect(rule!.threshold).toBe(4);
  });
});

describe('weekly series and index', () => {
  test('karakuwa-east: 18 restricted weeks then lifted, matching the pinned PDF', () => {
    const zone = toxin.zones['karakuwa-east']!;
    const series = buildWeeklySeries(zone.banStart, zone.banLift);
    expect(series.filter((e) => e.restricted).length).toBe(18);
    expect(series.at(-1)).toEqual({ date: '2026-09-15', restricted: false });
  });

  test('kesennuma-bay: 15 restricted weeks then lifted, matching the pinned PDF', () => {
    const zone = toxin.zones['kesennuma-bay']!;
    const series = buildWeeklySeries(zone.banStart, zone.banLift);
    expect(series.filter((e) => e.restricted).length).toBe(15);
    expect(series.at(-1)).toEqual({ date: '2026-09-08', restricted: false });
  });

  test('index reaches the threshold (4) on the 4th consecutive restricted week', () => {
    const zone = toxin.zones['karakuwa-east']!;
    const series = buildWeeklySeries(zone.banStart, zone.banLift);
    const idx = banweeksIndex(series);
    expect(idx.slice(0, 4)).toEqual([
      { date: '2026-05-12', index: 1 },
      { date: '2026-05-19', index: 2 },
      { date: '2026-05-26', index: 3 },
      { date: '2026-06-02', index: 4 },
    ]);
    expect(findFireEntry(series, 4)).toEqual({ date: '2026-06-02', index: 4 });
  });
});

describe('Trigger construction and firing (#28 done-when)', () => {
  const dataHash = `0x${'ab'.repeat(32)}` as const;

  test('karakuwa-east scallop BANWEEKS fires on 2026-06-02', () => {
    const zone = toxin.zones['karakuwa-east']!;
    const built = buildBanweeksTrigger({
      zone: 'karakuwa-east',
      species: 'scallop',
      season: '2026',
      banStart: zone.banStart,
      banLift: zone.banLift,
      dataHash,
    });
    expect(built).toBeDefined();
    expect(built!.firedOn).toBe('2026-06-02');
    expect(built!.trigger.zoneId).toBe(idOf('karakuwa-east'));
    expect(built!.trigger.speciesId).toBe(idOf('scallop'));
    expect(built!.trigger.perilId).toBe(idOf('BANWEEKS'));
    expect(built!.trigger.tier).toBe(1);
    expect(built!.trigger.threshold).toBe(4);
    expect(built!.trigger.index).toBe(4);
    expect(built!.trigger.seasonLabel).toBe('2026');
    expect(built!.trigger.windowStart < built!.trigger.firedAt).toBe(true);
    expect(built!.trigger.deadline > built!.trigger.firedAt).toBe(true);
  });

  test('kesennuma-bay scallop BANWEEKS fires on 2026-06-16', () => {
    const zone = toxin.zones['kesennuma-bay']!;
    const built = buildBanweeksTrigger({
      zone: 'kesennuma-bay',
      species: 'scallop',
      season: '2026',
      banStart: zone.banStart,
      banLift: zone.banLift,
      dataHash,
    });
    expect(built?.firedOn).toBe('2026-06-16');
    expect(built?.trigger.index).toBe(4);
  });

  test('the prior (unverified-start) kesennuma-bay episode is not used for a trigger', () => {
    // scallop-ban-2026.json only records banStart/banLift for the fully-observed FY2026
    // episode; priorEpisode.startDate is intentionally absent (do not invent dates).
    const zone = toxin.zones['kesennuma-bay']! as unknown as { priorEpisode?: { startDate?: unknown } };
    expect(zone.priorEpisode?.startDate).toBeUndefined();
  });
});

describe('TriggersFile output validates against the shared feed schema', () => {
  test('buildZoneTriggersFile produces a schema-valid, unsigned BANWEEKS trigger with its source PDF cited', async () => {
    const pdfBytes = new Uint8Array(
      await Bun.file(new URL(toxin.source.file.replace(/^pipeline\/data\/toxin\//, ''), dataDir)).arrayBuffer(),
    );
    const dataHash = sha256Hex(pdfBytes);
    expect(dataHash.slice(2)).toBe(toxin.source.sha256);

    for (const zone of ['karakuwa-east', 'kesennuma-bay'] as const) {
      const file = buildZoneTriggersFile(zone, '2026', toxin, dataHash);
      const parsed = TriggersFile.parse(file);
      expect(parsed.triggers.length).toBe(1);
      const t = parsed.triggers[0]!;
      expect(t.label).toBe('scallop:1');
      expect(t.peril).toBe('BANWEEKS');
      expect(t.trigger.dataHash).toBe(dataHash);
      expect(t.signatures).toEqual([]); // unsigned; #9 signs after this
    }
  });
});
