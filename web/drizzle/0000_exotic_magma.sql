CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."plot_wallets" (
	"plot_id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."slot_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"plot_label" text NOT NULL,
	"farmer_address" text NOT NULL,
	"farmer_name" text,
	"line_user_id" text,
	"season_label" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."wallet_links" (
	"line_user_id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_links_wallet_idx" ON "app"."wallet_links" USING btree ("wallet");
--> statement-breakpoint
-- Hand-added (not drizzle-kit generated): app.plot_wallets.plot_id references geo.plots.plot_code
-- (db/README.md §4.3, ADR 0004 -- "app references canonical pipeline Plot/zone geometry, doesn't
-- copy it"). Not expressed as a Drizzle `.references()` builder because that would require declaring
-- a `geo.plots` table object in schema.ts, which would make drizzle-kit want to manage/diff a schema
-- it doesn't own. Requires db/migrations/20260926150000_bootstrap_geo.sql (or #104's real geo
-- migration) to have already run -- apply `bun run db:migrate:geo` before `bun run --filter web
-- db:migrate`.
ALTER TABLE "app"."plot_wallets" ADD CONSTRAINT "plot_wallets_plot_id_geo_plots_plot_code_fk"
  FOREIGN KEY ("plot_id") REFERENCES "geo"."plots"("plot_code") ON DELETE RESTRICT ON UPDATE CASCADE;