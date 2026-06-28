# erwin-hatchery migration guide

`erwin-hatchery` should stop owning Twitch Channel Point reward transport, EventSub subscriptions, Twitch token refresh, subscription/Bits transport, and stream/profile/schedule API calls. Hatchery keeps egg/voucher economy and redemption business decisions.

## Phased migration checklist

### Phase 0 — Gateway setup prerequisites

- [ ] Deploy the gateway with a public Twitch EventSub callback URL (`https://gateway.example.com/webhooks/twitch/eventsub`) and a stable app API base URL (`https://gateway.example.com`).
- [ ] Complete Twitch Setup for the broadcaster account with Channel Point, subscription, Bits, stream, profile, and schedule access.
- [ ] Confirm EventSub reconciliation is healthy for Channel Point redemption add/update, subscription, Bits, stream, and channel-update events before changing Hatchery.
- [ ] Confirm the gateway can read, create, update, delete, and sync Channel Point rewards for the broadcaster.
- [ ] Confirm the gateway backfill workers and queues are enabled for subscriptions and Bits.

### Phase 1 — Downstream app registration

- [ ] Register the downstream app with slug `erwin-hatchery` in the Admin UI Apps page or with the admin API.
- [ ] Set the app display name to `erwin-hatchery` so reward ownership, webhook deliveries, key usage, and audit events are easy to identify.
- [ ] Set the production webhook URL to the Hatchery receiver, for example `https://hatchery.example.com/erwin-gateway/webhook`.
- [ ] Keep the app enabled, but leave Hatchery in observe-only mode until the smoke tests below pass.

Example admin API registration payload:

```json
{
  "name": "erwin-hatchery",
  "slug": "erwin-hatchery",
  "permissions": [
    "chat:messages:send",
    "channel_points:rewards:read",
    "channel_points:rewards:create",
    "channel_points:rewards:update",
    "channel_points:rewards:delete",
    "channel_points:redemptions:read",
    "channel_points:redemptions:manage",
    "channel_points:events:receive",
    "subscriptions:read",
    "subscriptions:backfill",
    "bits:read",
    "bits:backfill",
    "streams:read",
    "events:receive_twitch_events",
    "logs:read_own"
  ],
  "webhookUrl": "https://hatchery.example.com/erwin-gateway/webhook",
  "webhookEventFilters": [
    "twitch.channel_points.custom_reward_redemption.add",
    "twitch.channel_points.custom_reward_redemption.update",
    "twitch.channel.subscribe",
    "twitch.channel.subscription.end",
    "twitch.channel.subscription.message",
    "twitch.channel.subscription.gift",
    "twitch.channel.cheer",
    "twitch.stream.online",
    "twitch.stream.offline",
    "twitch.channel.update"
  ]
}
```

### Phase 2 — Required permissions

- [ ] Grant `channel_points:rewards:read`, `channel_points:rewards:create`, `channel_points:rewards:update`, and `channel_points:rewards:delete` for gateway-owned reward management.
- [ ] Grant `channel_points:redemptions:read` and `channel_points:redemptions:manage` for redemption inspection and explicit fulfill/cancel decisions.
- [ ] Grant `channel_points:events:receive` for Channel Point redemption webhooks.
- [ ] Grant `subscriptions:read` and `subscriptions:backfill` for live subscription delivery and repair/backfill runs.
- [ ] Grant `bits:read` and `bits:backfill` for live cheer delivery and Bits leaderboard repair/backfill runs.
- [ ] Grant `streams:read` for stream, channel profile, and schedule reads plus stream/channel-update webhook delivery.
- [ ] Grant `chat:messages:send` only if Hatchery still emits chat confirmations through the gateway.
- [ ] Grant `events:receive_twitch_events` and `logs:read_own` only for the current diagnostics and app-owned event visibility needed by Hatchery operators.
- [ ] Do not grant admin permissions to Hatchery.

### Phase 3 — Webhook URL and exact event filters

