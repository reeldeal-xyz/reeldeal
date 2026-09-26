// Application-owned tables (db/README.md §4.3, issue #62): Drizzle owns DDL for the `app` schema
// only. `geo` (plots, sea_areas, ...) is Jay's, migrated with dbmate (db/migrations/) -- this file
// must never define or migrate anything outside `app` (see drizzle.config.ts's `schemaFilter`).
//
// `app.plot_wallets.plot_id` references `geo.plots.plot_code` (db/README.md §4.3: "one writable
// copy of geography"), but that FK is added by hand in the generated migration SQL rather than
// through a Drizzle `.references()` builder -- declaring a `geoPlots` table object here would make
// drizzle-kit want to manage (and diff) `geo.plots` too, which this schema must never own. See the
// comment at the top of web/drizzle/*_app_schema.sql for the exact ALTER TABLE that adds it.
import { pgSchema, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const app = pgSchema('app');

export const slotRequestStatus = ['pending', 'issued', 'revoked'] as const;

// Replaces web/src/lib/slot-request-store.ts's in-memory/JSON-mirrored store.
export const slotRequests = app.table('slot_requests', {
  // Kept as free-form text (not a native uuid column): existing seed rows use ids like 'seed-1',
  // and the JSON-backed store's ids are `randomUUID()` strings -- both must round-trip unchanged.
  id: text('id').primaryKey(),
  plotLabel: text('plot_label').notNull(),
  farmerAddress: text('farmer_address').notNull(),
  farmerName: text('farmer_name'),
  lineUserId: text('line_user_id'),
  seasonLabel: text('season_label').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status', { enum: slotRequestStatus }).notNull().default('pending'),
});

// Replaces web/src/lib/payout-directory.ts's `walletLine` map + bindWalletToLineUser/pinWalletForLineUser.
// Both columns unique: one wallet per LINE user (pinWalletForLineUser's invariant) and one LINE user
// per wallet (a wallet is only ever bound once).
export const walletLinks = app.table(
  'wallet_links',
  {
    lineUserId: text('line_user_id').primaryKey(),
    wallet: text('wallet').notNull(), // stored lowercased, matching the JSON store's normalizeWallet
    pinnedAt: timestamp('pinned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wallet_links_wallet_idx').on(t.wallet)],
);

// Replaces web/src/lib/payout-directory.ts's `plotWallet` map (recordPlotWallet). One current payout
// wallet per plot; `updated_at` tracks the keeper's last attest+settle write.
export const plotWallets = app.table('plot_wallets', {
  // References geo.plots.plot_code -- no FK: #114 keeps plot_code unique only among live rows, so it cannot back a foreign key.
  plotId: text('plot_id').primaryKey(),
  wallet: text('wallet').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SlotRequestStatus = (typeof slotRequestStatus)[number];
