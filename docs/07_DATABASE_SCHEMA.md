# 07 Database Schema

Use Drizzle migrations. Names can be adjusted, but the concepts must exist.

## Core

```text
schema_migrations
gateway_settings
admin_users
admin_sessions
admin_audit_log
```

## Twitch identity and tokens

```text
twitch_accounts
- id
- role: bot | broadcaster | viewer
- twitch_user_id
- login
- display_name
- profile_image_url
- created_at
- updated_at

twitch_tokens
- id
- account_id
- token_type: user | app
- access_token_encrypted
- refresh_token_encrypted
- scopes_json
- expires_at
- last_refresh_at
- refresh_error
- created_at
- updated_at
```

## Channels and EventSub

```text
twitch_channels
- id
- broadcaster_user_id
- login
- display_name
- enabled
- primary_channel
- command_prefix
- created_at
- updated_at

twitch_eventsub_subscriptions
- id
- twitch_subscription_id
- channel_id
- type
- version
- condition_json
- transport_method
- callback_url
- status
- desired
- last_sync_at
- last_revocation_reason
- created_at
- updated_at

twitch_eventsub_messages
- id
- twitch_message_id
- subscription_id
- subscription_type
- message_type
- received_at
- twitch_sent_at
- duplicate
- headers_json
- raw_payload_json
```

## Events and chat

```text
events
- id
- type
- channel_id
- actor_twitch_user_id
- occurred_at
- received_at
- normalized_json
- raw_eventsub_message_id
- created_at

twitch_chat_messages
- id
- twitch_message_id
- channel_id
- chatter_user_id
- chatter_login
- chatter_display_name
- text
- fragments_json
- badges_json
- color
- is_command
- command_symbol
- command_name
- command_args_text
- reply_parent_message_id
- moderation_state
- raw_event_id
- created_at
```

## Outgoing chat

```text
outgoing_chat_messages
- id
- source_app_id
- channel_id
- message
- reply_parent_message_id
- for_source_only
- priority
- status: queued | sending | sent | dropped | failed | retrying | dead_lettered
- idempotency_key
- twitch_message_id
- twitch_is_sent
- twitch_drop_reason_json
- attempts
- next_attempt_at
- created_at
- sent_at
- failed_at

outgoing_chat_attempts
- id
- outgoing_chat_message_id
- attempt_number
- request_json
- response_code
- response_json
- error
- rate_limit_json
- created_at
```

## Apps and webhooks

```text
apps
- id
- name
- slug
- enabled
- description
- created_at
- updated_at

app_api_keys
- id
- app_id
- key_prefix
- key_hash
- scopes_json
- last_used_at
- revoked_at
- created_at

app_webhook_endpoints
- id
- app_id
- url
- secret_encrypted
- enabled
- event_filters_json
- max_concurrency
- created_at
- updated_at

webhook_deliveries
- id
- app_id
- endpoint_id
- event_id
- status: queued | sending | delivered | retrying | failed | dead_lettered
- attempts
- next_attempt_at
- last_error
- created_at
- delivered_at

webhook_delivery_attempts
- id
- delivery_id
- attempt_number
- status_code
- duration_ms
- response_excerpt
- error
- created_at
```

## Channel Points

```text
twitch_channel_point_rewards
- id
- twitch_reward_id
- channel_id
- owning_app_id
- app_ownership_key
- title
- cost
- prompt
- enabled
- manageable
- background_color
- is_user_input_required
- limits_json
- raw_payload_json
- last_synced_at
- created_at
- updated_at
- deleted_at

twitch_channel_point_redemptions
- id
- twitch_redemption_id
- channel_id
- reward_id
- twitch_reward_id
- user_id
- user_login
- user_display_name
- status
- user_input
- redeemed_at
- fulfilled_at
- canceled_at
- raw_payload_json
- raw_event_id
- created_at
- updated_at

app_channel_point_reward_bindings
- id
- app_id
- reward_id
- permission: owner | read | manage
- created_at
```

## Text commands

```text
text_commands
- id
- channel_id
- command
- aliases_json
- prefix
- response_text
- enabled
- required_role
- cooldown_seconds
- user_cooldown_seconds
- reply_mode
- usage_count
- last_used_at
- created_by_admin_id
- created_at
- updated_at
- archived_at

text_command_invocations
- id
- text_command_id
- twitch_message_id
- channel_id
- user_id
- user_login
- status
- drop_reason
- queued_chat_message_id
- created_at
```

## Backfill and diagnostics

```text
idempotency_keys
health_check_snapshots
diagnostic_events
rate_limit_buckets
subscription_backfill_runs
bits_backfill_runs
reward_sync_runs
```

## Required ownership rules

Channel Point reward mutations must enforce ownership:

- owning app can update/delete/manage its rewards
- non-owning apps cannot mutate rewards
- admin override is allowed but must be explicit and audited

## Raw payload policy

Store raw Twitch payloads for diagnostics and replay.

App webhook payloads should normally include normalized fields plus `raw_ref`, not the full raw Twitch payload.