- [ ] Configure the production webhook URL exactly once in the gateway app record: `https://hatchery.example.com/erwin-gateway/webhook`.
- [ ] Configure these exact webhook event filters:

```text
twitch.channel_points.custom_reward_redemption.add
twitch.channel_points.custom_reward_redemption.update
twitch.channel.subscribe
twitch.channel.subscription.end
twitch.channel.subscription.message
twitch.channel.subscription.gift
twitch.channel.cheer
twitch.stream.online
twitch.stream.offline
twitch.channel.update
```

- [ ] Use a staging URL and staging app record for pre-production tests, for example `https://hatchery-staging.example.com/erwin-gateway/webhook`.
- [ ] Avoid wildcard filters such as `twitch.*` in production unless Hatchery intentionally owns every Twitch event type.

### Phase 4 — API key generation and storage

- [ ] Generate a production API key from the Admin UI app detail page or `POST /api/admin/apps/<app-id>/keys` with a key name such as `production-2026-06`.
- [ ] Copy the raw key once; the gateway stores only a prefix and hash.
- [ ] Store the key in the downstream app secret manager as `ERWIN_GATEWAY_APP_API_KEY`.
- [ ] Store the gateway base URL as `ERWIN_GATEWAY_URL=https://gateway.example.com`.
- [ ] Store the app webhook signing secret as `ERWIN_GATEWAY_WEBHOOK_SIGNING_SECRET` and use it only for raw-body HMAC verification.
- [ ] Restart or redeploy Hatchery only after the secret is present in every production runtime instance and worker.
- [ ] Schedule key rotation by creating a second key, deploying it, confirming `GET /api/v1/me`, and revoking the old key.

### Phase 5 — Smoke tests before code changes

Run these checks before replacing any direct Twitch code:

- [ ] Gateway liveness: `GET https://gateway.example.com/api/v1/health/live` returns `2xx`.
- [ ] Gateway readiness: `GET https://gateway.example.com/api/v1/health/ready` returns `2xx`.
- [ ] App identity: `GET https://gateway.example.com/api/v1/me` with the Hatchery API key returns slug `erwin-hatchery`, enabled `true`, and the permissions listed above.
- [ ] Reward list: `GET https://gateway.example.com/api/v1/channel-points/rewards` succeeds with the Hatchery API key.
- [ ] Reward sync: `POST https://gateway.example.com/api/v1/channel-points/rewards/sync` succeeds and reports any unclaimed Twitch rewards.
- [ ] Redemption list: `GET https://gateway.example.com/api/v1/channel-points/redemptions` succeeds without exposing another app's resources.
- [ ] Subscriptions list/backfill: `GET https://gateway.example.com/api/v1/subscriptions` and a dry-run or limited `POST /api/v1/subscriptions/backfill` succeed.
- [ ] Bits leaderboard/backfill: `GET https://gateway.example.com/api/v1/bits/leaderboard` and a dry-run or limited `POST /api/v1/bits/backfill` succeed.
- [ ] Stream/profile/schedule reads: `GET /api/v1/streams/current`, `GET /api/v1/channels/:channelId/profile`, and `GET /api/v1/channels/:channelId/schedule` succeed.
- [ ] Webhook test: trigger the Admin UI webhook test for `erwin-hatchery` and verify the downstream app validates `X-Erwin-Gateway-Signature` against the raw request body.
- [ ] Delivery diagnostics: verify successful test deliveries appear in the Admin UI and no dead-lettered deliveries are created.

### Phase 6 — Code changes required in Hatchery

