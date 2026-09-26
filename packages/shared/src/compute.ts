// Pure functions that turn a daily SST series into HEAT indices and fired triggers, per RULES in
// rules.ts. This is the reference implementation of the transform pipeline/src/indices.ts (owner: Jay,
// issue #6) is meant to perform — kept here, with tests, so:
//   - the web app can re-run the *exact same* computation client-side for issue #24 (recompute/verify)
//   - the pipeline can mirror (or eventually import) this instead of re-deriving the logic from scratch
// Nothing here changes the Trigger fields or feed shapes frozen in docs/INTERFACE.md.
//
// Trigger v2 (#55): HEAT24/25/26 collapsed into a single HEAT peril with a per-rule `tempC` (rules.ts).
// `heatDays`/`heatFiredOn` in rules.ts are now the canonical HEAT evaluators (they replace this file's old
// `computeIndices`); this file is the thin layer on top that builds and (de)serializes Triggers, including
// `tempC`. BANWEEKS rules are still never derived from an SST series (toxin bans are transcribed
// separately, #22) and are skipped by `evaluateRules`, matching the pre-v2 behavior.
import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import { RULES, heatDays, heatFiredOn, type Rule } from './rules';
import { idOf, type Zone } from './ids';
import type { Trigger, TriggerJson } from './trigger';

/** One day of an SST series: what `parseErddapCsv` produces and `heatDays`/`heatFiredOn` (rules.ts) consume. */
export interface SeriesDay {
  date: string;
  value: number | null;
}

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
 * the date part is kept. Blank or `NaN` values become `null`, matching `SeriesDay.value`.
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
    days.push({ date, value: parsed === null || Number.isNaN(parsed) ? null : parsed });
  }
  return days;
}

export interface FiredRule {
  rule: Rule;
  label: string; // "scallop:2" (species:tier)
  firedOn: string; // YYYY-MM-DD, first day the index reached rule.threshold
  index: number;
}

/**
 * Evaluates every HEAT rule in `rules` against a single daily SST series (via rules.ts's
 * `heatDays`/`heatFiredOn`, each rule bringing its own `tempC`) and returns, for each rule that fired, the
 * first date its index reached the threshold. This is the regression #6 must reproduce exactly against
 * `REFERENCE_FIRES`. BANWEEKS rules are never derived from an SST series and are skipped.
 */
export function evaluateRules(days: readonly SeriesDay[], rules: readonly Rule[] = RULES): FiredRule[] {
  const fired: FiredRule[] = [];
  for (const rule of rules) {
    if (rule.peril !== 'HEAT' || rule.tempC === undefined || !rule.window) continue;
    const firedOn = heatFiredOn(days, rule);
    if (firedOn === null) continue;
    const series = heatDays(days, rule.tempC, rule.window);
    const index = series.find((d) => d.date === firedOn)?.value ?? rule.threshold;
    fired.push({ rule, label: `${rule.species}:${rule.tier}`, firedOn, index });
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
 * season slot being *paid* — always `PAYOUT_SEASON_LABEL` unless overridden. `tempC` is copied from the
 * rule (0 for perils without a temperature, e.g. BANWEEKS, though `evaluateRules` never fires those here).
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
    tempC: fired.rule.tempC ?? 0,
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

export const triggerToJson = (t: Trigger): TriggerJson => ({
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
  tempC: t.tempC,
  dataHash: t.dataHash,
  deadline: t.deadline.toString(),
});

export const triggerFromJson = (j: TriggerJson): Trigger => ({
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
  tempC: j.tempC,
  dataHash: j.dataHash as Hex,
  deadline: BigInt(j.deadline),
});

/**
 * The app's own replay/demo trigger-list shape (unsigned — no pipeline/keeper signatures exist yet, see
 * #6/#17). Not the pipeline interchange format: feed.ts dropped `TriggersFile`/`BuoyFile` in Trigger v2
 * (#55) — see docs/INTERFACE.md's "Removed from the feed" note. This is purely a compute.ts/fixtures
 * convenience for the web app's replay + verify pages.
 */
export interface ReplayTrigger {
  label: string;
  zone: Zone;
  species: Rule['species'];
  peril: Rule['peril'];
  firedOn: string;
  trigger: TriggerJson;
  signatures: { signer: string; signature: string }[];
}

export function computeTriggers(params: {
  zone: Zone;
  days: SeriesDay[];
  dataHash: Hex;
  deadline: bigint;
  payoutSeasonLabel?: string;
  rules?: readonly Rule[];
}): ReplayTrigger[] {
  const fired = evaluateRules(params.days, params.rules);
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
