# 06 Webhook Contract

The gateway sends signed webhooks to registered downstream apps.

## Headers

```text
X-Erwin-Gateway-Delivery-Id: gwdel_01...
X-Erwin-Gateway-Event-Id: gwevt_01...
X-Erwin-Gateway-Timestamp: 2026-05-17T18:00:00.000Z
X-Erwin-Gateway-Signature: sha256=<hmac>
X-Erwin-Gateway-App-Id: app_01...
User-Agent: erwin-gateway/<version>
```

Signature input:

```text
X-Erwin-Gateway-Delivery-Id + X-Erwin-Gateway-Timestamp + raw request body
```

Use HMAC-SHA256 with the app webhook secret. Downstream apps must use timing-safe comparison.

## MVP webhook payload examples

These compact examples show the normalized fields downstream apps should depend on. They intentionally omit delivery-specific headers and full raw Twitch payloads; use `event_id` plus the Twitch IDs shown below for idempotency.

### `twitch.chat.message` with `chat.is_command = false`

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "event_id": "gwevt_chat_001",
  "type": "twitch.chat.message",
  "occurred_at": "2026-05-17T18:00:00.000Z",
  "received_at": "2026-05-17T18:00:00.200Z",
  "channel": { "id": "53471337", "login": "ntkoh", "display_name": "NTKOH" },
  "actor": {
    "id": "123456",
    "login": "viewer_login",
    "display_name": "ViewerName",
    "badges": [{ "set_id": "subscriber", "id": "12", "info": "12" }],
    "color": "#9146FF",
    "is_broadcaster": false,
    "is_mod": false,
    "is_vip": false,
    "is_subscriber": true
  },
  "chat": {
    "message_id": "twitch-message-001",
    "text": "hello chat",
    "fragments": [],
    "is_command": false,
    "command_symbol": null,
    "command_name": null,
    "command_args_text": null,
    "command_args": [],
    "reply_parent_message_id": null
  },
  "twitch": {
    "eventsub_message_id": "eventsub-message-001",
    "subscription_id": "eventsub-sub-chat",
    "subscription_type": "channel.chat.message",
    "subscription_version": "1"
  },
  "raw_ref": { "table": "twitch_eventsub_messages", "id": "rawevt_chat_001" }
}
```

### `twitch.chat.message` with `chat.is_command = true`

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "event_id": "gwevt_chat_002",
  "type": "twitch.chat.message",
  "occurred_at": "2026-05-17T18:01:00.000Z",
  "received_at": "2026-05-17T18:01:00.200Z",
  "channel": { "id": "53471337", "login": "ntkoh", "display_name": "NTKOH" },
  "actor": {
    "id": "123456",
    "login": "viewer_login",
    "display_name": "ViewerName",
    "badges": [{ "set_id": "moderator", "id": "1", "info": "" }],
    "color": "#00FF7F",
    "is_broadcaster": false,
    "is_mod": true,
    "is_vip": false,
    "is_subscriber": false
  },
  "chat": {
    "message_id": "twitch-message-002",
    "text": "!song request example",
    "fragments": [],
    "is_command": true,
    "command_symbol": "!",
    "command_name": "song",
    "command_args_text": "request example",
    "command_args": ["request", "example"],
    "reply_parent_message_id": null
  },
  "twitch": {
    "eventsub_message_id": "eventsub-message-002",
    "subscription_id": "eventsub-sub-chat",
    "subscription_type": "channel.chat.message",
    "subscription_version": "1"
  },
  "raw_ref": { "table": "twitch_eventsub_messages", "id": "rawevt_chat_002" }
}
```

