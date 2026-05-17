CREATE TABLE IF NOT EXISTS "gateway_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "admin_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(320) NOT NULL,
  "display_name" text,
  "disabled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_email_idx" ON "admin_users" ("email");

CREATE TABLE IF NOT EXISTS "admin_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_user_id" uuid REFERENCES "admin_users"("id"),
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "admin_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_user_id" uuid REFERENCES "admin_users"("id"),
  "action" text NOT NULL,
  "target_type" text,
  "target_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "apps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" varchar(80) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "apps_slug_idx" ON "apps" ("slug");

CREATE TABLE IF NOT EXISTS "twitch_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "broadcaster_user_id" text NOT NULL,
  "login" text NOT NULL,
  "display_name" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "primary_channel" boolean DEFAULT false NOT NULL,
  "command_prefix" varchar(8) DEFAULT '!' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "twitch_channels_broadcaster_user_id_idx" ON "twitch_channels" ("broadcaster_user_id");

CREATE TABLE IF NOT EXISTS "diagnostic_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "severity" varchar(20) NOT NULL,
  "module" text NOT NULL,
  "message" text NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "diagnostic_events_created_at_idx" ON "diagnostic_events" ("created_at");

CREATE TABLE IF NOT EXISTS "health_check_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" varchar(32) NOT NULL,
  "checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "placeholder_queues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "queue_name" text NOT NULL,
  "status" varchar(32) NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
