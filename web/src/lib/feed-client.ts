// Typed client for the pipeline feed (docs/INTERFACE.md), with local-fixture fallback so #18/#24 render
// correctly whether or not pipeline/src/serve.ts (#3/#6, owner Jay) is actually running. Every response
// from the network is validated against the shared zod schemas before use — a malformed or partial
// response is treated the same as "unreachable" and falls back to fixtures. Server-side only (reads
// PIPELINE_FEED_URL via lib/env.ts); call this from Server Components / Route Handlers and pass the
// result down as props.
import { BuoyFile, IndicesFile, SeriesFile, TriggersFile, type Zone } from '@repo/shared';
import { fixtureBuoy, fixtureCsvText, fixtureIndices, fixtureSeries, fixtureTriggers } from '@/fixtures';
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

export async function getSeries(zone: Zone, season: string): Promise<FeedResult<SeriesFile>> {
  try {
    return { data: SeriesFile.parse(await fetchJson(`/series/${zone}/${season}`)), source: 'feed' };
  } catch {
    return { data: await fixtureSeries(zone, season), source: 'fixture' };
  }
}

export async function getIndices(zone: Zone, season: string): Promise<FeedResult<IndicesFile>> {
  try {
    return { data: IndicesFile.parse(await fetchJson(`/indices/${zone}/${season}`)), source: 'feed' };
  } catch {
    return { data: fixtureIndices(zone, season), source: 'fixture' };
  }
}

export async function getTriggers(zone: Zone, season: string): Promise<FeedResult<TriggersFile>> {
  try {
    return { data: TriggersFile.parse(await fetchJson(`/triggers/${zone}/${season}`)), source: 'feed' };
  } catch {
    return { data: await fixtureTriggers(zone, season), source: 'fixture' };
  }
}

export async function getBuoy(month: string): Promise<FeedResult<BuoyFile> | null> {
  try {
    return { data: BuoyFile.parse(await fetchJson(`/buoy/${month}`)), source: 'feed' };
  } catch {
    const fixture = await fixtureBuoy(month);
    return fixture ? { data: fixture, source: 'fixture' } : null;
  }
}

/**
 * The exact CSV bytes a `SeriesFile.source` points at, for #24's in-browser sha256 + recompute. Fetched
 * server-side (no CORS concerns) when the feed is live; read from the bundled fixture text when not — a
 * fixture's `source.url` is a realistic ERDDAP URL for documentation, but its bytes never leave this
 * server unless the feed is actually up and serving real data.
 */
export async function getCsv(zone: Zone, season: string): Promise<{ text: string; source: FeedSource; url: string }> {
  const series = await getSeries(zone, season);
  if (series.source === 'fixture') {
    return { text: fixtureCsvText(zone, season), source: 'fixture', url: series.data.source.url };
  }
  try {
    const res = await fetch(series.data.source.url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`csv fetch -> HTTP ${res.status}`);
    return { text: await res.text(), source: 'feed', url: series.data.source.url };
  } catch {
    return { text: fixtureCsvText(zone, season), source: 'fixture', url: series.data.source.url };
  }
}
