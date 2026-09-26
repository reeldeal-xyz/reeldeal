// Pure functions that turn a daily SST series into HEAT indices and fired triggers, per RULES in
// rules.ts. This is the reference implementation of the transform pipeline/src/indices.ts (owner: Jay,
// issue #6) is meant to perform — kept here, with tests, so:
//   - the web app can re-run the *exact same* computation client-side for issue #24 (recompute/verify)
//   - the pipeline can mirror (or eventually import) this instead of re-deriving the logic from scratch
// Nothing here changes the Trigger fields or feed shapes frozen in docs/INTERFACE.md.
import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import type { SeriesFile, IndicesFile, TriggersFile } from './feed';
import { HEAT_WINDOW, RULES, type Rule } from './rules';
import { idOf, type Zone } from './ids';
import type { Trigger } from './trigger';

export type SeriesDay = SeriesFile['days'][number];
export type IndicesDay = IndicesFile['days'][number];
// feed.ts (frozen interface contract) exports `TriggerJson` as a zod *value* (schema), not a type, and
// only the nested shape is available as a type (inside `TriggersFile`). Derive a local type alias for it
// instead of editing the contract file, and keep it unexported so it doesn't collide with the value
// export of the same name from feed.ts (both are re-exported via `export *` in index.ts).
type TriggerJsonShape = TriggersFile['triggers'][number]['trigger'];

/**
 * sha256 of arbitrary bytes or text, hex-encoded (no `0x` prefix — callers add it where a schema wants
 * one). Uses Web Crypto (`crypto.subtle`), available in browsers and in Bun/Node 19+, so this single
 * implementation works both client-side (#24's "computes sha256 in-browser" requirement) and anywhere
 * else in the stack (pipeline, tests) without pulling in `node:crypto`.
 */
export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parses the ERDDAP `jplMURSST41` CSV shape used by pipeline/src/fetch.ts: a column-name row, a units
 * row, then `time,value` data rows where `time` is an ISO instant (e.g. `2023-07-01T09:00:00Z`). Only
 * the date part is kept. Blank or `NaN` values become `null`, matching `SeriesFile.days[].sst`.
 */
export function parseErddapCsv(csv: string): SeriesDay[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const days: SeriesDay[] = [];
  for (const line of lines.slice(2)) {
    const [time, raw] = line.split(',');
    if (!time) continue;
    const date = time.trim().slice(0, 10);
    const value = raw?.trim();
    const parsed = value === undefined || value === '' || value.toLowerCase() === 'nan' ? null : Number(value);
    days.push({ date, sst: parsed === null || Number.isNaN(parsed) ? null : parsed });
  }
  return days;
}

const inHeatWindow = (date: string): boolean => {
  const monthDay = date.slice(5); // "MM-DD"
  return monthDay >= HEAT_WINDOW.start && monthDay <= HEAT_WINDOW.end;
};

/**
 * Cumulative HEAT24/25/26 day-counts inside the 07-01..09-30 window, per day (`days` must be sorted
 * ascending by date). `banWeeks` is left empty: toxin-ban episodes are transcribed separately (#22) and
 * are not derived from an SST series, so BANWEEKS rules never fire against a series-only input.
 */
export function computeIndices(days: SeriesDay[]): IndicesDay[] {
  let heat24 = 0;
  let heat25 = 0;
  let heat26 = 0;
  return days.map(({ date, sst }) => {
    if (inHeatWindow(date) && sst !== null) {
      if (sst >= 24) heat24 += 1;
      if (sst >= 25) heat25 += 1;
      if (sst >= 26) heat26 += 1;
    }
    return { date, heat24, heat25, heat26, banWeeks: {} };
  });
}

const metricFor = (rule: Rule, day: IndicesDay): number => {
  if (rule.peril === 'HEAT24') return day.heat24;
  if (rule.peril === 'HEAT25') return day.heat25;
  if (rule.peril === 'HEAT26') return day.heat26;
  return day.banWeeks[rule.species] ?? 0; // BANWEEKS
};

export interface FiredRule {
  rule: Rule;
  label: string; // "scallop:2" (species:tier)
  firedOn: string; // YYYY-MM-DD, first day the index reached rule.threshold
  index: number;
}

/**
 * Evaluates RULES against a day-by-day indices array (ascending date order) and returns, for each rule
 * that fired, the first date its index reached the threshold. This is the regression #6 must reproduce
 * exactly against `REFERENCE_FIRES`.
 */
export function evaluateRules(days: IndicesDay[], rules: readonly Rule[] = RULES): FiredRule[] {
  const fired: FiredRule[] = [];
  for (const rule of rules) {
    for (const day of days) {
      const value = metricFor(rule, day);
      if (value >= rule.threshold) {
        fired.push({ rule, label: `${rule.species}:${rule.tier}`, firedOn: day.date, index: value });
        break;
      }
    }
  }
  return fired;
}

