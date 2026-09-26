// Futatsune buoy fixture — a synthetic in-bay reality check, offset from the karakuwa-east satellite
// series the way #22 describes (Aug 2026 mean -0.25C, -1.22 to +0.71). Only one month is fixtured: August
// 2023, the month all three REFERENCE_FIRES for 2023 fall in.
import { sha256Hex, type BuoyFile } from '@repo/shared';
import { fixtureCsvText } from './series';

export const FIXTURE_BUOY_MONTH = '2023-08';

const BUOY_OFFSET_C = -0.25;

function daysInMonth(csv: string, month: string): { date: string; sst: number | null }[] {
  return csv
    .split('\n')
    .slice(2)
    .filter((line) => line.startsWith(month))
    .map((line) => {
      const [time, raw] = line.split(',');
      const value = raw === 'NaN' || raw === undefined ? null : Number(raw);
      return { date: (time ?? '').slice(0, 10), sst: value };
    });
}

export async function fixtureBuoy(month: string): Promise<BuoyFile | null> {
  if (month !== FIXTURE_BUOY_MONTH) return null;

  const csv = fixtureCsvText('karakuwa-east', month.slice(0, 4));
  const monthDays = daysInMonth(csv, month);
  const diffs: number[] = [];
  const readings = monthDays.map(({ date, sst }, i) => {
    const jitter = (((i * 41) % 10) / 10 - 0.5) * 0.6; // buoy noise around the satellite-derived mean
    const tempC = Number(((sst ?? 20) + BUOY_OFFSET_C + jitter).toFixed(2));
    if (sst !== null) diffs.push(Number((tempC - sst).toFixed(2)));
    return { at: `${date}T06:00:00Z`, tempC };
  });

  const buoyCsv = ['at,tempC', ...readings.map((r) => `${r.at},${r.tempC}`)].join('\n') + '\n';
  const sha256 = await sha256Hex(buoyCsv);

  return {
    station: 'futatsune',
    month,
    source: {
      dataset: 'futatsune-buoy',
      url: `https://hydro.browse.jp/buoy/futatsune?month=${month}`,
      sha256,
      fetchedAt: `${month}-31T00:00:00Z`,
      point: { lat: 38.9, lon: 141.57 },
    },
    readings,
    vsSatellite: {
      meanDiffC: Number((diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(2)),
      minDiffC: Math.min(...diffs),
      maxDiffC: Math.max(...diffs),
    },
  };
}
