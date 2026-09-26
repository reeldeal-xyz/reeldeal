#!/usr/bin/env bun
// `bun run db:migrate` (web workspace): applies web/drizzle/*.sql forward migrations for the `app`
// schema against DATABASE_URL. Run `bun run db:migrate:geo` (repo root, db/scripts/migrate.ts)
// first if the `geo` schema/tables this migration's FK depends on don't exist yet.
//
// postgres-js driver (see web/src/db/client.ts's header comment for why, not drizzle-orm/bun-sql).
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[db:migrate] DATABASE_URL is not set -- nothing to migrate.');
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);
await migrate(db, { migrationsFolder: './drizzle' });
await client.end();
console.log('[db:migrate] applied app/* migrations from ./drizzle');
process.exit(0);
