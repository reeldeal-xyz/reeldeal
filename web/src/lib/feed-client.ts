// Typed client for the pipeline feed (docs/INTERFACE.md), with local-fixture fallback so #18/#24 render
// correctly whether or not pipeline/src/serve.ts (#3/#6, owner Jay) is actually running. Every response
// from the network is validated against the shared zod schemas before use — a malformed or partial
// response is treated the same as "unreachable" and falls back to fixtures. Server-side only (reads
// PIPELINE_FEED_URL via lib/env.ts); call this from Server Components / Route Handlers and pass the
// result down as props.
import { computeTriggers, IndicesFile, type ReplayTrigger, type Zone } from '@repo/shared';
import { fixtureBuoy, fixtureCsvText, fixtureSeries, type BuoyFixture, type SstSeries } from '@/fixtures';
import { BANWEEKS_SEASON, fixtureBanweeksTriggers } from '@/fixtures/banweeks';
import { computeHeatIndexDays, type HeatIndexDay } from './heat-indices';
import { env } from './env';

export type FeedSource = 'feed' | 'fixture';
export interface FeedResult<T> {
  data: T;
  source: FeedSource;
}

const FETCH_TIMEOUT_MS = 2500;

async function fetchJson(path: string): Promise<unknown> {
  const base = env.pipelineFeedUrl().replace(/\/$/, '');
  const res = await fetch(`${base}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`pipeline feed ${path} -> HTTP ${res.status}`);
  return res.json();
}

// The pipeline never serves a per-zone/season "SeriesFile" any more (Trigger v2, #55 -- see feed.ts's
// IndicesFile: module-scoped index series, not a raw SST file). getSeries keeps its name and shape for the
// rest of the app (fixtures, getCsv, getTriggers below all key off a zone/season's SST days + provenance),
// sourced from the fixture until the pipeline's `GET /heat/indices/:zone/:season` is live end to end.
export async function getSeries(zone: Zone, season: string): Promise<FeedResult<SstSeries>> {
  try {
    const parsed = IndicesFile.parse(await fetchJson(`/heat/indices/${zone}/${season}`));
    const sst = parsed.series.find((s) => s.index === 'SST');
    if (!sst) throw new Error(`heat indices for ${zone}/${season} has no SST series`);
    return { data: { zone, season, source: sst.source, days: sst.days }, source: 'feed' };
  } catch {
    return { data: await fixtureSeries(zone, season), source: 'fixture' };
  }
}

/** HEAT{tempC} day-counts (docs/INTERFACE.md), recomputed client-side from the zone/season's SST series --
 *  see lib/heat-indices.ts. Not fetched directly: the pipeline publishes the raw SST index only. */
export async function getIndices(zone: Zone, season: string): Promise<FeedResult<HeatIndexDay[]>> {
  const series = await getSeries(zone, season);
  return { data: computeHeatIndexDays(series.data.days), source: series.source };
}

// The pipeline never serves Triggers (docs/INTERFACE.md: index values only; thresholds/tiers/windows and
// Triggers are built app-side from RULES, Trigger v2 #55). getTriggers always computes them from the
// zone/season's SST series (whichever source that came from), except season 2026 -- the live, non-replay
// season -- whose trigger is a real, pinned BANWEEKS toxin-ban event (#32), not a computed HEAT fire.
export async function getTriggers(zone: Zone, season: string): Promise<FeedResult<ReplayTrigger[]>> {
  if (season === BANWEEKS_SEASON) {
    return { data: fixtureBanweeksTriggers(zone), source: 'fixture' };
  }
  const series = await getSeries(zone, season);
  const dataHash = `0x${series.data.source.sha256}` as `0x${string}`;
  const year = Number(season);
  const deadline = BigInt(Math.floor(Date.UTC(year, 9, 31) / 1000)); // Oct 31 of the replay year
  return { data: computeTriggers({ zone, days: series.data.days, dataHash, deadline }), source: series.source };
}

export async function getBuoy(month: string): Promise<FeedResult<BuoyFixture> | null> {
  // No pipeline endpoint replaces the old per-station BuoyFile fetch yet (feed.ts's StationSeries is a
  // single variable, not this fixture's richer buoy-vs-satellite comparison) -- fixture-only for now.
  const fixture = await fixtureBuoy(month);
  return fixture ? { data: fixture, source: 'fixture' } : null;
}

/**
 * The exact CSV bytes a `SstSeries.source` points at, for #24's in-browser sha256 + recompute. Fetched
 * server-side (no CORS concerns) when the feed is live; read from the bundled fixture text when not — a
 * fixture's `source.url` is a realistic ERDDAP URL for documentation, but its bytes never leave this
 * server unless the feed is actually up and serving real data.
 */
export async function getCsv(zone: Zone, season: string): Promise<{ text: string; source: FeedSource; url: string }> {
  const series = await getSeries(zone, season);
  const url = series.data.source.url ?? ''; // Source.url is optional (a transcribed/no-URL source has none)
  if (series.source === 'fixture' || !url) {
    return { text: fixtureCsvText(zone, season), source: 'fixture', url };
  }
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`csv fetch -> HTTP ${res.status}`);
    return { text: await res.text(), source: 'feed', url };
  } catch {
    return { text: fixtureCsvText(zone, season), source: 'fixture', url };
  }
}
