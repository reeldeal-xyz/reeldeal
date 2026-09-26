#!/usr/bin/env bun
// Tiny interim migration runner for db/migrations/ (dbmate-style `-- migrate:up` / `-- migrate:down`
// plain SQL files). #103 (DB: service scaffold — compose, extensions, roles, schemas, dbmate) will
// replace this with the real dbmate binary running as `db_migrator` inside `docker compose run --rm
// migrate up`; until that lands, this applies the same files with the single admin DATABASE_URL,
// using the same `public.schema_migrations(version text primary key)` bookkeeping table dbmate uses
// so a later `dbmate up` sees these versions as already applied instead of re-running (and colliding
// with) the CREATE TABLE statements.
//
// Usage: `bun db/scripts/migrate.ts` (reads DATABASE_URL from the environment; loads ../.env and the
// repo root .env if present so `bun run db:migrate:geo` works the same from any cwd).
import { SQL } from 'bun';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

function extractUpSection(sql: string): string {
  const upIdx = sql.indexOf('-- migrate:up');
  const downIdx = sql.indexOf('-- migrate:down');
  if (upIdx === -1) throw new Error('missing "-- migrate:up" marker');
  const end = downIdx === -1 ? sql.length : downIdx;
  return sql.slice(upIdx + '-- migrate:up'.length, end).trim();
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[db/migrate] DATABASE_URL is not set — nothing to do (this is expected for local/test runs without a DB).');
    process.exit(0);
  }

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    console.log('[db/migrate] no migration files found in', migrationsDir);
    return;
  }

  const sql = new SQL(url);
  try {
    await sql`CREATE TABLE IF NOT EXISTS public.schema_migrations (version text PRIMARY KEY)`;

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const already = await sql`SELECT 1 FROM public.schema_migrations WHERE version = ${version}`;
      if (already.length > 0) {
        console.log(`[db/migrate] ${file}: already applied, skipping`);
        continue;
      }

      const raw = await readFile(join(migrationsDir, file), 'utf8');
      const up = extractUpSection(raw);
      console.log(`[db/migrate] ${file}: applying...`);
      // .simple() runs the whole file as one simple-query batch (semicolon-separated statements,
      // no parameters) -- needed because the "up" section here has more than one statement.
      await sql.unsafe(up).simple();
      await sql`INSERT INTO public.schema_migrations (version) VALUES (${version})`;
      console.log(`[db/migrate] ${file}: applied`);
    }
  } finally {
    await sql.close();
  }
}

main().catch((err) => {
  console.error('[db/migrate] failed:', err);
  process.exit(1);
});
