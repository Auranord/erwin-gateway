CREATE TABLE IF NOT EXISTS "twitch_channel_point_rewards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twitch_reward_id" text NOT NULL,
  "channel_id" uuid NOT NULL REFERENCES "twitch_channels"("id"),
  "owning_app_id" uuid REFERENCES "apps"("id"),
  "app_ownership_key" text,
  "title" text NOT NULL,
  "cost" integer NOT NULL,
  "prompt" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "manageable" boolean DEFAULT false NOT NULL,
  "background_color" text,
  "is_user_input_required" boolean DEFAULT false NOT NULL,
  "limits_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "raw_payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "twitch_channel_point_rewards_twitch_id_idx" ON "twitch_channel_point_rewards" ("twitch_reward_id");
CREATE INDEX IF NOT EXISTS "twitch_channel_point_rewards_channel_idx" ON "twitch_channel_point_rewards" ("channel_id");
CREATE INDEX IF NOT EXISTS "twitch_channel_point_rewards_owning_app_idx" ON "twitch_channel_point_rewards" ("owning_app_id");
CREATE INDEX IF NOT EXISTS "twitch_channel_point_rewards_deleted_idx" ON "twitch_channel_point_rewards" ("deleted_at");

CREATE TABLE IF NOT EXISTS "twitch_channel_point_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twitch_redemption_id" text NOT NULL,
  "channel_id" uuid NOT NULL REFERENCES "twitch_channels"("id"),
  "reward_id" uuid REFERENCES "twitch_channel_point_rewards"("id"),
  "twitch_reward_id" text NOT NULL,
  "user_id" text,
  "user_login" text,
  "user_display_name" text,
  "status" varchar(32) NOT NULL,
  "user_input" text,
  "redeemed_at" timestamp with time zone NOT NULL,
  "fulfilled_at" timestamp with time zone,
  "canceled_at" timestamp with time zone,
  "raw_payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "raw_event_id" uuid REFERENCES "twitch_eventsub_messages"("id"),
  "event_id" uuid REFERENCES "events"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "twitch_channel_point_redemptions_twitch_id_idx" ON "twitch_channel_point_redemptions" ("twitch_redemption_id");
CREATE INDEX IF NOT EXISTS "twitch_channel_point_redemptions_reward_idx" ON "twitch_channel_point_redemptions" ("reward_id");
CREATE INDEX IF NOT EXISTS "twitch_channel_point_redemptions_channel_idx" ON "twitch_channel_point_redemptions" ("channel_id", "redeemed_at");
CREATE INDEX IF NOT EXISTS "twitch_channel_point_redemptions_status_idx" ON "twitch_channel_point_redemptions" ("status");

CREATE TABLE IF NOT EXISTS "app_channel_point_reward_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "apps"("id"),
  "reward_id" uuid NOT NULL REFERENCES "twitch_channel_point_rewards"("id"),
  "permission" varchar(32) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "app_channel_point_reward_bindings_app_reward_idx" ON "app_channel_point_reward_bindings" ("app_id", "reward_id");
CREATE INDEX IF NOT EXISTS "app_channel_point_reward_bindings_reward_idx" ON "app_channel_point_reward_bindings" ("reward_id");

CREATE TABLE IF NOT EXISTS "reward_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel_id" uuid NOT NULL REFERENCES "twitch_channels"("id"),
  "requested_by_app_id" uuid REFERENCES "apps"("id"),
  "status" varchar(32) DEFAULT 'running' NOT NULL,
  "rewards_seen" integer DEFAULT 0 NOT NULL,
  "rewards_created" integer DEFAULT 0 NOT NULL,
  "rewards_updated" integer DEFAULT 0 NOT NULL,
  "rewards_missing_ownership" integer DEFAULT 0 NOT NULL,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "reward_sync_runs_channel_started_idx" ON "reward_sync_runs" ("channel_id", "started_at");
CREATE INDEX IF NOT EXISTS "reward_sync_runs_status_idx" ON "reward_sync_runs" ("status");
