# 05 API Contract

All app-facing APIs should be versioned under `/api/v1`.

Authentication:

```text
Authorization: Bearer <app_api_key>
```

## Health and docs

```text
GET /api/v1/health/live
GET /api/v1/health/ready
GET /api/v1/health/deep
GET /api/v1/me
GET /openapi.json
GET /docs
```

## Chat

```text
GET  /api/v1/chat/log?q=&command=&limit=
GET  /api/v1/chat/messages?status=&from=&to=&limit=
POST /api/v1/chat/messages
GET  /api/v1/chat/messages/:id
```

Example request:

```json
{
  "channel_id": "primary",
  "message": "Der Discord ist hier: https://discord.gg/example",
  "reply_to_message_id": null,
  "for_source_only": true,
  "idempotency_key": "erwin-music-vote-start-2026-05-17T18:00:00Z",
  "priority": "normal",
  "metadata": {
    "source": "erwin-music",
    "reason": "vote_announcement"
  }
}
```

Response:

```json
{
  "id": "chatmsg_01...",
  "status": "queued",
  "channel_id": "primary",
  "created_at": "2026-05-17T18:00:00.000Z"
}
```

## Channel status and public channel data

```text
GET /api/v1/channel/status
GET /api/v1/streams/current
GET /api/v1/channels
GET /api/v1/channels/:channelId/profile
GET /api/v1/channels/:channelId/schedule
```

## Channel Points

```text
GET    /api/v1/channel-points/rewards?include_deleted=
POST   /api/v1/channel-points/rewards
POST   /api/v1/channel-points/rewards/sync
GET    /api/v1/channel-points/rewards/:rewardId
PATCH  /api/v1/channel-points/rewards/:rewardId
DELETE /api/v1/channel-points/rewards/:rewardId
POST   /api/v1/channel-points/rewards/:rewardId/adopt
POST   /api/v1/channel-points/rewards/:rewardId/release
GET    /api/v1/channel-points/rewards/:rewardId/redemptions?status=&sync=&limit=
GET    /api/v1/channel-points/redemptions?status=&limit=
PATCH  /api/v1/channel-points/rewards/:rewardId/redemptions/:redemptionId/status
```

Reward create example:

```json
{
  "channel_id": "primary",
  "title": "Mystery Egg",
  "cost": 500,
  "prompt": "Redeem this to receive a Hatchery mystery egg.",
  "enabled": true,
  "background_color": "#9146FF",
  "is_user_input_required": false,
  "is_max_per_stream_enabled": false,
  "is_max_per_user_per_stream_enabled": false,
  "is_global_cooldown_enabled": false,
  "app_ownership_key": "hatchery:mystery_egg"
}
```

Redemption status update example:

```json
{
  "status": "FULFILLED",
  "reason": "Hatchery granted the egg and wrote its ledger transaction."
}
```

Allowed status values:

```text
FULFILLED
CANCELED
```

## Subscriptions and Bits

```text
POST /api/v1/subscriptions/backfill
GET  /api/v1/subscriptions
POST /api/v1/bits/backfill
GET  /api/v1/bits/leaderboard
```

## Events/logs

```text
GET /api/v1/events
GET /api/v1/events/:eventId
GET /api/v1/chat/log
GET /api/v1/webhook-deliveries
GET /api/v1/webhook-deliveries/:deliveryId
POST /api/v1/webhook-deliveries/:deliveryId/retry
```

Access to logs must be permission-based. Apps should see their own deliveries and permitted channel events. Full raw logs should be admin-only by default.

## Admin/setup API

```text
GET    /api/admin/shell
POST   /api/admin/debug/events
GET    /api/admin/diagnostics
GET    /api/admin/apps
POST   /api/admin/apps
GET    /api/admin/apps/:id
PATCH  /api/admin/apps/:id
DELETE /api/admin/apps/:id
POST   /api/admin/apps/:id/keys
DELETE /api/admin/apps/:id/keys/:keyId
POST   /api/admin/apps/:id/webhook-secret
POST   /api/admin/apps/:id/webhook-test
GET    /api/admin/twitch/setup/status
POST   /api/admin/twitch/bot/login/start
GET    /api/admin/twitch/bot/callback
POST   /api/admin/twitch/broadcaster/login/start
GET    /api/admin/twitch/broadcaster/callback
GET    /api/v1/twitch/oauth/bot/callback
GET    /api/v1/twitch/oauth/broadcaster/callback
POST   /api/admin/twitch/eventsub/sync
GET    /api/admin/twitch/eventsub/status
GET    /api/admin/twitch/eventsub/live
POST   /api/admin/twitch/tokens/refresh
GET    /api/admin/twitch/primary-channel/command-prefix
PATCH  /api/admin/twitch/primary-channel/command-prefix
GET    /api/admin/chat/log?q=&command=&limit=
GET    /api/admin/outgoing-chat/messages?status=&from=&to=&limit=
GET    /api/admin/outgoing-chat/messages/:messageId
POST   /api/admin/outgoing-chat/messages/:messageId/retry
GET    /api/admin/webhook-deliveries?status=&limit=
GET    /api/admin/webhook-deliveries/:deliveryId
POST   /api/admin/webhook-deliveries/:deliveryId/retry
GET    /api/admin/channel-points?includeDeleted=&redemptionQ=&redemptionStatus=&redemptionLimit=
POST   /api/admin/channel-points/rewards/sync
PATCH  /api/admin/channel-points/rewards/:rewardId
DELETE /api/admin/channel-points/rewards/:rewardId
```

Admin routes may be protected by local admin session, reverse proxy auth, or a strong admin API key in MVP. Do not expose admin routes publicly without auth.

## Text command admin API

```text
GET    /api/admin/text-commands
POST   /api/admin/text-commands
GET    /api/admin/text-commands/:id
PATCH  /api/admin/text-commands/:id
DELETE /api/admin/text-commands/:id
POST   /api/admin/text-commands/:id/test
```

Internal app API should not need to manage these commands unless explicitly permitted later.

## App API key and permission model

Apps authenticate with per-app API keys.

Requirements:

- One app can have multiple active keys for rotation.
- Show raw key only once at creation.
- Store only a hash of the API key.
- Include key prefix for identification.
- Support key revoke.
- Track last used timestamp.
- Track source app for all outgoing messages and mutations.

Recommended app key format:

```text
egw_live_<key_id>_<secret>
egw_dev_<key_id>_<secret>
```

Recommended permissions:

```text
chat:messages:send
chat:messages:receive
chat:commands:receive
events:receive_twitch_events
events:read
logs:read_own
logs:read_all
channel_points:rewards:read
channel_points:rewards:create
channel_points:rewards:update
channel_points:rewards:delete
channel_points:redemptions:read
channel_points:redemptions:manage
channel_points:events:receive
subscriptions:read
subscriptions:backfill
bits:read
bits:backfill
streams:read
admin:apps
admin:twitch
```

Default app permissions:

### erwin-music

```text
chat:messages:send
chat:messages:receive
chat:commands:receive
streams:read
logs:read_own
```

### erwin-hatchery

```text
chat:messages:send
channel_points:rewards:read
channel_points:rewards:create
channel_points:rewards:update
channel_points:rewards:delete
channel_points:redemptions:read
channel_points:redemptions:manage
channel_points:events:receive
subscriptions:read
subscriptions:backfill
bits:read
bits:backfill
streams:read
events:receive_twitch_events
logs:read_own
```
