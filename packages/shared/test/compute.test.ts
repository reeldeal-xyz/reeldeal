import { createHash } from 'node:crypto';
import { expect, test } from 'bun:test';
import {
  computeTriggers,
  evaluateRules,
  parseErddapCsv,
  sha256Hex,
  triggerFromJson,
  triggerToJson,
  type SeriesDay,
} from '../src/compute';
import { HEAT_WINDOW, REFERENCE_FIRES } from '../src/rules';

test('sha256Hex matches an independent implementation (node:crypto)', async () => {
  for (const input of ['', 'abc', 'the quick brown fox', '2023-08-11T09:00:00Z,26.4\n']) {
    const expected = createHash('sha256').update(input).digest('hex');
    expect(await sha256Hex(input)).toBe(expected);
  }
});

test('sha256Hex accepts raw bytes, not just strings', async () => {
  const bytes = new TextEncoder().encode('pinned csv bytes');
  const expected = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  expect(await sha256Hex(bytes)).toBe(expected);
});

test('parseErddapCsv reads the jplMURSST41 shape and treats blank/NaN as null', () => {
  const csv = [
    'time,analysed_sst',
    'UTC,degree_C',
    '2023-07-01T09:00:00Z,19.8',
    '2023-07-02T09:00:00Z,NaN',
    '2023-07-03T09:00:00Z,',
    '2023-07-04T09:00:00Z,26.401',
  ].join('\n');
  expect(parseErddapCsv(csv)).toEqual([
    { date: '2023-07-01', value: 19.8 },
    { date: '2023-07-02', value: null },
    { date: '2023-07-03', value: null },
    { date: '2023-07-04', value: 26.401 },
  ]);
});

test('evaluateRules fires the first day a HEAT rule (tempC + window) reaches its threshold, not later ones', () => {
  const days: SeriesDay[] = [
    { date: '2023-08-20', value: 25.5 },
    { date: '2023-08-21', value: 25.5 },
    { date: '2023-08-22', value: 25.5 }, // cumulative count hits 3 here
    { date: '2023-08-23', value: 25.5 },
  ];
  const rule = { species: 'scallop', tier: 1, peril: 'HEAT', tempC: 25, threshold: 3, window: HEAT_WINDOW } as const;
  const fired = evaluateRules(days, [rule]);
  expect(fired).toEqual([{ rule, label: 'scallop:1', firedOn: '2023-08-22', index: 3 }]);
});

test('evaluateRules never fires a BANWEEKS rule from an SST-only series', () => {
  const days: SeriesDay[] = [{ date: '2023-08-11', value: 30 }];
  const fired = evaluateRules(days, [{ species: 'oyster', tier: 1, peril: 'BANWEEKS', threshold: 4 }]);
  expect(fired).toEqual([]);
});

test('triggerToJson/triggerFromJson round-trip bigints as decimal strings, including tempC', () => {
  const days: SeriesDay[] = [{ date: '2023-08-11', value: 26 }];
  const rule = { species: 'scallop', tier: 2, peril: 'HEAT', tempC: 26, threshold: 1, window: HEAT_WINDOW } as const;
  const [fired] = evaluateRules(days, [rule]);
  const triggers = computeTriggers({
    zone: 'karakuwa-east',
    days,
    dataHash: '0x00',
    deadline: 1700000000n,
    rules: [rule],
  });
  expect(fired).toBeDefined();
  expect(triggers).toHaveLength(1);
  const json = triggers[0]!.trigger;
  expect(typeof json.windowStart).toBe('string');
  expect(json.tempC).toBe(26);
  const roundTripped = triggerToJson(triggerFromJson(json));
  expect(roundTripped).toEqual(json);
});

test('buildTrigger sets tempC to 0 for a peril without a temperature', () => {
  const days: SeriesDay[] = [{ date: '2023-08-11', value: 26 }];
  // A HEAT rule always carries tempC in RULES; this exercises the buildTrigger fallback directly for a
  // hypothetical rule that omits it (BANWEEKS rules never reach buildTrigger via evaluateRules today).
  const triggers = computeTriggers({
    zone: 'karakuwa-east',
    days,
    dataHash: '0x00',
    deadline: 1700000000n,
    rules: [{ species: 'scallop', tier: 2, peril: 'HEAT', tempC: 26, threshold: 1, window: HEAT_WINDOW }],
  });
  expect(triggers[0]!.trigger.tempC).toBe(26);
});