### `twitch.channel_points.custom_reward_redemption.add`

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "event_id": "gwevt_redemption_add_001",
  "type": "twitch.channel_points.custom_reward_redemption.add",
  "occurred_at": "2026-05-17T18:02:00.000Z",
  "received_at": "2026-05-17T18:02:00.200Z",
  "channel": { "id": "channel_01" },
  "user": { "id": "123456", "login": "viewer_login", "display_name": "ViewerName" },
  "reward": {
    "id": "reward_01",
    "twitch_reward_id": "twitch-reward-001",
    "title": "Mystery Egg",
    "cost": 500,
    "owning_app_id": "app_hatchery"
  },
  "redemption": {
    "id": "redemption_01",
    "twitch_redemption_id": "twitch-redemption-001",
    "status": "UNFULFILLED",
    "user_input": "blue",
    "redeemed_at": "2026-05-17T18:02:00.000Z",
    "fulfilled_at": null,
    "canceled_at": null
  },
  "twitch": { "event_type": "twitch.channel_points.custom_reward_redemption.add", "raw_event_id": "rawevt_redemption_add_001" },
  "idempotency": { "twitch_redemption_id": "twitch-redemption-001" }
}
```

### `twitch.channel_points.custom_reward_redemption.update`

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "event_id": "gwevt_redemption_update_001",
  "type": "twitch.channel_points.custom_reward_redemption.update",
  "occurred_at": "2026-05-17T18:03:00.000Z",
  "received_at": "2026-05-17T18:03:00.200Z",
  "channel": { "id": "channel_01" },
  "user": { "id": "123456", "login": "viewer_login", "display_name": "ViewerName" },
  "reward": {
    "id": "reward_01",
    "twitch_reward_id": "twitch-reward-001",
    "title": "Mystery Egg",
    "cost": 500,
    "owning_app_id": "app_hatchery"
  },
  "redemption": {
    "id": "redemption_01",
    "twitch_redemption_id": "twitch-redemption-001",
    "status": "FULFILLED",
    "user_input": "blue",
    "redeemed_at": "2026-05-17T18:02:00.000Z",
    "fulfilled_at": "2026-05-17T18:03:00.000Z",
    "canceled_at": null
  },
  "twitch": { "event_type": "twitch.channel_points.custom_reward_redemption.update", "raw_event_id": "rawevt_redemption_update_001" },
  "idempotency": { "twitch_redemption_id": "twitch-redemption-001" }
}
```

### `twitch.channel.subscribe`

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "event_id": "gwevt_subscribe_001",
  "type": "twitch.channel.subscribe",
  "occurred_at": "2026-05-17T18:04:00.000Z",
  "received_at": "2026-05-17T18:04:00.200Z",
  "channel": { "id": "53471337", "login": "ntkoh", "display_name": "NTKOH" },
  "actor": { "id": "123456", "login": "viewer_login", "display_name": "ViewerName" },
  "subscription": {
    "tier": "1000",
    "is_gift": false,
    "cumulative_months": null,
    "streak_months": null,
    "duration_months": null,
    "gift_total": null,
    "gifter": null,
    "message": null
  },
  "twitch": {
    "eventsub_message_id": "eventsub-message-subscribe-001",
    "subscription_id": "eventsub-sub-subscribe",
    "subscription_type": "channel.subscribe",
    "subscription_version": "1"
  },
  "raw_ref": { "table": "twitch_eventsub_messages", "id": "rawevt_subscribe_001" }
}
```

### `twitch.channel.subscription.gift`

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "event_id": "gwevt_subgift_001",
  "type": "twitch.channel.subscription.gift",
  "occurred_at": "2026-05-17T18:05:00.000Z",
  "received_at": "2026-05-17T18:05:00.200Z",
  "channel": { "id": "53471337", "login": "ntkoh", "display_name": "NTKOH" },
  "actor": { "id": "234567", "login": "recipient_login", "display_name": "RecipientName" },
  "subscription": {
    "tier": "1000",
    "is_gift": true,
    "cumulative_months": null,
    "streak_months": null,
    "duration_months": null,
    "gift_total": 5,
    "gifter": { "id": "345678", "login": "gifter_login", "display_name": "GifterName", "is_anonymous": false },
    "message": null
  },
  "twitch": {
    "eventsub_message_id": "eventsub-message-subgift-001",
    "subscription_id": "eventsub-sub-subgift",
    "subscription_type": "channel.subscription.gift",
    "subscription_version": "1"
  },
  "raw_ref": { "table": "twitch_eventsub_messages", "id": "rawevt_subgift_001" }
}
```

