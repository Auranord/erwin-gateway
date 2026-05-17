CREATE TABLE IF NOT EXISTS "twitch_eventsub_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twitch_subscription_id" text,
  "type" text NOT NULL,
  "version" varchar(16) NOT NULL,
  "condition_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "callback_url" text NOT NULL,
  "status" varchar(64) DEFAULT 'desired' NOT NULL,
  "transport_method" varchar(32) DEFAULT 'webhook' NOT NULL,
  "cost" integer,
  "last_synced_at" timestamp with time zone,
  "last_verified_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revoke_reason" text,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "twitch_eventsub_subscriptions_twitch_id_idx" ON "twitch_eventsub_subscriptions" ("twitch_subscription_id");
CREATE UNIQUE INDEX IF NOT EXISTS "twitch_eventsub_subscriptions_desired_idx" ON "twitch_eventsub_subscriptions" ("type", "version", "condition_json");
CREATE INDEX IF NOT EXISTS "twitch_eventsub_subscriptions_status_idx" ON "twitch_eventsub_subscriptions" ("status");

CREATE TABLE IF NOT EXISTS "twitch_eventsub_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" text NOT NULL,
  "message_type" varchar(64) NOT NULL,
  "subscription_type" text,
  "subscription_version" varchar(16),
  "twitch_subscription_id" text,
  "event_type" text,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "duplicate" boolean DEFAULT false NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "twitch_eventsub_messages_message_id_idx" ON "twitch_eventsub_messages" ("message_id");
CREATE INDEX IF NOT EXISTS "twitch_eventsub_messages_received_at_idx" ON "twitch_eventsub_messages" ("received_at");
CREATE INDEX IF NOT EXISTS "twitch_eventsub_messages_event_type_idx" ON "twitch_eventsub_messages" ("event_type");

CREATE TABLE IF NOT EXISTS "events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" varchar(64) NOT NULL,
  "type" text NOT NULL,
  "external_id" text,
  "channel_id" uuid REFERENCES "twitch_channels"("id"),
  "twitch_message_id" text,
  "twitch_subscription_id" text,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "events_external_id_source_idx" ON "events" ("source", "external_id");
CREATE INDEX IF NOT EXISTS "events_status_idx" ON "events" ("status");
CREATE INDEX IF NOT EXISTS "events_type_idx" ON "events" ("type");
CREATE INDEX IF NOT EXISTS "events_occurred_at_idx" ON "events" ("occurred_at");