function parseDateUTC(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y ?? 1970, (m ?? 1) - 1, d ?? 1];
}

const dateToUnixSeconds = (date: string): bigint => {
  const [y, m, d] = parseDateUTC(date);
  return BigInt(Math.floor(Date.UTC(y, m, d) / 1000));
};

/** The season slot every replay trigger pays, per docs/INTERFACE.md ("all paying the '2026' season slots"). */
export const PAYOUT_SEASON_LABEL = '2026';

/** The historical seasons the pipeline replays through the same "2026" payout slots (docs/INTERFACE.md). */
export const REPLAY_SEASONS = ['2022', '2023', '2024', '2025'] as const;
export type ReplaySeason = (typeof REPLAY_SEASONS)[number];

/**
 * Builds the runtime `Trigger` (bigint fields) for a fired rule. `windowStart`/`windowEnd` use the
 * rule's HEAT window in the *replay* season's year (when the data was measured); `seasonLabel` is the
 * season slot being *paid* — always `PAYOUT_SEASON_LABEL` unless overridden.
 */
export function buildTrigger(params: {
  zone: Zone;
  fired: FiredRule;
  dataHash: Hex;
  deadline: bigint;
  payoutSeasonLabel?: string;
}): Trigger {
  const { zone, fired, dataHash, deadline, payoutSeasonLabel = PAYOUT_SEASON_LABEL } = params;
  const year = fired.firedOn.slice(0, 4);
  const window = fired.rule.window;
  const windowStart = window ? dateToUnixSeconds(`${year}-${window.start}`) : dateToUnixSeconds(fired.firedOn);
  const windowEnd = window ? dateToUnixSeconds(`${year}-${window.end}`) : dateToUnixSeconds(fired.firedOn);
  return {
    zoneId: idOf(zone),
    speciesId: idOf(fired.rule.species),
    perilId: idOf(fired.rule.peril),
    tier: fired.rule.tier,
    seasonLabel: payoutSeasonLabel,
    windowStart,
    windowEnd,
    firedAt: dateToUnixSeconds(fired.firedOn),
    index: fired.index,
    threshold: fired.rule.threshold,
    dataHash,
    deadline,
  };
}

/** eventIdOf, but for a `Trigger` value directly (zoneId/speciesId/perilId are already keccak256 ids). */
export const eventIdOfTrigger = (t: Pick<Trigger, 'zoneId' | 'speciesId' | 'perilId' | 'tier' | 'seasonLabel'>): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint8' }, { type: 'string' }],
      [t.zoneId, t.speciesId, t.perilId, t.tier, t.seasonLabel],
    ),
  );

export const triggerToJson = (t: Trigger): TriggerJsonShape => ({
  zoneId: t.zoneId,
  speciesId: t.speciesId,
  perilId: t.perilId,
  tier: t.tier,
  seasonLabel: t.seasonLabel,
  windowStart: t.windowStart.toString(),
  windowEnd: t.windowEnd.toString(),
  firedAt: t.firedAt.toString(),
  index: t.index,
  threshold: t.threshold,
  dataHash: t.dataHash,
  deadline: t.deadline.toString(),
});

export const triggerFromJson = (j: TriggerJsonShape): Trigger => ({
  zoneId: j.zoneId as Hex,
  speciesId: j.speciesId as Hex,
  perilId: j.perilId as Hex,
  tier: j.tier,
  seasonLabel: j.seasonLabel,
  windowStart: BigInt(j.windowStart),
  windowEnd: BigInt(j.windowEnd),
  firedAt: BigInt(j.firedAt),
  index: j.index,
  threshold: j.threshold,
  dataHash: j.dataHash as Hex,
  deadline: BigInt(j.deadline),
});

/**
 * Ties it together into the exact `TriggersFile.triggers` shape (unsigned — no pipeline/keeper
 * signatures exist yet, see #6/#17).
 */
export function computeTriggers(params: {
  zone: Zone;
  days: SeriesDay[];
  dataHash: Hex;
  deadline: bigint;
  payoutSeasonLabel?: string;
  rules?: readonly Rule[];
}): TriggersFile['triggers'] {
  const indices = computeIndices(params.days);
  const fired = evaluateRules(indices, params.rules);
  return fired.map((f) => ({
    label: f.label,
    zone: params.zone,
    species: f.rule.species,
    peril: f.rule.peril,
    firedOn: f.firedOn,
    trigger: triggerToJson(
      buildTrigger({
        zone: params.zone,
        fired: f,
        dataHash: params.dataHash,
        deadline: params.deadline,
        payoutSeasonLabel: params.payoutSeasonLabel,
      }),
    ),
    signatures: [],
  }));
}
