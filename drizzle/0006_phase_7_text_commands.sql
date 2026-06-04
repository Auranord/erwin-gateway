CREATE TABLE IF NOT EXISTS "text_commands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel_id" uuid REFERENCES "twitch_channels"("id"),
  "command" text NOT NULL,
  "aliases_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "response_text" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "required_role" varchar(32) DEFAULT 'everyone' NOT NULL,
  "cooldown_seconds" integer DEFAULT 0 NOT NULL,
  "user_cooldown_seconds" integer DEFAULT 0 NOT NULL,
  "reply_mode" varchar(32) DEFAULT 'message' NOT NULL,
  "usage_count" integer DEFAULT 0 NOT NULL,
  "last_used_at" timestamp with time zone,
  "created_by_admin_id" uuid REFERENCES "admin_users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "text_commands_channel_command_active_idx" ON "text_commands" (COALESCE("channel_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("command")) WHERE "archived_at" IS NULL;
CREATE INDEX IF NOT EXISTS "text_commands_channel_idx" ON "text_commands" ("channel_id") WHERE "archived_at" IS NULL;
CREATE INDEX IF NOT EXISTS "text_commands_enabled_idx" ON "text_commands" ("enabled") WHERE "archived_at" IS NULL;

CREATE TABLE IF NOT EXISTS "text_command_invocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "text_command_id" uuid NOT NULL REFERENCES "text_commands"("id"),
  "twitch_message_id" text,
  "channel_id" uuid REFERENCES "twitch_channels"("id"),
  "user_id" text,
  "user_login" text,
  "status" varchar(32) NOT NULL,
  "drop_reason" text,
  "queued_chat_message_id" uuid REFERENCES "outgoing_chat_messages"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "text_command_invocations_command_created_idx" ON "text_command_invocations" ("text_command_id", "created_at");
CREATE INDEX IF NOT EXISTS "text_command_invocations_user_created_idx" ON "text_command_invocations" ("text_command_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "text_command_invocations_status_idx" ON "text_command_invocations" ("status");
