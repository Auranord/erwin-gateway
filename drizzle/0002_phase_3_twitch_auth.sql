CREATE TABLE IF NOT EXISTS "twitch_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "role" varchar(32) NOT NULL,
  "twitch_user_id" text NOT NULL,
  "login" text NOT NULL,
  "display_name" text,
  "granted_scopes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "disabled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "twitch_accounts_role_idx" ON "twitch_accounts" ("role");
CREATE UNIQUE INDEX IF NOT EXISTS "twitch_accounts_twitch_user_id_idx" ON "twitch_accounts" ("twitch_user_id");

CREATE TABLE IF NOT EXISTS "twitch_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "twitch_accounts"("id"),
  "token_type" varchar(32) DEFAULT 'bearer' NOT NULL,
  "access_token_ciphertext" text NOT NULL,
  "refresh_token_ciphertext" text NOT NULL,
  "scopes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "validated_at" timestamp with time zone,
  "last_refreshed_at" timestamp with time zone,
  "last_refresh_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "twitch_tokens_account_id_idx" ON "twitch_tokens" ("account_id");
CREATE INDEX IF NOT EXISTS "twitch_tokens_expires_at_idx" ON "twitch_tokens" ("expires_at");

ALTER TABLE "twitch_channels"
  ADD COLUMN IF NOT EXISTS "broadcaster_account_id" uuid REFERENCES "twitch_accounts"("id");
CREATE INDEX IF NOT EXISTS "twitch_channels_broadcaster_account_id_idx" ON "twitch_channels" ("broadcaster_account_id");
