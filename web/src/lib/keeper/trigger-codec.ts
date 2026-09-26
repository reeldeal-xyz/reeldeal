// Trigger <-> wire-format conversions and the keeper's fallback trigger builder (issue #17).
//
// The feed (packages/shared/src/feed.ts TriggerJson) serializes bigint fields as decimal strings; the
// on-chain/EIP-712 Trigger (packages/shared/src/trigger.ts) wants real bigints. `triggerFromJson` bridges
// that. `buildFallbackTrigger` constructs a Trigger from a reference event when the pipeline feed
// (issue #9) is unreachable or its signature doesn't validate -- clearly logged as a fallback by the
// caller (web/src/lib/keeper/run.ts), never silently.
import { keccak256, toBytes, type Hex } from 'viem';
import { idOf, type Trigger, type TriggerJson } from '@repo/shared';
import { getReferenceEvent, ruleForReferenceEvent, type ReferenceEvent } from './reference-events';

export function triggerFromJson(json: TriggerJson): Trigger {
  return {
    zoneId: json.zoneId as Hex,
    speciesId: json.speciesId as Hex,
    perilId: json.perilId as Hex,
    tier: json.tier,
    seasonLabel: json.seasonLabel,
    windowStart: BigInt(json.windowStart),
    windowEnd: BigInt(json.windowEnd),
    firedAt: BigInt(json.firedAt),
    index: json.index,
    threshold: json.threshold,
    dataHash: json.dataHash as Hex,
    deadline: BigInt(json.deadline),
  };
}

function unixSecondsAt(dateIso: string): bigint {
  const ms = Date.parse(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`invalid date "${dateIso}"`);
  return BigInt(Math.floor(ms / 1000));
}

/** MM-DD (rule.window) in `year` as a unix-seconds boundary. `endExclusive` pushes to the day after, so a
 *  window like { start: '07-01', end: '09-30' } covers the whole of 30 September, not just its midnight. */
function windowBoundary(year: number, monthDay: string, endExclusive: boolean): bigint {
  const [month, day] = monthDay.split('-').map(Number);
  const base = Date.UTC(year, (month ?? 1) - 1, day ?? 1);
  const ms = endExclusive ? base + 24 * 60 * 60 * 1000 : base;
  return BigInt(Math.floor(ms / 1000));
}

export interface BuildFallbackTriggerOptions {
  /** Signature validity window from "now", in seconds. Default 1 hour -- long enough for the keeper to
   *  finish signing + attesting, short enough that a stale fallback trigger can't be replayed much later. */
  deadlineSeconds?: number;
  /** Injectable for tests; defaults to Date.now(). */
  now?: () => number;
}

/** Builds the Trigger the keeper would sign itself for a reference event, when the pipeline feed is down
 *  or fails validation. `index` is set equal to `threshold` -- the minimum value that still crosses it --
 *  since the keeper has no independent way to compute the real historical index (that's the pipeline's
 *  job, issue #9); `dataHash` is a clearly-fake marker, not a real pinned-CSV hash. Both are logged as
 *  fallback by the caller so a Sepolia demo never confuses this with a pipeline-signed trigger. */
export function buildFallbackTrigger(referenceEventId: string, opts: BuildFallbackTriggerOptions = {}): Trigger {
  const ref: ReferenceEvent = getReferenceEvent(referenceEventId);
  const rule = ruleForReferenceEvent(ref);
  const year = Number(ref.dataSeason);
  const now = opts.now ?? Date.now;
  const deadlineSeconds = opts.deadlineSeconds ?? 3600;

  const windowStart = rule.window ? windowBoundary(year, rule.window.start, false) : unixSecondsAt(`${ref.dataSeason}-01-01`);
  const windowEnd = rule.window ? windowBoundary(year, rule.window.end, true) : unixSecondsAt(`${ref.dataSeason}-12-31`);

  return {
    zoneId: idOf(ref.zone),
    speciesId: idOf(ref.species),
    perilId: idOf(ref.peril),
    tier: ref.tier,
    seasonLabel: ref.payoutSeasonLabel,
    windowStart,
    windowEnd,
    firedAt: unixSecondsAt(ref.firedOn),
    index: rule.threshold,
    threshold: rule.threshold,
    dataHash: keccak256(toBytes(`fallback:no-pinned-csv:${ref.id}`)),
    deadline: BigInt(Math.floor(now() / 1000) + deadlineSeconds),
  };
}
