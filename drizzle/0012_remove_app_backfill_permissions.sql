UPDATE "apps"
SET "permissions_json" = (
  SELECT COALESCE(jsonb_agg(permission), '[]'::jsonb)
  FROM jsonb_array_elements_text("apps"."permissions_json") AS permission
  WHERE permission NOT IN ('subscriptions:backfill', 'bits:backfill')
),
"updated_at" = now()
WHERE "permissions_json" ?| array['subscriptions:backfill', 'bits:backfill'];
