// Realistic-looking (synthetic, NOT measured) SST fixtures, served by lib/feed-client.ts when
// PIPELINE_FEED_URL (pipeline/src/fetch.ts + indices.ts, owner Jay, #3/#6) is unreachable.
//
// karakuwa-east is constructed, day by day, to reproduce `REFERENCE_FIRES` from `@repo/shared` exactly —
// see web/test/fixtures.test.ts for the assertion. kesennuma-bay is derived from it with a coastal
// offset, in the same spirit as the buoy-vs-satellite offset noted in docs/INTERFACE.md ("Aug 2026 mean
// -0.25C, -1.22 to +0.71").
import {
  computeIndices,
  computeTriggers,
  sha256Hex,
  type IndicesFile,
  type SeriesDay,
  type SeriesFile,
  type TriggersFile,
  type Zone,
} from '@repo/shared';
import type { Hex } from 'viem';
import { BANWEEKS_SEASON, fixtureBanweeksTriggers } from './banweeks';

const WINDOW_LEN = 92; // Jul 1 .. Sep 30 inclusive

/** Day 1 = Jul 1 of `year`. */
function dateForWindowDay(year: number, dayIndex: number): string {
  const d = new Date(Date.UTC(year, 6, 1));
  d.setUTCDate(d.getUTCDate() + (dayIndex - 1));
  return d.toISOString().slice(0, 10);
}

type Category = 'A' | 'B' | 'C' | 'D'; // A: >=26C, B: 25-26C, C: 24-25C, D: ambient

function tempFor(category: Category, dayIndex: number): number {
  const jitter = ((dayIndex * 37) % 10) / 10; // deterministic 0.0-0.9 wiggle, so the curve isn't flat
  if (category === 'A') return Number((26.1 + jitter * 0.8).toFixed(2));
  if (category === 'B') return Number((25.1 + jitter * 0.8).toFixed(2));
  if (category === 'C') return Number((24.1 + jitter * 0.8).toFixed(2));
  return Number((19.5 + jitter * 2.8).toFixed(2));
}

interface CategoryPlan {
  count: number;
  /** Window day-index (1 = Jul 1) this category's cumulative count must first reach `count` on, or
   * `null` if it never needs to cross a threshold this season. */
  last: number | null;
}

/** Places `count` distinct day-indices in [1, lastDay ?? season length], forcing `lastDay` in (when
 * given) so the category's cumulative count reaches `count` for the first time exactly on that day. */
function placeCategoryDays(count: number, lastDay: number | null, avoid: ReadonlySet<number>): number[] {
  if (count <= 0) return [];
  const chosen = new Set<number>();
  if (lastDay !== null) chosen.add(lastDay);
  const upperBound = lastDay ?? WINDOW_LEN;
  const pool: number[] = [];
  for (let d = 1; d <= upperBound; d++) {
    if (d !== lastDay && !avoid.has(d)) pool.push(d);
  }
  const need = count - chosen.size;
  const step = pool.length / Math.max(need, 1);
  for (let i = 0; i < need && pool.length > 0; i++) {
    const centre = Math.min(pool.length - 1, Math.round(i * step));
    let day: number | undefined;
    for (let radius = 0; radius < pool.length && day === undefined; radius++) {
      const hi = pool[centre + radius];
      const lo = pool[centre - radius];
      if (hi !== undefined && !chosen.has(hi)) day = hi;
      else if (lo !== undefined && !chosen.has(lo)) day = lo;
    }
    if (day !== undefined) chosen.add(day);
  }
  return [...chosen];
}

function buildKarakuwaSeason(year: number, plan: { A: CategoryPlan; B: CategoryPlan; C: CategoryPlan }): SeriesDay[] {
  const aDays = new Set(placeCategoryDays(plan.A.count, plan.A.last, new Set()));
  const bDays = new Set(placeCategoryDays(plan.B.count, plan.B.last, aDays));
  const cDays = new Set(placeCategoryDays(plan.C.count, plan.C.last, new Set([...aDays, ...bDays])));
  const days: SeriesDay[] = [];
  for (let i = 1; i <= WINDOW_LEN; i++) {
    const category: Category = aDays.has(i) ? 'A' : bDays.has(i) ? 'B' : cDays.has(i) ? 'C' : 'D';
    days.push({ date: dateForWindowDay(year, i), sst: tempFor(category, i) });
  }
  return days;
}

