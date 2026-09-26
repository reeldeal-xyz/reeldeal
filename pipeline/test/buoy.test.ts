import { expect, test, describe } from 'bun:test';
import { BuoyFile } from '@repo/shared';
import {
  parseFutatsuneCsv,
  dailyMeans,
  parseMurCsv,
  computeOffset,
  buildBuoyFile,
  sha256Hex,
} from '../src/buoy';

const dataDir = new URL('../data/buoy/', import.meta.url);
const sources = await Bun.file(new URL('sources.json', dataDir)).json();

async function read(file: string): Promise<string> {
  return Bun.file(new URL(file, dataDir)).text();
}

describe('buoy CSV pinning (#22)', () => {
  test('pinned CSVs match their recorded sha256', async () => {
    for (const entry of [...sources.buoy, ...sources.mur] as { file: string; sha256: string }[]) {
      const text = await read(entry.file);
      expect(sha256Hex(new TextEncoder().encode(text))).toBe(entry.sha256);
    }
  });

  test('parses the August 2026 Futatsune CSV (31 days, half-hourly)', async () => {
    const text = await read('futatsune-2026-08.csv');
    const readings = parseFutatsuneCsv(text);
    expect(readings.length).toBeGreaterThan(1400); // ~48/day * 31 days
    expect(readings[0]!.at.startsWith('2026-08-01')).toBe(true);
    expect(readings.every((r) => Number.isFinite(r.tempC))).toBe(true);
  });

  test('daily means cover all 31 days of August 2026', async () => {
    const text = await read('futatsune-2026-08.csv');
    const daily = dailyMeans(parseFutatsuneCsv(text));
    expect(daily.size).toBe(31);
    expect(daily.get('2026-08-01')).toBeCloseTo(22.336, 2);
  });
});

describe('buoy vs MUR SST offset (#22 regression target)', () => {
  test('reproduces the quoted August 2026 offset: mean -0.25, range -1.22..0.71', async () => {
    const buoyText = await read('futatsune-2026-08.csv');
    const murText = await read('mur-reference-2026-08.csv');
    const daily = dailyMeans(parseFutatsuneCsv(buoyText));
    const mur = parseMurCsv(murText);
    const offset = computeOffset(daily, mur);
    expect(offset).toBeDefined();
    expect(offset!.n).toBe(31);
    expect(offset!.meanDiffC).toBeCloseTo(-0.25, 2);
    expect(offset!.minDiffC).toBeCloseTo(-1.22, 2);
    expect(offset!.maxDiffC).toBeCloseTo(0.71, 2);
  });

  test('September 2026 offset is computed over the ERDDAP-available overlap only', async () => {
    const buoyText = await read('futatsune-2026-09.csv');
    const murText = await read('mur-reference-2026-09.csv');
    const daily = dailyMeans(parseFutatsuneCsv(buoyText));
    const mur = parseMurCsv(murText);
    expect(daily.size).toBeGreaterThan(24); // buoy has partial data through 09-26
    expect(mur.size).toBe(24); // ERDDAP axis maximum was 2026-09-24 at fetch time
    const offset = computeOffset(daily, mur);
    expect(offset?.n).toBe(24);
  });
});

describe('BuoyFile schema (#22)', () => {
  test('buildBuoyFile output validates against the shared BuoyFile schema, with vsSatellite', async () => {
    const csvText = await read('futatsune-2026-08.csv');
    const murCsvText = await read('mur-reference-2026-08.csv');
    const entry = (sources.buoy as { file: string; url: string; sha256: string; fetchedAt: string }[]).find(
      (b) => b.file === 'futatsune-2026-08.csv',
    )!;
    const file = buildBuoyFile({
      month: '2026-08',
      csvText,
      csvUrl: entry.url,
      csvSha256: entry.sha256,
      fetchedAt: entry.fetchedAt,
      murCsvText,
    });
    const parsed = BuoyFile.parse(file);
    expect(parsed.station).toBe('futatsune');
    expect(parsed.month).toBe('2026-08');
    expect(parsed.vsSatellite).toBeDefined();
    expect(parsed.vsSatellite!.meanDiffC).toBeCloseTo(-0.25, 2);
  });

  test('September file validates even with a partial month (no MUR overlap requirement)', async () => {
    const csvText = await read('futatsune-2026-09.csv');
    const entry = (sources.buoy as { file: string; url: string; sha256: string; fetchedAt: string }[]).find(
      (b) => b.file === 'futatsune-2026-09.csv',
    )!;
    const file = buildBuoyFile({
      month: '2026-09',
      csvText,
      csvUrl: entry.url,
      csvSha256: entry.sha256,
      fetchedAt: entry.fetchedAt,
    });
    expect(() => BuoyFile.parse(file)).not.toThrow();
  });
});
