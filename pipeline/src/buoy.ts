// Data-work for issue #22 (buoy half). Parses the pinned Futatsune (二ツ根) buoy CSVs under
// pipeline/data/buoy/ and the pinned NASA MUR SST reference CSVs, and builds BuoyFile objects
// (pipeline/data/buoy/sources.json has every source URL, sha256 and fetch timestamp).
//
// Buoy source: 宮城県水産技術総合センター気仙沼水産試験場, station 二ツ根 (inside Kesennuma Bay),
// depth 3m, 30-min interval. http://hydro.browse.jp/hydrolift/54-miyagi/miyagi_temp.html
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { BuoyFile } from '@repo/shared';

export interface BuoyReading {
  /** ISO 8601 local time, JST (+09:00) - the CSV timestamps carry no explicit timezone but the
   *  station and prefecture are both JST. */
  at: string;
  tempC: number;
}

/**
 * Parse the tab-separated Futatsune buoy export: `YYYY/MM/DD HH:MM:SS<TAB>tempC<TAB>flag`.
 * flag "0" means good (the only value seen in the pinned CSVs); any other flag is dropped.
 */
export function parseFutatsuneCsv(text: string): BuoyReading[] {
  const out: BuoyReading[] = [];
  for (const line of text.split('\n')) {
    const row = line.trim();
    if (!row) continue;
    const parts = row.split('\t');
    if (parts.length < 3) continue;
    const [ts, tempRaw, flag] = parts;
    if (flag !== '0') continue;
    const temp = Number(tempRaw);
    if (!ts || !Number.isFinite(temp)) continue;
    const [datePart, timePart] = ts.split(' ');
    if (!datePart || !timePart) continue;
    const isoDate = datePart.replaceAll('/', '-');
    out.push({ at: `${isoDate}T${timePart}+09:00`, tempC: temp });
  }
  return out;
}

/** Local (JST) calendar-date mean, keyed by YYYY-MM-DD, matching how the source labels rows. */
export function dailyMeans(readings: readonly BuoyReading[]): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const r of readings) {
    const date = r.at.slice(0, 10);
    const bucket = sums.get(date) ?? { total: 0, count: 0 };
    bucket.total += r.tempC;
    bucket.count += 1;
    sums.set(date, bucket);
  }
  const out = new Map<string, number>();
  for (const [date, { total, count }] of sums) out.set(date, total / count);
  return out;
}

/** Parse an ERDDAP jplMURSST41 .csv response (2 header rows) into a date -> analysed_sst map. */
export function parseMurCsv(text: string): Map<string, number> {
  const lines = text.trim().split('\n');
  const out = new Map<string, number>();
  for (const line of lines.slice(2)) {
    const parts = line.split(',');
    if (parts.length < 4) continue;
    const [time, , , sst] = parts;
    const date = time?.slice(0, 10);
    const value = Number(sst);
    if (date && Number.isFinite(value)) out.set(date, value);
  }
  return out;
}

export interface VsSatellite {
  meanDiffC: number;
  minDiffC: number;
  maxDiffC: number;
  /** Number of overlapping calendar days used. */
  n: number;
}

/** buoy-daily-mean minus MUR analysed_sst, for every day present in both series. */
export function computeOffset(buoyDaily: Map<string, number>, murDaily: Map<string, number>): VsSatellite | undefined {
  const diffs: number[] = [];
  for (const [date, buoyMean] of buoyDaily) {
    const mur = murDaily.get(date);
    if (mur === undefined) continue;
    diffs.push(buoyMean - mur);
  }
  if (diffs.length === 0) return undefined;
  const meanDiffC = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return { meanDiffC, minDiffC: Math.min(...diffs), maxDiffC: Math.max(...diffs), n: diffs.length };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface BuildBuoyFileInput {
  month: string; // "2026-08"
  csvText: string;
  csvUrl: string;
  csvSha256: string;
  fetchedAt: string;
  murCsvText?: string;
}

export function buildBuoyFile(input: BuildBuoyFileInput): BuoyFile {
  const readings = parseFutatsuneCsv(input.csvText);
  const file: BuoyFile = {
    station: 'futatsune',
    month: input.month,
    source: {
      dataset: 'futatsune-buoy',
      url: input.csvUrl,
      sha256: input.csvSha256,
      fetchedAt: input.fetchedAt,
    },
    readings,
  };
  if (input.murCsvText) {
    const murDaily = parseMurCsv(input.murCsvText);
    const buoyDaily = dailyMeans(readings);
    const offset = computeOffset(buoyDaily, murDaily);
    if (offset) {
      file.vsSatellite = { meanDiffC: offset.meanDiffC, minDiffC: offset.minDiffC, maxDiffC: offset.maxDiffC };
    }
  }
  return file;
}

if (import.meta.main) {
  const dataDir = new URL('../data/buoy/', import.meta.url);
  const outDir = new URL('../out/', import.meta.url);
  const sources = await Bun.file(new URL('sources.json', dataDir)).json();
  await mkdir(fileURLToPath(outDir), { recursive: true });

  for (const buoyEntry of sources.buoy as { file: string; url: string; sha256: string; fetchedAt: string }[]) {
    const month = buoyEntry.file.match(/futatsune-(\d{4}-\d{2})\.csv$/)?.[1];
    if (!month) continue;
    const csvText = await Bun.file(new URL(buoyEntry.file, dataDir)).text();
    const computedSha = sha256Hex(new TextEncoder().encode(csvText));
    if (computedSha !== buoyEntry.sha256) {
      throw new Error(`buoy: pinned CSV sha256 mismatch for ${buoyEntry.file}`);
    }
    const murFile = (sources.mur as { file: string }[]).find((m) => m.file.includes(month))?.file;
    const murCsvText = murFile ? await Bun.file(new URL(murFile, dataDir)).text() : undefined;

    const file = buildBuoyFile({
      month,
      csvText,
      csvUrl: buoyEntry.url,
      csvSha256: buoyEntry.sha256,
      fetchedAt: buoyEntry.fetchedAt,
      murCsvText,
    });
    await Bun.write(new URL(`buoy-${month}.json`, outDir), JSON.stringify(file, null, 2));
    console.log(`wrote out/buoy-${month}.json (${file.readings.length} readings)`, file.vsSatellite ?? '(no MUR overlap)');
  }
}
