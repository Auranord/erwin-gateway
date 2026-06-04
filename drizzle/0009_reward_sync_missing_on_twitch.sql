ALTER TABLE "reward_sync_runs"
  ADD COLUMN IF NOT EXISTS "rewards_missing_on_twitch" integer DEFAULT 0 NOT NULL;
