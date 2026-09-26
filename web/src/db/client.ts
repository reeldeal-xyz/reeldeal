// Lazy, singleton `app` schema DB client. Every module that can be DB- or JSON-backed (payout
// directory, slot request store, plots) calls `getDb()` and falls back to its JSON-file/static
// implementation when it returns null -- see each module's header comment for why (issue: this
// task, "keep the current JSON-file implementation so nothing breaks" when DATABASE_URL is unset,
// e.g. in tests or local dev without a DB).
//
// Driver: `drizzle-orm/postgres-js` (the `postgres` package), not `drizzle-orm/bun-sql`. The bun-sql
// driver imports Bun's built-in `bun:` module graph, which breaks `next build`'s page-data collection
// -- that phase runs route modules in a plain Node worker (via `next/dist/compiled/jest-worker`), not
// under `bun`, even though `next build` itself is invoked with `bun run`. postgres-js has no such
// runtime dependency and works the same under both.
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let cached: Db | null | undefined;

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Returns the shared Drizzle client, or null when DATABASE_URL isn't set (JSON-file fallback). */
export function getDb(): Db | null {
  if (cached !== undefined) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    cached = null;
    return cached;
  }
  cached = drizzle(postgres(url), { schema });
  return cached;
}

/** Test-only: drop the cached client so a test can flip DATABASE_URL and re-resolve it. */
export function _resetDbClientForTests(): void {
  cached = undefined;
}
