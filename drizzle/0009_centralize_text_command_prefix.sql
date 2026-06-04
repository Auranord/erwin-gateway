DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'text_commands'
      AND column_name = 'prefix'
  ) THEN
    EXECUTE $migration$
      UPDATE "twitch_channels" AS channel
      SET "command_prefix" = selected.prefix,
          "updated_at" = now()
      FROM (
        SELECT DISTINCT ON (COALESCE(command."channel_id", primary_channel.id))
          COALESCE(command."channel_id", primary_channel.id) AS channel_id,
          command."prefix" AS prefix
        FROM "text_commands" command
        LEFT JOIN LATERAL (
          SELECT id
          FROM "twitch_channels"
          WHERE "primary_channel" = true
          ORDER BY "created_at"
          LIMIT 1
        ) primary_channel ON command."channel_id" IS NULL
        WHERE command."archived_at" IS NULL
          AND command."prefix" IS NOT NULL
          AND COALESCE(command."channel_id", primary_channel.id) IS NOT NULL
        GROUP BY COALESCE(command."channel_id", primary_channel.id), command."prefix"
        ORDER BY COALESCE(command."channel_id", primary_channel.id), count(*) DESC, command."prefix"
      ) selected
      WHERE channel."id" = selected.channel_id
    $migration$;
  END IF;
END $$;

DROP INDEX IF EXISTS "text_commands_channel_prefix_command_active_idx";
DROP INDEX IF EXISTS "text_commands_channel_prefix_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "text_commands_channel_command_active_idx" ON "text_commands" (COALESCE("channel_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("command")) WHERE "archived_at" IS NULL;
CREATE INDEX IF NOT EXISTS "text_commands_channel_idx" ON "text_commands" ("channel_id") WHERE "archived_at" IS NULL;
ALTER TABLE "text_commands" DROP COLUMN IF EXISTS "prefix";
