// Futatsune buoy fixture — a synthetic in-bay reality check, offset from the karakuwa-east satellite
// series the way #22 describes (Aug 2026 mean -0.25C, -1.22 to +0.71). Only one month is fixtured: August
// 2023, the month all three REFERENCE_FIRES for 2023 fall in.
import { sha256Hex, type Source } from '@repo/shared';
import { fixtureCsvText } from './series';

export const FIXTURE_BUOY_MONTH = '2023-08';

const BUOY_OFFSET_C = -0.25;

/** The app's own local shape for the Futatsune buoy ground-truth fixture. Not a `@repo/shared` interchange
 *  type: feed.ts's `StationSeries` (Trigger v2, #55) replaced the old per-station `BuoyFile` with a generic
 *  one-variable-per-series shape; this fixture predates that and is display-only (verify page), so it keeps
 *  its own richer shape (readings + a precomputed vsSatellite offset) rather than adopting StationSeries. */
export interface BuoyFixture {
  station: 'futatsune';
  month: string;
  source: Source;
  readings: { at: string; tempC: number }[];
  vsSatellite: { meanDiffC: number; minDiffC: number; maxDiffC: number };
}

function daysInMonth(csv: string, month: string): { date: string; value: number | null }[] {
  return csv
    .split('\n')
    .slice(2)
    .filter((line) => line.startsWith(month))
    .map((line) => {
      const [time, raw] = line.split(',');
      const value = raw === 'NaN' || raw === undefined ? null : Number(raw);
      return { date: (time ?? '').slice(0, 10), value };
    });
}

export async function fixtureBuoy(month: string): Promise<BuoyFixture | null> {
  if (month !== FIXTURE_BUOY_MONTH) return null;

  const csv = fixtureCsvText('karakuwa-east', month.slice(0, 4));
  const monthDays = daysInMonth(csv, month);
  const diffs: number[] = [];
  const readings = monthDays.map(({ date, value }, i) => {
    const jitter = (((i * 41) % 10) / 10 - 0.5) * 0.6; // buoy noise around the satellite-derived mean
    const tempC = Number(((value ?? 20) + BUOY_OFFSET_C + jitter).toFixed(2));
    if (value !== null) diffs.push(Number((tempC - value).toFixed(2)));
    return { at: `${date}T06:00:00Z`, tempC };
  });

  const buoyCsv = ['at,tempC', ...readings.map((r) => `${r.at},${r.tempC}`)].join('\n') + '\n';
  const sha256 = await sha256Hex(buoyCsv);

  return {
    station: 'futatsune',
    month,
    source: {
      product: 'futatsune-buoy',
      url: `https://hydro.browse.jp/buoy/futatsune?month=${month}`,
      sha256,
      fetchedAt: `${month}-31T00:00:00Z`,
    },
    readings,
    vsSatellite: {
      meanDiffC: Number((diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(2)),
      minDiffC: Math.min(...diffs),
      maxDiffC: Math.max(...diffs),
    },
  };
}
