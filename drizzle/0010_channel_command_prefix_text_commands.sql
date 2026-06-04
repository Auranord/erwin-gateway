-- Preserve the most common active per-command prefix on each configured channel before
-- removing text_commands.prefix. Channel-level twitch_channels.command_prefix is the
-- single source of truth after this migration.
WITH ranked_prefixes AS (
  SELECT
    tc.channel_id,
    tc.prefix,
    count(*) AS command_count,
    row_number() OVER (PARTITION BY tc.channel_id ORDER BY count(*) DESC, tc.prefix ASC) AS rank
  FROM text_commands tc
  WHERE tc.archived_at IS NULL
    AND tc.channel_id IS NOT NULL
  GROUP BY tc.channel_id, tc.prefix
)
UPDATE twitch_channels channel
SET command_prefix = ranked_prefixes.prefix,
    updated_at = now()
FROM ranked_prefixes
WHERE ranked_prefixes.channel_id = channel.id
  AND ranked_prefixes.rank = 1;

WITH primary_global_prefix AS (
  SELECT
    tc.prefix,
    count(*) AS command_count
  FROM text_commands tc
  WHERE tc.archived_at IS NULL
    AND tc.channel_id IS NULL
  GROUP BY tc.prefix
  ORDER BY command_count DESC, tc.prefix ASC
  LIMIT 1
)
UPDATE twitch_channels channel
SET command_prefix = primary_global_prefix.prefix,
    updated_at = now()
FROM primary_global_prefix
WHERE channel.primary_channel = true
  AND NOT EXISTS (
    SELECT 1
    FROM text_commands tc
    WHERE tc.archived_at IS NULL
      AND tc.channel_id = channel.id
  );

DROP INDEX IF EXISTS "text_commands_channel_prefix_command_active_idx";
DROP INDEX IF EXISTS "text_commands_channel_prefix_idx";

ALTER TABLE "text_commands" DROP COLUMN IF EXISTS "prefix";

CREATE UNIQUE INDEX IF NOT EXISTS "text_commands_channel_command_active_idx"
  ON "text_commands" (COALESCE("channel_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("command"))
  WHERE "archived_at" IS NULL;
CREATE INDEX IF NOT EXISTS "text_commands_channel_idx" ON "text_commands" ("channel_id") WHERE "archived_at" IS NULL;