- [ ] Add a gateway client that reads `ERWIN_GATEWAY_URL` and `ERWIN_GATEWAY_APP_API_KEY`, sends `Authorization: Bearer <key>`, and handles `401`, `403`, `404`, `409`, `429`, and retryable `5xx` responses.
- [ ] Replace direct Twitch reward create/list/update/delete calls with the gateway Channel Point reward APIs.
- [ ] Persist gateway reward IDs, Twitch reward IDs, and owning app metadata so Hatchery can update only its own rewards.
- [ ] Replace direct EventSub redemption ingestion with a raw-body webhook route at `/erwin-gateway/webhook` that verifies `X-Erwin-Gateway-Signature` and rejects stale timestamps.
- [ ] Dedupe redemption webhooks by gateway `event_id` and Twitch redemption ID before granting eggs, vouchers, currency, or inventory items.
- [ ] Replace direct redemption fulfill/cancel calls with `PATCH /api/v1/channel-points/rewards/:rewardId/redemptions/:redemptionId/status` after Hatchery writes its economy ledger transaction or intentionally rejects/refunds.
- [ ] Replace direct subscription and Bits EventSub ingestion with the exact gateway webhook event filters listed in Phase 3.
- [ ] Replace direct subscription and Bits backfill calls with `POST /api/v1/subscriptions/backfill` and `POST /api/v1/bits/backfill`.
- [ ] Replace direct stream/profile/schedule Helix calls with `GET /api/v1/streams/current`, `GET /api/v1/channels/:channelId/profile`, and `GET /api/v1/channels/:channelId/schedule`.
- [ ] Remove broadcaster token storage, Twitch token refresh, EventSub subscription reconciliation, and direct EventSub receiver ownership from Hatchery startup once the gateway path is active.

### Phase 7 — Cutover steps

- [ ] Deploy Hatchery with gateway integration enabled in staging first and old Twitch transport disabled only in staging.
- [ ] In production, enable gateway webhook ingestion in observe-only mode and compare redemption, subscription, Bits, stream, and channel-update counts with the old path.
- [ ] Run reward sync, adopt existing Hatchery-owned Twitch rewards that Hatchery will manage through the gateway, and verify ownership metadata before allowing Hatchery to mutate rewards through the gateway.
- [ ] Disable direct EventSub redemption ingestion after duplicate-count checks pass.
- [ ] Enable gateway redemption fulfill/cancel for one low-risk reward, then expand to all Hatchery rewards.
- [ ] Disable direct reward management after all Hatchery rewards are gateway-owned or intentionally left admin-managed.
- [ ] Disable direct subscription/Bits backfill and event receivers after gateway deliveries and backfills are stable.
- [ ] Disable direct stream/profile/schedule Helix calls after gateway reads are stable.
- [ ] Monitor gateway webhook delivery queue, Channel Point diagnostics, EventSub health, backfill jobs, and Hatchery ledger logs during the first live stream after cutover.

### Phase 8 — Rollback steps

- [ ] Re-enable the previous Hatchery Twitch clients, EventSub receiver, reward manager, and token refresh using the last known good deployment or feature flags.
- [ ] Disable the `erwin-hatchery` app webhook endpoint in the gateway or remove its event filters to stop duplicate delivery.
- [ ] Pause gateway reward mutations for Hatchery-owned rewards before re-enabling direct Twitch reward mutation.
- [ ] Re-enable direct redemption fulfill/cancel only after confirming no gateway status update workers are still processing the same redemptions.
- [ ] Re-enable direct subscription/Bits backfill and stream/profile/schedule calls if those gateway APIs regress.
- [ ] Keep the API key valid until rollback verification is complete, then revoke only if the gateway path will remain disabled.
- [ ] Replay or retry only idempotent webhook deliveries after rollback; do not replay redemptions that already wrote Hatchery ledger records.

### Phase 9 — Post-cutover validation in Admin UI

- [ ] Apps page shows `erwin-hatchery` enabled with only the required permissions.
- [ ] API Keys page shows the active production key prefix and recent `last used` timestamp.
- [ ] Webhook endpoint page shows the production URL and exactly the filters listed in Phase 3.
- [ ] Webhook Deliveries page shows recent redemption, subscription, Bits, stream, and channel-update deliveries with `2xx` responses.
- [ ] Channel Points page shows Hatchery rewards mapped to `erwin-hatchery` ownership and no unexpected ownership violations.
- [ ] Queues page shows no stuck webhook deliveries, reward sync jobs, redemption status updates, subscription backfills, or Bits backfills for Hatchery.
- [ ] Twitch/EventSub health shows the required Channel Point, subscription, Bits, stream, and channel-update subscriptions healthy.
- [ ] Dead-letter and diagnostics views are empty or contain only acknowledged pre-cutover test records.
- [ ] Audit logs show Hatchery reward and redemption mutations attributed to the `erwin-hatchery` app key, not an admin key.