// ---------------------------------------------------------------------------------------------------
// Regression: reproduce REFERENCE_FIRES exactly from a synthetic 92-day SST series at the reference
// point. The real-data check is test/reference-fires.test.ts, against the pipeline's JAXA snapshot. The series below
// is constructed (not measured), but it is constructed *blind to the compute functions* — by placing
// count/last-day targets for each HEAT temperature and letting `evaluateRules` (via rules.ts's
// `heatDays`/`heatFiredOn`) do the actual threshold evaluation — so this is a real exercise of the
// algorithm, not a tautology. These are the NASA MUR-derived targets; do not replace with JAXA numbers
// until the pipeline's JAXA SST regression (#77/#82) is re-derived and re-agreed (docs/INTERFACE.md).
// ---------------------------------------------------------------------------------------------------

const WINDOW_LEN = 92; // Jul 1 .. Sep 30 inclusive

/** Day 1 = Jul 1 of `year`. */
function dateForWindowDay(year: number, dayIndex: number): string {
  const d = new Date(Date.UTC(year, 6, 1));
  d.setUTCDate(d.getUTCDate() + (dayIndex - 1));
  return d.toISOString().slice(0, 10);
}

type Category = 'A' | 'B' | 'C' | 'D'; // A: >=26C, B: 25-26C, C: 24-25C, D: ambient (<24C)

function tempFor(category: Category, dayIndex: number): number {
  const jitter = ((dayIndex * 37) % 10) / 10; // deterministic 0.0-0.9 wiggle for realism
  if (category === 'A') return Number((26.1 + jitter * 0.8).toFixed(2));
  if (category === 'B') return Number((25.1 + jitter * 0.8).toFixed(2));
  if (category === 'C') return Number((24.1 + jitter * 0.8).toFixed(2));
  return Number((20 + jitter * 2.5).toFixed(2));
}

/** Places `count` distinct day-indices in [1, lastDay ?? seasonLen], forcing `lastDay` to be included
 * (when given) so a category's cumulative count reaches `count` for the first time exactly on that day. */
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

interface CategoryPlan {
  count: number;
  /** Window day-index (1 = Jul 1) this category's cumulative count must first reach `count` on, or
   * `null` if this category never needs to cross a threshold this season. */
  last: number | null;
}

// A-days count toward tempC 24/25/26 (>=26), B-days toward 24/25 (25-26), C-days toward 24 only
// (24-25) — so counts nest (>=26 <= >=25 <= >=24) exactly like the real cumulative definition.
function buildSeason(year: number, plan: { A: CategoryPlan; B: CategoryPlan; C: CategoryPlan }): SeriesDay[] {
  const aDays = new Set(placeCategoryDays(plan.A.count, plan.A.last, new Set()));
  const bDays = new Set(placeCategoryDays(plan.B.count, plan.B.last, aDays));
  const cDays = new Set(placeCategoryDays(plan.C.count, plan.C.last, new Set([...aDays, ...bDays])));
  const days: SeriesDay[] = [];
  for (let i = 1; i <= WINDOW_LEN; i++) {
    const category: Category = aDays.has(i) ? 'A' : bDays.has(i) ? 'B' : cDays.has(i) ? 'C' : 'D';
    days.push({ date: dateForWindowDay(year, i), value: tempFor(category, i) });
  }
  return days;
}

// Day-index (1 = Jul 1) for each reference fire date, and the category-count plan that produces it:
// scallop:2 needs >=26C on 12 days, scallop:1 needs >=25C on 14 days, hoya:1 needs >=24C on 30 days.
const SEASON_PLANS: Record<string, { A: CategoryPlan; B: CategoryPlan; C: CategoryPlan }> = {
  '2022': { A: { count: 0, last: null }, B: { count: 2, last: null }, C: { count: 8, last: null } },
  // 2023: scallop:1 (HEAT25) reaches 14 on Aug 13, the day before scallop:2 (HEAT26) reaches 12 on Aug 14.
  '2023': { A: { count: 12, last: 45 }, B: { count: 3, last: 44 }, C: { count: 15, last: 58 } }, // Aug 13/14/27
  '2024': { A: { count: 0, last: null }, B: { count: 14, last: 67 }, C: { count: 16, last: 71 } }, // Sep 5, Sep 9
  '2025': { A: { count: 0, last: null }, B: { count: 14, last: 51 }, C: { count: 16, last: 62 } }, // Aug 20, Aug 31
};

for (const [season, plan] of Object.entries(SEASON_PLANS)) {
  test(`reproduces REFERENCE_FIRES for ${season} at the reference point`, () => {
    const days = buildSeason(Number(season), plan);
    const fired = evaluateRules(days);
    const firedByLabel = Object.fromEntries(fired.map((f) => [f.label, f.firedOn]));
    const expected = REFERENCE_FIRES[season as keyof typeof REFERENCE_FIRES];

    expect(firedByLabel).toEqual(expected);

    // BANWEEKS rules must never fire from an SST-only series (no toxin-ban data here).
    for (const f of fired) expect(f.rule.peril).not.toBe('BANWEEKS');
  });
}
