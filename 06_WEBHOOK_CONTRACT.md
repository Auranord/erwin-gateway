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
