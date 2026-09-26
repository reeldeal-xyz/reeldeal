// Server-only accessor for the demo plot list (db/postgres-plots task). Kept out of plots.ts on
// purpose -- that file is imported by client components at module scope (see its header comment),
// and pulling the Postgres driver into that import graph breaks the browser bundle (Node built-ins
// like tls/net/perf_hooks don't exist there). Only import this file from Server Components or Route
// Handlers.
import { sql } from 'drizzle-orm';
import type { Species, Zone } from '@repo/shared';
import { getDb } from '../db/client';
import { DEMO_PLOTS, ZONE, type DemoPlot } from './plots';

export type { DemoPlot };

interface GeoPlotRow {
  plot_code: string;
  sea_area_id: string | null;
  species: string[] | string | null;
}

/** Best-effort parse of either a driver-parsed JS array or a raw Postgres array literal ('{scallop}'). */
function firstSpecies(value: GeoPlotRow['species']): Species {
  const raw = Array.isArray(value) ? value[0] : (value?.match(/[a-z_]+/)?.[0] ?? undefined);
  return raw === 'hoya' || raw === 'oyster' ? raw : 'scallop';
}

/** Server-only: the 15 demo plots from `geo.plots` (db/README.md §4.1) when DATABASE_URL is set, else
 *  the static `DEMO_PLOTS` list -- same fallback policy as payout-directory.ts/slot-request-store.ts. */
export async function getPlots(): Promise<readonly DemoPlot[]> {
  const db = getDb();
  if (!db) return DEMO_PLOTS;
  try {
    // Cast rather than pass GeoPlotRow as db.execute's generic: drizzle's HKT resolves that generic
    // through an `Assume<row, Record<string,any>[]>` check that a plain (non-array) row shape fails,
    // silently falling back to `Record<string, any>[]` and losing the specific type anyway.
    const rows = (await db.execute(
      sql`SELECT plot_code, sea_area_id, species FROM geo.plots WHERE retired_at IS NULL ORDER BY plot_code`,
    )) as unknown as GeoPlotRow[];
    if (rows.length === 0) return DEMO_PLOTS;
    return rows.map((row) => ({
      plotLabel: row.plot_code,
      zone: (row.sea_area_id as Zone | null) ?? ZONE,
      species: firstSpecies(row.species),
    }));
  } catch (err) {
    console.warn('[plots] failed to read geo.plots, falling back to static DEMO_PLOTS', err);
    return DEMO_PLOTS;
  }
}
