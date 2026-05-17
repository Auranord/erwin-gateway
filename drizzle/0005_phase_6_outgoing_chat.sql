CREATE TABLE IF NOT EXISTS "outgoing_chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_app_id" uuid NOT NULL REFERENCES "apps"("id"),
  "channel_id" uuid NOT NULL REFERENCES "twitch_channels"("id"),
  "message" text NOT NULL,
  "reply_parent_message_id" text,
  "for_source_only" boolean DEFAULT true NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "idempotency_key" text NOT NULL,
  "twitch_message_id" text,
  "twitch_is_sent" boolean,
  "twitch_drop_reason_json" jsonb,
  "response_code" integer,
  "response_body_excerpt" text,
  "rate_limit_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "failed_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "outgoing_chat_messages_app_idempotency_idx" ON "outgoing_chat_messages" ("source_app_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "outgoing_chat_messages_status_next_attempt_idx" ON "outgoing_chat_messages" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "outgoing_chat_messages_channel_created_idx" ON "outgoing_chat_messages" ("channel_id", "created_at");
CREATE INDEX IF NOT EXISTS "outgoing_chat_messages_source_app_idx" ON "outgoing_chat_messages" ("source_app_id");

CREATE TABLE IF NOT EXISTS "outgoing_chat_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "outgoing_chat_message_id" uuid NOT NULL REFERENCES "outgoing_chat_messages"("id"),
  "attempt_number" integer NOT NULL,
  "request_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "response_code" integer,
  "response_json" jsonb,
  "response_body_excerpt" text,
  "error" text,
  "rate_limit_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "outgoing_chat_attempts_message_idx" ON "outgoing_chat_attempts" ("outgoing_chat_message_id");
CREATE UNIQUE INDEX IF NOT EXISTS "outgoing_chat_attempts_number_idx" ON "outgoing_chat_attempts" ("outgoing_chat_message_id", "attempt_number");

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_app_id" uuid NOT NULL REFERENCES "apps"("id"),
  "scope" varchar(80) NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "resource_type" varchar(80) NOT NULL,
  "resource_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_app_scope_key_idx" ON "idempotency_keys" ("source_app_id", "scope", "idempotency_key");
CREATE INDEX IF NOT EXISTS "idempotency_keys_resource_idx" ON "idempotency_keys" ("resource_type", "resource_id");

CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bucket_type" varchar(64) NOT NULL,
  "bucket_key" text NOT NULL,
  "limit" integer,
  "remaining" integer,
  "reset_at" timestamp with time zone,
  "last_sent_at" timestamp with time zone,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limit_buckets_type_key_idx" ON "rate_limit_buckets" ("bucket_type", "bucket_key");
CREATE INDEX IF NOT EXISTS "rate_limit_buckets_reset_idx" ON "rate_limit_buckets" ("reset_at");