### `twitch.channel.cheer`

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "event_id": "gwevt_cheer_001",
  "type": "twitch.channel.cheer",
  "occurred_at": "2026-05-17T18:06:00.000Z",
  "received_at": "2026-05-17T18:06:00.200Z",
  "channel": { "id": "53471337", "login": "ntkoh", "display_name": "NTKOH" },
  "actor": { "id": "123456", "login": "viewer_login", "display_name": "ViewerName", "is_anonymous": false },
  "cheer": { "bits": 100, "message": "Nice!" },
  "twitch": {
    "eventsub_message_id": "eventsub-message-cheer-001",
    "subscription_id": "eventsub-sub-cheer",
    "subscription_type": "channel.cheer",
    "subscription_version": "1"
  },
  "raw_ref": { "table": "twitch_eventsub_messages", "id": "rawevt_cheer_001" }
}
```

### `twitch.stream.online`

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "event_id": "gwevt_stream_online_001",
  "type": "twitch.stream.online",
  "occurred_at": "2026-05-17T18:07:00.000Z",
  "received_at": "2026-05-17T18:07:00.200Z",
  "channel": { "id": "53471337", "login": "ntkoh", "display_name": "NTKOH" },
  "stream": { "id": "twitch-stream-001", "type": "live", "started_at": "2026-05-17T18:07:00.000Z" },
  "twitch": {
    "eventsub_message_id": "eventsub-message-stream-online-001",
    "subscription_id": "eventsub-sub-stream-online",
    "subscription_type": "stream.online",
    "subscription_version": "1"
  },
  "raw_ref": { "table": "twitch_eventsub_messages", "id": "rawevt_stream_online_001" }
}
```

### `twitch.stream.offline`

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "event_id": "gwevt_stream_offline_001",
  "type": "twitch.stream.offline",
  "occurred_at": "2026-05-17T20:07:00.000Z",
  "received_at": "2026-05-17T20:07:00.200Z",
  "channel": { "id": "53471337", "login": "ntkoh", "display_name": "NTKOH" },
  "stream": { "id": null, "type": "offline", "started_at": null },
  "twitch": {
    "eventsub_message_id": "eventsub-message-stream-offline-001",
    "subscription_id": "eventsub-sub-stream-offline",
    "subscription_type": "stream.offline",
    "subscription_version": "1"
  },
  "raw_ref": { "table": "twitch_eventsub_messages", "id": "rawevt_stream_offline_001" }
}
```

### `twitch.channel.update`

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "event_id": "gwevt_channel_update_001",
  "type": "twitch.channel.update",
  "occurred_at": "2026-05-17T18:08:00.000Z",
  "received_at": "2026-05-17T18:08:00.200Z",
  "channel": { "id": "53471337", "login": "ntkoh", "display_name": "NTKOH" },
  "update": {
    "title": "Building the gateway",
    "language": "en",
    "category_id": "509670",
    "category_name": "Science & Technology",
    "content_classification_labels": []
  },
  "twitch": {
    "eventsub_message_id": "eventsub-message-channel-update-001",
    "subscription_id": "eventsub-sub-channel-update",
    "subscription_type": "channel.update",
    "subscription_version": "1"
  },
  "raw_ref": { "table": "twitch_eventsub_messages", "id": "rawevt_channel_update_001" }
}
```

