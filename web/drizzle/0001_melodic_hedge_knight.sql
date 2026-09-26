CREATE TABLE "app"."keeper_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"reference_event_id" text NOT NULL,
	"event_id" text NOT NULL,
	"status" text DEFAULT 'escalated' NOT NULL,
	"jev_decision" text,
	"jev_confidence" double precision,
	"jev_reason" text,
	"jev_probabilities" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."notification_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"kind" text NOT NULL,
	"pushed_at" timestamp with time zone DEFAULT now() NOT NULL
);
