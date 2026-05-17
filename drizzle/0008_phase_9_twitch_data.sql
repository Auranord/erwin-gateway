CREATE TABLE IF NOT EXISTS "twitch_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twitch_user_id" text NOT NULL,
  "channel_id" uuid NOT NULL REFERENCES "twitch_channels"("id"),
  "user_login" text,
  "user_display_name" text,
  "tier" varchar(16),
  "is_gift" boolean DEFAULT false NOT NULL,
  "gifter_user_id" text,
  "gifter_login" text,
  "gifter_display_name" text,
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "last_event_type" text,
  "raw_payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "raw_event_id" uuid REFERENCES "twitch_eventsub_messages"("id"),
  "event_id" uuid REFERENCES "events"("id"),
  "last_synced_at" timestamp with time zone,
  "subscribed_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "twitch_subscriptions_channel_user_idx" ON "twitch_subscriptions" ("channel_id", "twitch_user_id");
CREATE INDEX IF NOT EXISTS "twitch_subscriptions_channel_status_idx" ON "twitch_subscriptions" ("channel_id", "status");
CREATE INDEX IF NOT EXISTS "twitch_subscriptions_updated_idx" ON "twitch_subscriptions" ("updated_at");

CREATE TABLE IF NOT EXISTS "subscription_backfill_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel_id" uuid NOT NULL REFERENCES "twitch_channels"("id"),
  "requested_by_app_id" uuid REFERENCES "apps"("id"),
  "status" varchar(32) DEFAULT 'running' NOT NULL,
  "subscriptions_seen" integer DEFAULT 0 NOT NULL,
  "cursor" text,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "subscription_backfill_runs_channel_started_idx" ON "subscription_backfill_runs" ("channel_id", "started_at");
CREATE INDEX IF NOT EXISTS "subscription_backfill_runs_status_idx" ON "subscription_backfill_runs" ("status");

CREATE TABLE IF NOT EXISTS "bits_leaderboard_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel_id" uuid NOT NULL REFERENCES "twitch_channels"("id"),
  "user_id" text NOT NULL,
  "user_login" text,
  "user_display_name" text,
  "rank" integer,
  "score" integer DEFAULT 0 NOT NULL,
  "period" varchar(32) DEFAULT 'all' NOT NULL,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "raw_payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "bits_leaderboard_entries_channel_user_period_idx" ON "bits_leaderboard_entries" ("channel_id", "user_id", "period");
CREATE INDEX IF NOT EXISTS "bits_leaderboard_entries_channel_score_idx" ON "bits_leaderboard_entries" ("channel_id", "score");
CREATE INDEX IF NOT EXISTS "bits_leaderboard_entries_synced_idx" ON "bits_leaderboard_entries" ("last_synced_at");

CREATE TABLE IF NOT EXISTS "bits_backfill_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel_id" uuid NOT NULL REFERENCES "twitch_channels"("id"),
  "requested_by_app_id" uuid REFERENCES "apps"("id"),
  "status" varchar(32) DEFAULT 'running' NOT NULL,
  "entries_seen" integer DEFAULT 0 NOT NULL,
  "period" varchar(32) DEFAULT 'all' NOT NULL,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "bits_backfill_runs_channel_started_idx" ON "bits_backfill_runs" ("channel_id", "started_at");
CREATE INDEX IF NOT EXISTS "bits_backfill_runs_status_idx" ON "bits_backfill_runs" ("status");