## Chat message payload

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "delivery_id": "gwdel_01...",
  "event_id": "gwevt_01...",
  "type": "twitch.chat.message",
  "occurred_at": "2026-05-17T18:00:00.000Z",
  "received_at": "2026-05-17T18:00:00.200Z",
  "channel": {
    "id": "53471337",
    "login": "ntkoh",
    "display_name": "NTKOH"
  },
  "actor": {
    "id": "123456",
    "login": "viewer_login",
    "display_name": "ViewerName",
    "badges": [
      { "set_id": "subscriber", "id": "12", "info": "12" }
    ],
    "color": "#9146FF",
    "is_broadcaster": false,
    "is_mod": false,
    "is_vip": false,
    "is_subscriber": true
  },
  "chat": {
    "message_id": "twitch-message-id",
    "text": "!song request example",
    "fragments": [],
    "is_command": true,
    "command_symbol": "!",
    "command_name": "song",
    "command_args_text": "request example",
    "command_args": ["request", "example"],
    "reply_parent_message_id": null
  },
  "twitch": {
    "eventsub_message_id": "eventsub-message-id",
    "subscription_id": "eventsub-sub-id",
    "subscription_type": "channel.chat.message",
    "subscription_version": "1"
  },
  "raw_ref": {
    "table": "twitch_eventsub_messages",
    "id": "rawevt_01..."
  }
}
```

## Command fanout behavior

If a chat message starts with the configured command symbol, default `!`, deliver it to every enabled app with permission:

```text
chat:commands:receive
```

Apps decide whether to handle the command.

Do not centrally own music commands such as `!vote`, `!song`, `!skip`, `!pause`, or `!resume`. Those remain erwin-music domain logic.

Gateway-owned simple text responses are the exception. Examples:

```text
!dc
!discord
!youtube
!socials
!commands
!lurk
```

## Channel Point redemption payload

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "delivery_id": "gwdel_01...",
  "event_id": "gwevt_01...",
  "type": "twitch.channel_points.custom_reward_redemption.add",
  "occurred_at": "2026-05-17T18:00:00.000Z",
  "received_at": "2026-05-17T18:00:00.200Z",
  "channel": {
    "id": "53471337",
    "login": "ntkoh",
    "display_name": "NTKOH"
  },
  "actor": {
    "id": "123456",
    "login": "viewer_login",
    "display_name": "ViewerName"
  },
  "redemption": {
    "id": "redemption-id",
    "status": "UNFULFILLED",
    "user_input": "",
    "redeemed_at": "2026-05-17T18:00:00.000Z"
  },
  "reward": {
    "id": "twitch-reward-id",
    "gateway_reward_id": "reward_01...",
    "title": "Mystery Egg",
    "cost": 500,
    "prompt": "Redeem this to receive a Hatchery mystery egg.",
    "owning_app_id": "app_hatchery"
  },
  "twitch": {
    "eventsub_message_id": "eventsub-message-id",
    "subscription_id": "eventsub-sub-id",
    "subscription_type": "channel.channel_points_custom_reward_redemption.add",
    "subscription_version": "1"
  },
  "raw_ref": {
    "table": "twitch_eventsub_messages",
    "id": "rawevt_01..."
  }
}
```

Apps must treat `event_id` and Twitch redemption ID as idempotency keys.

## Subscription event payload

Use the same envelope:

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "delivery_id": "gwdel_01...",
  "event_id": "gwevt_01...",
  "type": "twitch.channel.subscribe",
  "occurred_at": "2026-05-17T18:00:00.000Z",
  "received_at": "2026-05-17T18:00:00.200Z",
  "channel": {
    "id": "53471337",
    "login": "ntkoh",
    "display_name": "NTKOH"
  },
  "actor": {
    "id": "123456",
    "login": "viewer_login",
    "display_name": "ViewerName"
  },
  "subscription": {
    "tier": "1000",
    "is_gift": false
  },
  "twitch": {
    "eventsub_message_id": "eventsub-message-id",
    "subscription_type": "channel.subscribe",
    "subscription_version": "1"
  },
  "raw_ref": {
    "table": "twitch_eventsub_messages",
    "id": "rawevt_01..."
  }
}
```

## Bits cheer payload

```json
{
  "schema": "erwin.gateway.webhook.v1",
  "delivery_id": "gwdel_01...",
  "event_id": "gwevt_01...",
  "type": "twitch.channel.cheer",
  "occurred_at": "2026-05-17T18:00:00.000Z",
  "received_at": "2026-05-17T18:00:00.200Z",
  "channel": {
    "id": "53471337",
    "login": "ntkoh",
    "display_name": "NTKOH"
  },
  "actor": {
    "id": "123456",
    "login": "viewer_login",
    "display_name": "ViewerName"
  },
  "cheer": {
    "bits": 100,
    "message": "Nice!"
  },
  "twitch": {
    "eventsub_message_id": "eventsub-message-id",
    "subscription_type": "channel.cheer",
    "subscription_version": "1"
  },
  "raw_ref": {
    "table": "twitch_eventsub_messages",
    "id": "rawevt_01..."
  }
}
```

## Delivery behavior

- Gateway retries non-2xx app responses.
- Use exponential backoff with jitter.
- Persist every delivery attempt.
- Dead-letter after max attempts.
- Admin UI must allow safe retry.
- Apps must implement idempotency.
