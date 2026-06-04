# erwin-hatchery migration guide

`erwin-hatchery` should stop owning Twitch Channel Point reward transport, EventSub subscriptions, Twitch token refresh, subscription/Bits transport, and stream/profile/schedule API calls. Hatchery keeps egg/voucher economy and redemption business decisions.

## Replacement map

| Old Hatchery behavior | New gateway behavior | App permission | Required Twitch scopes |
| --- | --- | --- | --- |
| Channel Point reward management | `/api/v1/channel-points/rewards` | reward read/create/update/delete permissions | broadcaster `channel:manage:redemptions` |
| Redemption events | signed webhooks `twitch.channel_points.custom_reward_redemption.add/update` | `channel_points:events:receive` | broadcaster `channel:read:redemptions`, `channel:manage:redemptions` |
| Redemption fulfill/cancel | `/api/v1/channel-points/redemptions/:id/status` | `channel_points:redemptions:manage` | broadcaster `channel:manage:redemptions` |
| EventSub subscriptions | gateway EventSub reconciliation | none in app | scopes by event type |
| Subscription events/backfill | subscription webhooks + `/api/v1/subscriptions/backfill` | `subscriptions:read`, `subscriptions:backfill` | broadcaster `channel:read:subscriptions` |
| Bits events/backfill | Bits webhooks + `/api/v1/bits/backfill`, `/api/v1/bits/leaderboard` | `bits:read`, `bits:backfill` | broadcaster `bits:read` |
| Stream/profile/schedule calls | `/api/v1/streams/current`, `/api/v1/channels/:channelId/profile`, `/api/v1/channels/:channelId/schedule` | `streams:read` | broadcaster setup required for gateway ownership |

## Channel Point reward management

Create a reward:

```bash
curl -X POST https://gateway.example.com/api/v1/channel-points/rewards \
  -H 'Authorization: Bearer <erwin-hatchery-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Hatch an egg","cost":1000,"prompt":"Choose your egg"}'
```

The created reward is owned by `erwin-hatchery`. Only the owning app, or an explicit admin override, can update/delete/status-manage the reward. This prevents another app from mutating Hatchery rewards.

Sync rewards from Twitch when needed:

```text
POST /api/v1/channel-points/rewards/sync
```

Rewards found on Twitch without ownership mapping are reported in diagnostics and should be claimed or left admin-managed intentionally.

## Redemption events

Subscribe Hatchery webhook filters to:

- `twitch.channel_points.custom_reward_redemption.add`
- `twitch.channel_points.custom_reward_redemption.update`

Webhook receivers must verify signatures and dedupe by Twitch redemption ID or gateway event ID. Duplicate Twitch EventSub deliveries do not double-grant because the gateway upserts redemptions by Twitch redemption ID.

## Redemption fulfill/cancel

The gateway never auto-fulfills or auto-cancels a redemption. Hatchery decides after its economy logic succeeds or fails:

```bash
curl -X POST https://gateway.example.com/api/v1/channel-points/redemptions/<redemption-id>/status \
  -H 'Authorization: Bearer <erwin-hatchery-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{"status":"FULFILLED"}'
```

Use `CANCELED` when Hatchery intentionally rejects/refunds a redemption. Only the owning app or explicit manage permission can change status.

## Subscriptions

Use EventSub webhooks for live subscription events:

- `twitch.channel.subscribe`
- `twitch.channel.subscription.gift`

Use backfill/list endpoints:

```text
POST /api/v1/subscriptions/backfill
GET  /api/v1/subscriptions
```

## Bits

Use EventSub webhook:

```text
twitch.channel.cheer
```

Use backfill/list endpoints:

```text
POST /api/v1/bits/backfill
GET  /api/v1/bits/leaderboard
```

## Stream/profile/schedule calls

Replace direct Twitch API calls with:

```text
GET /api/v1/streams/current
GET /api/v1/channels/:channelId/profile
GET /api/v1/channels/:channelId/schedule
```

## Failure behavior

- Webhook deliveries retry and dead-letter when Hatchery is unavailable or returns non-2xx.
- Hatchery should durably record/dedupe an event before returning `2xx`.
- EventSub revocations and missing scopes degrade health; reconnect broadcaster OAuth and run EventSub sync.
- Reward ownership violations return `403` rather than mutating another app's reward.