// Category-count plan per replay season, tuned to reproduce REFERENCE_FIRES exactly at the reference
// point (38.85N 141.66E). See docs/INTERFACE.md and packages/shared/src/rules.ts. Every A-day counts
// toward HEAT24/25/26, every B-day toward HEAT24/25, every C-day toward HEAT24 only, so the cumulative
// counts nest correctly (heat26 <= heat25 <= heat24).
const KARAKUWA_PLANS: Record<string, { A: CategoryPlan; B: CategoryPlan; C: CategoryPlan }> = {
  '2022': { A: { count: 0, last: null }, B: { count: 2, last: null }, C: { count: 8, last: null } },
  '2023': { A: { count: 12, last: 42 }, B: { count: 2, last: 43 }, C: { count: 16, last: 56 } }, // Aug 11/12/25
  '2024': { A: { count: 0, last: null }, B: { count: 0, last: null }, C: { count: 30, last: 77 } }, // Sep 15
  '2025': { A: { count: 0, last: null }, B: { count: 14, last: 59 }, C: { count: 16, last: 63 } }, // Aug 28, Sep 1
};

/** Kesennuma Bay sits nearer the coast; offset it cooler than the open-water reference point. */
const KESENNUMA_OFFSET_C = -0.4;

function buildKesennumaSeason(karakuwa: SeriesDay[]): SeriesDay[] {
  return karakuwa.map(({ date, sst }, i) => ({
    date,
    sst: sst === null ? null : Number((sst + KESENNUMA_OFFSET_C + (((i * 53) % 10) / 10 - 0.5) * 0.3).toFixed(2)),
  }));
}

function seriesDaysFor(zone: Zone, season: string): SeriesDay[] {
  const year = Number(season);
  const plan = KARAKUWA_PLANS[season] ?? KARAKUWA_PLANS['2022'];
  const karakuwa = buildKarakuwaSeason(year, plan!);
  return zone === 'karakuwa-east' ? karakuwa : buildKesennumaSeason(karakuwa);
}

const REFERENCE_POINT: Record<Zone, { lat: number; lon: number }> = {
  'karakuwa-east': { lat: 38.85, lon: 141.66 },
  'kesennuma-bay': { lat: 38.9, lon: 141.58 },
};

/** The exact ERDDAP `jplMURSST41` CSV text for `zone`/`season` — the "pinned" file #24 hashes and
 * re-derives indices from. Matches the shape `parseErddapCsv` (packages/shared) expects. */
export function fixtureCsvText(zone: Zone, season: string): string {
  const rows = seriesDaysFor(zone, season).map((d) => `${d.date}T09:00:00Z,${d.sst === null ? 'NaN' : d.sst}`);
  return ['time,analysed_sst', 'UTC,degree_C', ...rows].join('\n') + '\n';
}

function erddapUrl(season: string, point: { lat: number; lon: number }): string {
  return (
    `https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.csv?analysed_sst` +
    `[(${season}-07-01T09:00:00Z):1:(${season}-09-30T09:00:00Z)][(${point.lat}):1:(${point.lat})][(${point.lon}):1:(${point.lon})]`
  );
}

export async function fixtureSeries(zone: Zone, season: string): Promise<SeriesFile> {
  const point = REFERENCE_POINT[zone];
  const csv = fixtureCsvText(zone, season);
  const sha256 = await sha256Hex(csv);
  return {
    zone,
    season,
    source: { dataset: 'jplMURSST41', url: erddapUrl(season, point), sha256, fetchedAt: `${season}-10-01T00:00:00Z`, point },
    days: seriesDaysFor(zone, season),
  };
}

export function fixtureIndices(zone: Zone, season: string): IndicesFile {
  return { zone, season, days: computeIndices(seriesDaysFor(zone, season)) };
}

export async function fixtureTriggers(zone: Zone, season: string): Promise<TriggersFile> {
  // Season 2026 is the current (non-replay) season and its trigger is a BANWEEKS toxin-ban event (#28),
  // not an SST HEAT rule — the plans above have no HEAT data for it. Delegate to the real, pinned fixture.
  if (season === BANWEEKS_SEASON) return fixtureBanweeksTriggers(zone);

  const days = seriesDaysFor(zone, season);
  const csv = fixtureCsvText(zone, season);
  const dataHash = `0x${await sha256Hex(csv)}` as Hex;
  const year = Number(season);
  const deadline = BigInt(Math.floor(Date.UTC(year, 9, 31) / 1000)); // Oct 31 of the replay year
  return { zone, season, triggers: computeTriggers({ zone, days, dataHash, deadline }) };
}
