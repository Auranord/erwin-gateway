ALTER TABLE "apps"
  ADD COLUMN IF NOT EXISTS "permissions_json" jsonb DEFAULT '[]'::jsonb NOT NULL;

CREATE TABLE IF NOT EXISTS "app_api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "apps"("id"),
  "name" text NOT NULL,
  "key_prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "app_api_keys_key_prefix_idx" ON "app_api_keys" ("key_prefix");
CREATE INDEX IF NOT EXISTS "app_api_keys_app_id_idx" ON "app_api_keys" ("app_id");

CREATE TABLE IF NOT EXISTS "app_webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "apps"("id"),
  "name" text DEFAULT 'default' NOT NULL,
  "url" text,
  "enabled" boolean DEFAULT false NOT NULL,
  "event_filters_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "secret_hash" text,
  "last_delivery_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "app_webhook_endpoints_app_id_idx" ON "app_webhook_endpoints" ("app_id");
CREATE INDEX IF NOT EXISTS "admin_audit_log_target_idx" ON "admin_audit_log" ("target_type", "target_id");

INSERT INTO "apps" ("name", "slug", "description", "permissions_json")
VALUES
  ('Erwin Music', 'erwin-music', 'Initial downstream app for music and chat integrations.', '["chat:messages:send","chat:messages:receive","chat:commands:receive","streams:read","logs:read_own"]'::jsonb),
  ('Erwin Hatchery', 'erwin-hatchery', 'Initial downstream app for channel points, events, subscriptions, bits, and streams.', '["chat:messages:send","channel_points:rewards:read","channel_points:rewards:create","channel_points:rewards:update","channel_points:rewards:delete","channel_points:redemptions:read","channel_points:redemptions:manage","channel_points:events:receive","subscriptions:read","bits:read","streams:read","events:receive_twitch_events","logs:read_own"]'::jsonb)
ON CONFLICT ("slug") DO UPDATE SET
  "permissions_json" = EXCLUDED."permissions_json",
  "updated_at" = now();
