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
  "app_ownership_key": "hatchery:mystery_egg",
  "local_reward_type": "mystery_egg"
}
```

Reward adoption binds an existing Twitch reward that was discovered by sync to the authenticated app without creating a new Twitch reward. The app must have `channel_points:rewards:adopt` or `channel_points:rewards:update`. The target reward must exist locally, must not be deleted, must be manageable by the gateway Twitch client, and must be unowned or already owned by the same app. If another app owns the reward, adoption returns a conflict instead of transferring ownership. Use `expected_twitch_reward_id` as a cutover safety check so a stale gateway reward ID cannot bind the wrong Twitch reward.

Reward adopt example for `POST /api/v1/channel-points/rewards/:rewardId/adopt`:

```json
{
  "app_ownership_key": "hatchery:mystery_egg",
  "expected_twitch_reward_id": "twitch-reward-123",
  "local_reward_type": "mystery_egg"
}
```

Reward release removes the authenticated app's local ownership binding without deleting or disabling the Twitch reward. It requires `channel_points:rewards:adopt` or `channel_points:rewards:update`. Only the owning app can release its reward unless an admin override is used; releasing an unowned reward or a reward owned by another app is rejected.

Reward release example for `POST /api/v1/channel-points/rewards/:rewardId/release`:

```json
{
  "app_ownership_key": "hatchery:mystery_egg",
  "expected_twitch_reward_id": "twitch-reward-123",
  "local_reward_type": "mystery_egg"
}
```

The release endpoint currently does not require request fields; include this payload in client-side runbooks and audit notes when planning a cutover, but treat ownership checks as server-side state checks against the authenticated app and stored reward.

During Hatchery cutover, adopt existing Twitch rewards only when Hatchery will manage their title, cost, enabled state, redemption fulfillment/cancelation, and lifecycle through the gateway. Leave rewards admin-managed when they are shared with another app, manually administered by the broadcaster, not manageable by the gateway Twitch client, or intentionally outside Hatchery's economy automation.

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

Current MVP admin authentication contract:

- `INTERNAL_ADMIN_API_KEY` is required for admin routes. Configure it as a strong secret in each deployed environment.
- Admin API callers may send either `X-Admin-API-Key: <key>` or `Authorization: Bearer <key>`.
- The only `/api/admin/twitch/*/callback` exception is the Twitch OAuth callback route family (`GET /api/admin/twitch/bot/callback` and `GET /api/admin/twitch/broadcaster/callback`), which must remain reachable by the operator's browser after Twitch authorization.
- Do not expose the admin UI or `/api/admin/*` publicly without reverse-proxy authentication, VPN/private-network access, IP allowlisting, or an equivalent boundary.

For TrueNAS/reverse proxy deployments, publish the Twitch EventSub webhook and OAuth callback paths through HTTPS, but keep admin surfaces private or protected at the proxy before requests reach the gateway.

Queue inspection and retry admin endpoints intentionally use the implemented resource-specific route names above: `/api/admin/outgoing-chat/messages*` for outgoing chat messages and `/api/admin/webhook-deliveries*` for webhook deliveries. Do not document `/api/admin/queues/*` as an active route unless queue aliases are intentionally added later.

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
channel_points:rewards:adopt
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
channel_points:rewards:adopt
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
