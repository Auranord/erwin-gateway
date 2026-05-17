ALTER TABLE "app_webhook_endpoints" ADD COLUMN IF NOT EXISTS "signing_secret" text;

CREATE TABLE IF NOT EXISTS "twitch_chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "twitch_message_id" text NOT NULL,
  "channel_id" uuid REFERENCES "twitch_channels"("id"),
  "chatter_user_id" text,
  "chatter_login" text,
  "chatter_display_name" text,
  "text" text NOT NULL,
  "fragments_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "badges_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "color" text,
  "is_broadcaster" boolean DEFAULT false NOT NULL,
  "is_mod" boolean DEFAULT false NOT NULL,
  "is_vip" boolean DEFAULT false NOT NULL,
  "is_subscriber" boolean DEFAULT false NOT NULL,
  "is_command" boolean DEFAULT false NOT NULL,
  "command_symbol" varchar(8),
  "command_name" text,
  "command_args_text" text,
  "command_args_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reply_parent_message_id" text,
  "moderation_state" text,
  "raw_event_id" uuid REFERENCES "twitch_eventsub_messages"("id"),
  "event_id" uuid REFERENCES "events"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "twitch_chat_messages_twitch_message_id_idx" ON "twitch_chat_messages" ("twitch_message_id");
CREATE INDEX IF NOT EXISTS "twitch_chat_messages_channel_created_idx" ON "twitch_chat_messages" ("channel_id", "created_at");
CREATE INDEX IF NOT EXISTS "twitch_chat_messages_command_idx" ON "twitch_chat_messages" ("command_name");

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "apps"("id"),
  "endpoint_id" uuid NOT NULL REFERENCES "app_webhook_endpoints"("id"),
  "event_id" uuid NOT NULL REFERENCES "events"("id"),
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_error" text,
  "payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "delivered_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_deliveries_endpoint_event_idx" ON "webhook_deliveries" ("endpoint_id", "event_id");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_next_attempt_idx" ON "webhook_deliveries" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_event_idx" ON "webhook_deliveries" ("event_id");

CREATE TABLE IF NOT EXISTS "webhook_delivery_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delivery_id" uuid NOT NULL REFERENCES "webhook_deliveries"("id"),
  "attempt_number" integer NOT NULL,
  "status_code" integer,
  "duration_ms" integer DEFAULT 0 NOT NULL,
  "response_excerpt" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "webhook_delivery_attempts_delivery_idx" ON "webhook_delivery_attempts" ("delivery_id");
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_delivery_attempts_number_idx" ON "webhook_delivery_attempts" ("delivery_id", "attempt_number");
