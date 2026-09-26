// Data-work for issue #28. Reads the transcribed shellfish-toxin weekly series in
// pipeline/data/toxin/scallop-ban-2026.json (verified against the pinned PDFs in the same
// directory; see pipeline/data/toxin/sources.json for the cited URLs) and turns it into
// unsigned BANWEEKS Trigger objects matching @repo/shared's Trigger shape and RULES threshold.
//
// This intentionally stops at "unsigned trigger, matches TriggersFile" - signing is #9's job
// (sign.ts) and full IndicesFile/season-long banWeeks-per-day production is #6's job
// (indices.ts, which also needs the SST series from #3). When #6 lands, its indices.ts should
// merge BANWEEKS entries into out/triggers-<zone>-<season>.json rather than clobber this output.
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Hex } from 'viem';
import { idOf, RULES, type Zone, type Species } from '@repo/shared';
import type { Trigger, TriggersFile } from '@repo/shared';

/** The per-trigger JSON shape inside TriggersFile (bigints as decimal strings). */
type TriggerJsonT = TriggersFile['triggers'][number]['trigger'];

export interface WeeklyBanRecord {
  /** YYYY-MM-DD, the date of that week's test. */
  date: string;
  restricted: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const toEpochSeconds = (isoDate: string): bigint => BigInt(Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 1000));

/**
 * Build the weekly test series from the first over-threshold test (banStart) through the
 * lift date (banLift), inclusive of both ends. Every week strictly between them is inferred
 * "restricted": the source table only prints a row when the status changes, so an unbroken
 * run of unprinted weeks between two "still restricted" rows means every one of those weeks
 * tested restricted too (see pipeline/data/toxin/scallop-ban-2026.json unprintedWeeksMethod).
 */
export function buildWeeklySeries(banStart: string, banLift: string): WeeklyBanRecord[] {
  const start = Date.parse(`${banStart}T00:00:00Z`);
  const lift = Date.parse(`${banLift}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(lift) || lift <= start) {
    throw new Error(`banweeks: invalid range ${banStart}..${banLift}`);
  }
  const series: WeeklyBanRecord[] = [];
  for (let t = start; t < lift; t += 7 * DAY_MS) {
    series.push({ date: new Date(t).toISOString().slice(0, 10), restricted: true });
  }
  series.push({ date: banLift, restricted: false });
  return series;
}

/** Cumulative consecutive-restricted-week count as of each entry; resets to 0 once lifted. */
export function banweeksIndex(series: readonly WeeklyBanRecord[]): { date: string; index: number }[] {
  let running = 0;
  return series.map((entry) => {
    running = entry.restricted ? running + 1 : 0;
    return { date: entry.date, index: running };
  });
}

/** First date the cumulative index reaches (or exceeds) the threshold, if any. */
export function findFireEntry(
  series: readonly WeeklyBanRecord[],
  threshold: number,
): { date: string; index: number } | undefined {
  return banweeksIndex(series).find((e) => e.index >= threshold);
}

export interface BanweeksTriggerInput {
  zone: Zone;
  species: Species;
  season: string;
  banStart: string;
  banLift: string;
  dataHash: Hex;
  /** Signature validity window in days from the fire date. Placeholder pending #9 (signing). */
  deadlineDays?: number;
}

/** RULES-driven: looks up the BANWEEKS rule for the species and applies its threshold. */
export function buildBanweeksTrigger(
  input: BanweeksTriggerInput,
): { trigger: Trigger; firedOn: string; index: number } | undefined {
  const rule = RULES.find((r) => r.peril === 'BANWEEKS' && r.species === input.species && r.tier === 1);
  if (!rule) throw new Error(`banweeks: no BANWEEKS rule for species ${input.species} in RULES`);
  const series = buildWeeklySeries(input.banStart, input.banLift);
  const fired = findFireEntry(series, rule.threshold);
  if (!fired) return undefined;

  const firedAt = toEpochSeconds(fired.date);
  const trigger: Trigger = {
    zoneId: idOf(input.zone),
    speciesId: idOf(input.species),
    perilId: idOf('BANWEEKS'),
    tier: rule.tier,
    seasonLabel: input.season,
    windowStart: toEpochSeconds(input.banStart),
    windowEnd: firedAt,
    firedAt,
    index: fired.index,
    threshold: rule.threshold,
    dataHash: input.dataHash,
    deadline: firedAt + BigInt((input.deadlineDays ?? 90) * 24 * 60 * 60),
  };
  return { trigger, firedOn: fired.date, index: fired.index };
}

export function triggerToJson(t: Trigger): TriggerJsonT {
  return {
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
  };
}

/** sha256 of the exact pinned source bytes the trigger's dataHash should reference. */
export function sha256Hex(bytes: Uint8Array): Hex {
  return `0x${createHash('sha256').update(bytes).digest('hex')}`;
}

export interface ToxinZoneData {
  officialZoneName: string;
  banStart: string;
  banLift: string;
  restrictedWeeks: string[];
}

export interface ToxinSourceData {
  species: Species;
  source: { file: string; url: string; sha256: string };
  zones: Record<string, ToxinZoneData>;
}

/** Assembles a TriggersFile entry for one zone from the transcribed toxin data. */
export function buildZoneTriggersFile(
  zone: Zone,
  season: string,
  toxin: ToxinSourceData,
  dataHash: Hex,
): TriggersFile {
  const zoneData = toxin.zones[zone];
  if (!zoneData) throw new Error(`banweeks: no toxin data for zone ${zone}`);
  const built = buildBanweeksTrigger({
    zone,
    species: toxin.species,
    season,
    banStart: zoneData.banStart,
    banLift: zoneData.banLift,
    dataHash,
  });
  if (!built) {
    return { zone, season, triggers: [] };
  }
  return {
    zone,
    season,
    triggers: [
      {
        label: `${toxin.species}:${built.trigger.tier}`,
        zone,
        species: toxin.species,
        peril: 'BANWEEKS',
        firedOn: built.firedOn,
        trigger: triggerToJson(built.trigger),
        signatures: [], // unsigned; #9 (sign.ts) adds { signer, signature } after this.
      },
    ],
  };
}

if (import.meta.main) {
  const dataDir = new URL('../data/toxin/', import.meta.url);
  const outDir = new URL('../out/', import.meta.url);
  const toxin: ToxinSourceData = await Bun.file(new URL('scallop-ban-2026.json', dataDir)).json();
  const pdfFileName = toxin.source.file.replace(/^pipeline\/data\/toxin\//, '');
  const pdfBytes = new Uint8Array(await Bun.file(new URL(pdfFileName, dataDir)).arrayBuffer());
  const dataHash = sha256Hex(pdfBytes);
  if (dataHash.slice(2) !== toxin.source.sha256) {
    throw new Error(`banweeks: pinned PDF sha256 mismatch (recorded ${toxin.source.sha256}, computed ${dataHash.slice(2)})`);
  }
  await mkdir(fileURLToPath(outDir), { recursive: true });
  for (const zone of Object.keys(toxin.zones) as Zone[]) {
    const file = buildZoneTriggersFile(zone, '2026', toxin, dataHash);
    await Bun.write(new URL(`triggers-${zone}-2026.json`, outDir), JSON.stringify(file, null, 2));
    console.log(`wrote out/triggers-${zone}-2026.json (${file.triggers.length} trigger(s))`);
  }
}
