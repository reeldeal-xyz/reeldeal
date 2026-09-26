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
-- No FK to geo.plots: #114's geo.plots keeps plot_code unique only among live rows (partial index),
-- which can't back a foreign key. plot_id holds the ENS label; integrity is checked in application code.
