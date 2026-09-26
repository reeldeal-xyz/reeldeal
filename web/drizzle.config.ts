import { defineConfig } from 'drizzle-kit';

// Application-owned `app` schema only (db/README.md §4.3, ADR 0004). `schemaFilter` keeps generate/
// introspect scoped to `app` so this never diffs or touches Jay's `geo`/`risk` schemas (dbmate,
// db/migrations/) even though app.plot_wallets has a hand-written FK into geo.plots (see schema.ts).
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['app'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/placeholder',
  },
});