## Replacement map

| Old Hatchery behavior | New gateway behavior | App permission | Required Twitch scopes |
| --- | --- | --- | --- |
| Channel Point reward management | `/api/v1/channel-points/rewards` | reward read/create/update/delete permissions | broadcaster `channel:manage:redemptions` |
| Redemption events | signed webhooks `twitch.channel_points.custom_reward_redemption.add/update` | `channel_points:events:receive` | broadcaster `channel:read:redemptions`, `channel:manage:redemptions` |
| Redemption fulfill/cancel | `PATCH /api/v1/channel-points/rewards/:rewardId/redemptions/:redemptionId/status` | `channel_points:redemptions:manage` | broadcaster `channel:manage:redemptions` |
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

Rewards found on Twitch without ownership mapping are reported in diagnostics and should be adopted or left admin-managed intentionally.

Adopt an existing Twitch reward after sync when it is a Hatchery economy reward that Hatchery should manage through the gateway:

```bash
curl -X POST https://gateway.example.com/api/v1/channel-points/rewards/<reward-id>/adopt \
  -H 'Authorization: Bearer <erwin-hatchery-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "app_ownership_key": "hatchery:mystery_egg",
    "expected_twitch_reward_id": "<twitch-reward-id>",
    "local_reward_type": "mystery_egg"
  }'
```

Release a reward if Hatchery should stop owning it locally but the Twitch reward should remain available for broadcaster/admin management:

```bash
curl -X POST https://gateway.example.com/api/v1/channel-points/rewards/<reward-id>/release \
  -H 'Authorization: Bearer <erwin-hatchery-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "app_ownership_key": "hatchery:mystery_egg",
    "expected_twitch_reward_id": "<twitch-reward-id>",
    "local_reward_type": "mystery_egg"
  }'
```

Adoption and release require `channel_points:rewards:adopt` or `channel_points:rewards:update`. Adoption only succeeds for synced, non-deleted, gateway-manageable rewards that are unowned or already owned by `erwin-hatchery`; it rejects rewards owned by another app and rejects mismatched `expected_twitch_reward_id` values. Release clears Hatchery ownership without deleting the Twitch reward, and only Hatchery or an admin override can release a Hatchery-owned reward.

During cutover, adopt rewards that correspond to Hatchery egg, voucher, or economy flows and that Hatchery will update, fulfill/cancel, and lifecycle-manage through the gateway. Leave rewards admin-managed when they are broadcaster-run, shared with another app, not manageable by the gateway Twitch client, or intentionally observed by Hatchery without allowing Hatchery to change reward configuration.

## Redemption events

Subscribe Hatchery webhook filters to:

- `twitch.channel_points.custom_reward_redemption.add`
- `twitch.channel_points.custom_reward_redemption.update`

Webhook receivers must verify signatures and dedupe by Twitch redemption ID or gateway event ID. Duplicate Twitch EventSub deliveries do not double-grant because the gateway upserts redemptions by Twitch redemption ID.

## Redemption fulfill/cancel

The gateway never auto-fulfills or auto-cancels a redemption. Hatchery decides after its economy logic succeeds or fails:

```bash
curl -X PATCH https://gateway.example.com/api/v1/channel-points/rewards/<reward-id>/redemptions/<redemption-id>/status \
  -H 'Authorization: Bearer <erwin-hatchery-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{"status":"FULFILLED"}'
```

Use `CANCELED` when Hatchery intentionally rejects/refunds a redemption. Only the owning app or explicit manage permission can change status.

## Subscriptions

Use EventSub webhooks for live subscription events:

- `twitch.channel.subscribe`
- `twitch.channel.subscription.end`
- `twitch.channel.subscription.message`
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
