// Application-owned tables (db/README.md §4.3, issue #62): Drizzle owns DDL for the `app` schema
// only. `geo` (plots, sea_areas, ...) is Jay's, migrated with dbmate (db/migrations/) -- this file
// must never define or migrate anything outside `app` (see drizzle.config.ts's `schemaFilter`).
//
// `app.plot_wallets.plot_id` references `geo.plots.plot_code` (db/README.md §4.3: "one writable
// copy of geography"), but that FK is added by hand in the generated migration SQL rather than
// through a Drizzle `.references()` builder -- declaring a `geoPlots` table object here would make
// drizzle-kit want to manage (and diff) `geo.plots` too, which this schema must never own. See the
// comment at the top of web/drizzle/*_app_schema.sql for the exact ALTER TABLE that adds it.
import { doublePrecision, integer, jsonb, pgSchema, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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

// Durable LINE push de-dup (sponsor-polish task): the same on-chain Paid/Held event must never push
// twice across restarts/webhook replays. Keyed by the chain event id `${txHash}:${logIndex}` -- a
// single log entry can only ever be delivered/processed once, so a PK on that composite id is the
// dedup itself (an `onConflictDoNothing` insert either claims the push or tells the caller someone
// already did). Written by both the keeper (web/src/lib/keeper/run.ts) and the MultiBaas webhook
// (web/src/app/api/multibaas/webhook/route.ts) via web/src/lib/notification-log.ts.
export const notificationLog = app.table('notification_log', {
  id: text('id').primaryKey(), // `${txHash}:${logIndex}`
  txHash: text('tx_hash').notNull(),
  logIndex: integer('log_index').notNull(),
  kind: text('kind').notNull(), // 'Paid' | 'Held'
  pushedAt: timestamp('pushed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const keeperRunStatus = ['escalated', 'resolved'] as const;
export type KeeperRunStatus = (typeof keeperRunStatus)[number];

// Escalated keeper runs (docs/JEV.md attest gate): persisted so the co-op screen's "Needs co-op
// review" card survives restarts. Only runs the Jev gate actually held for review are written here
// (see web/src/lib/keeper-runs.ts) -- a clean attest never creates a row. `resolvedAt` is set once the
// co-op approves and force-replays the event (POST /api/coop/approve-attest).
export const keeperRuns = app.table('keeper_runs', {
  id: text('id').primaryKey(), // randomUUID
  referenceEventId: text('reference_event_id').notNull(),
  eventId: text('event_id').notNull(),
  status: text('status', { enum: keeperRunStatus }).notNull().default('escalated'),
  jevDecision: text('jev_decision'),
  jevConfidence: doublePrecision('jev_confidence'),
  jevReason: text('jev_reason'),
  jevProbabilities: jsonb('jev_probabilities').$type<Record<string, number> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});
