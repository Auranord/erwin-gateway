# erwin-music migration guide

`erwin-music` should stop owning Twitch transport. The gateway owns Twitch chat receive/send, command intake transport, stream status calls, OAuth refresh, and simple static text replies. `erwin-music` keeps all music domain behavior.

## Phased migration checklist

### Phase 0 — Gateway setup prerequisites

- [ ] Deploy the gateway with a public Twitch EventSub callback URL (`https://gateway.example.com/webhooks/twitch/eventsub`) and a stable app API base URL (`https://gateway.example.com`).
- [ ] Complete Twitch Setup for the broadcaster and bot accounts, including bot chat scopes and broadcaster `channel:bot` authorization.
- [ ] Confirm EventSub reconciliation is healthy for `channel.chat.message`, `stream.online`, and `stream.offline` before changing `erwin-music`.
- [ ] Confirm the gateway outgoing chat queue is enabled and can send as the bot account.
- [ ] Decide which static text commands move to the gateway Text Commands UI before the application cutover.

### Phase 1 — Downstream app registration

- [ ] Register the downstream app with slug `erwin-music` in the Admin UI Apps page or with the admin API.
- [ ] Set the app display name to `erwin-music` so delivery, key, queue, and audit views are easy to identify.
- [ ] Set the production webhook URL to the `erwin-music` receiver, for example `https://music.example.com/erwin-gateway/webhook`.
- [ ] Keep the app enabled, but leave `erwin-music` in observe-only mode until the smoke tests below pass.

Example admin API registration payload:

```json
{
  "name": "erwin-music",
  "slug": "erwin-music",
  "permissions": [
    "chat:messages:send",
    "chat:messages:receive",
    "chat:commands:receive",
    "streams:read",
    "logs:read_own"
  ],
  "webhookUrl": "https://music.example.com/erwin-gateway/webhook",
  "webhookEventFilters": [
    "twitch.chat.message",
    "twitch.stream.online",
    "twitch.stream.offline"
  ]
}
```

### Phase 2 — Required permissions

- [ ] Grant `chat:messages:receive` for all chat-message webhook delivery.
- [ ] Grant `chat:commands:receive` so command messages with `chat.is_command = true` are delivered to the same `twitch.chat.message` receiver.
- [ ] Grant `chat:messages:send` for vote, queue, timer, and music response messages sent through `POST /api/v1/chat/messages`.
- [ ] Grant `streams:read` for `GET /api/v1/streams/current` and stream online/offline webhook delivery.
- [ ] Grant `logs:read_own` if operators need app-scoped delivery or chat-send diagnostics.
- [ ] Do not grant Channel Point, Bits, subscription, or admin permissions to `erwin-music` unless a later feature explicitly requires them.

### Phase 3 — Webhook URL and exact event filters

- [ ] Configure the production webhook URL exactly once in the gateway app record: `https://music.example.com/erwin-gateway/webhook`.
- [ ] Configure these exact webhook event filters:

```text
twitch.chat.message
twitch.stream.online
twitch.stream.offline
```

- [ ] Do not add `twitch.chat.command`; commands are currently delivered as `twitch.chat.message` payloads where `chat.is_command = true`.
- [ ] Use a staging URL and staging app record for pre-production tests, for example `https://music-staging.example.com/erwin-gateway/webhook`.

### Phase 4 — API key generation and storage

- [ ] Generate a production API key from the Admin UI app detail page or `POST /api/admin/apps/<app-id>/keys` with a key name such as `production-2026-06`.
- [ ] Copy the raw key once; the gateway stores only a prefix and hash.
- [ ] Store the key in the downstream app secret manager as `ERWIN_GATEWAY_APP_API_KEY`.
- [ ] Store the gateway base URL as `ERWIN_GATEWAY_URL=https://gateway.example.com`.
- [ ] Store the app webhook signing secret as `ERWIN_GATEWAY_WEBHOOK_SIGNING_SECRET` and use it only for raw-body HMAC verification.
- [ ] Restart or redeploy `erwin-music` only after the secret is present in every production runtime instance.
- [ ] Schedule key rotation by creating a second key, deploying it, confirming `GET /api/v1/me`, and revoking the old key.

### Phase 5 — Smoke tests before code changes

Run these checks before replacing any IRC or direct Twitch code:

- [ ] Gateway liveness: `GET https://gateway.example.com/api/v1/health/live` returns `2xx`.
- [ ] Gateway readiness: `GET https://gateway.example.com/api/v1/health/ready` returns `2xx`.
- [ ] App identity: `GET https://gateway.example.com/api/v1/me` with the `erwin-music` API key returns slug `erwin-music`, enabled `true`, and the permissions listed above.
- [ ] Stream read: `GET https://gateway.example.com/api/v1/streams/current` succeeds with the `erwin-music` API key.
- [ ] Chat send: `POST https://gateway.example.com/api/v1/chat/messages` sends a harmless test message with an idempotency key such as `music-smoke-<timestamp>`.
- [ ] Webhook test: trigger the Admin UI webhook test for `erwin-music` and verify the downstream app validates `X-Erwin-Gateway-Signature` against the raw request body.
- [ ] Chat event test: send a real chat message and a real command such as `!song smoke-test`; verify both arrive as `twitch.chat.message` and the command has `chat.is_command = true`.
- [ ] Delivery diagnostics: verify successful deliveries appear in the Admin UI and no dead-lettered deliveries are created.

### Phase 6 — Code changes required in `erwin-music`

- [ ] Add a gateway client that reads `ERWIN_GATEWAY_URL` and `ERWIN_GATEWAY_APP_API_KEY`, sends `Authorization: Bearer <key>`, and handles `401`, `403`, `409`, `429`, and retryable `5xx` responses.
- [ ] Replace IRC `PRIVMSG` sends with `POST /api/v1/chat/messages` and stable `idempotency_key` values for vote announcements, timers, retries, and domain actions.
- [ ] Add a raw-body webhook route at `/erwin-gateway/webhook` that verifies `X-Erwin-Gateway-Signature`, rejects stale timestamps, and logs the gateway delivery ID without logging secrets.
- [ ] Dedupe webhook handling by gateway `event_id` and Twitch `chat.message_id` before changing music state or broadcasting to dashboards.
- [ ] Route `twitch.chat.message` events with `chat.is_command = true` to existing handlers for `!vote`, `!song`, `!skip`, `!pause`, and `!resume`.
- [ ] Preserve music-domain authorization using gateway role booleans such as `is_broadcaster`, `is_mod`, `is_vip`, and `is_subscriber`.
- [ ] Replace direct stream-status polling with `GET /api/v1/streams/current` or consume `twitch.stream.online` / `twitch.stream.offline` webhooks when event-driven behavior is enough.
- [ ] Remove bot OAuth refresh and IRC socket ownership from `erwin-music` startup once the gateway path is active.
- [ ] Move static commands such as `!dc`, `!discord`, `!youtube`, `!socials`, `!commands`, and `!lurk` into the gateway Text Commands UI when they do not need music state.

### Phase 7 — Cutover steps

- [ ] Deploy `erwin-music` with gateway integration enabled but leave the old IRC/Twitch transport disabled only in staging first.
- [ ] In production, enable gateway webhook ingestion in observe-only mode and compare command/message counts with the old IRC path for one stream segment.
- [ ] Disable old IRC receive after duplicate-count checks pass.
- [ ] Enable gateway chat sends for one low-risk response path, then for vote/timer/domain responses.
- [ ] Disable direct Twitch stream polling after `GET /api/v1/streams/current` or stream webhooks are stable.
- [ ] Disable local simple text command responses after those commands are active in the gateway Text Commands UI.
- [ ] Monitor gateway outgoing chat queue, webhook delivery queue, Twitch health, and downstream app logs during the first live stream after cutover.

### Phase 8 — Rollback steps

- [ ] Re-enable the previous IRC receive/send path in `erwin-music` using the last known good deployment or feature flag.
- [ ] Disable the `erwin-music` app webhook endpoint in the gateway or remove its event filters to stop duplicate command delivery.
- [ ] Disable gateway chat-send feature flags in `erwin-music` so only the old IRC sender emits responses.
- [ ] Re-enable direct stream polling if stream status behavior regresses.
- [ ] Keep the API key valid until rollback verification is complete, then revoke only if the gateway path will remain disabled.
- [ ] Replay or retry only idempotent webhook deliveries after rollback; do not replay command events that already changed music state.

### Phase 9 — Post-cutover validation in Admin UI

- [ ] Apps page shows `erwin-music` enabled with only the required permissions.
- [ ] API Keys page shows the active production key prefix and recent `last used` timestamp.
- [ ] Webhook endpoint page shows the production URL and exactly the filters listed in Phase 3.
- [ ] Webhook Deliveries page shows recent `twitch.chat.message`, `twitch.stream.online`, and `twitch.stream.offline` deliveries with `2xx` responses.
- [ ] Queues page shows no stuck outgoing chat messages or webhook deliveries for `erwin-music`.
- [ ] Twitch/EventSub health shows `channel.chat.message`, `stream.online`, and `stream.offline` subscriptions healthy.
- [ ] Text Commands UI contains the migrated static commands with intended aliases, cooldowns, role requirements, and response text.
- [ ] Dead-letter and diagnostics views are empty or contain only acknowledged pre-cutover test records.

## Replacement map

| Old erwin-music behavior | New gateway behavior | App permission | Twitch scope/source |
| --- | --- | --- | --- |
| IRC receive socket | Signed webhook `twitch.chat.message` | `chat:messages:receive` | EventSub `channel.chat.message`, bot `user:read:chat`/`user:bot`, broadcaster `channel:bot` |
| IRC `PRIVMSG` send | `POST /api/v1/chat/messages` | `chat:messages:send` | bot `user:write:chat`/`user:bot`, broadcaster `channel:bot` |
| `!vote`, `!song`, `!skip`, `!pause`, `!resume` command intake | Signed webhook `twitch.chat.message` with `chat.is_command = true` and parsed command fields | `chat:commands:receive` | same as chat receive |
| Simple text commands such as `!dc` | Gateway Text Commands admin UI + outgoing chat queue | gateway internal | same as chat send |
| Stream status polling | `GET /api/v1/streams/current` and stream online/offline webhooks | `streams:read` | Twitch stream APIs/EventSub |
| Bot OAuth refresh | Gateway Twitch Setup + encrypted refresh worker | none in app | bot OAuth |

## IRC receive replacement

Subscribe `erwin-music` webhook filters to `twitch.chat.message`. Command messages currently arrive as `twitch.chat.message` events with `chat.is_command = true`; only subscribe to a separate `twitch.chat.command` event if the gateway intentionally adds that event type later.

Webhook payload includes:

- message text and Twitch message ID
- command fields (`is_command`, `command_name`, `command_args`)
- badges and role booleans (`is_broadcaster`, `is_mod`, `is_vip`, `is_subscriber`)
- channel identity
- chatter identity
- raw EventSub references for diagnostics

Receiver requirements:

- Verify `X-Erwin-Gateway-Signature` using the raw body.
- Dedupe by event ID or Twitch message ID.
- Keep dashboard websocket broadcast logic in `erwin-music` if still needed.

## IRC send replacement

Use:

```bash
curl -X POST https://gateway.example.com/api/v1/chat/messages \
  -H 'Authorization: Bearer <erwin-music-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{"message":"Vote opened!","idempotency_key":"music-vote-<round-id>"}'
```

Use stable idempotency keys for vote announcements, timer messages, and retryable domain actions. Same-key/different-body conflicts return `409` and do not send a second Twitch message.

## Music command intake

The gateway only transports and parses these commands:

- `!vote`
- `!song`
- `!skip`
- `!pause`
- `!resume`

`erwin-music` still decides permissions, queue effects, vote accounting, skip/pause/resume behavior, overlay updates, and chat responses. Use role booleans from the webhook to preserve mod/broadcaster-only behavior.

## Simple text commands like `!dc`

Move static response commands into the gateway Text Commands UI when they do not require music domain state. Examples:

- `!dc`
- `!discord`
- `!youtube`
- `!socials`
- `!commands`
- `!lurk`

Configure response text, aliases, role requirement, reply mode, global cooldown, and per-user cooldown. Cooldown hits are recorded and do not spam chat. Command messages can still fan out to `erwin-music` through `twitch.chat.message` webhooks where `chat.is_command = true`.

## Stream status polling replacement

Use:

```text
GET /api/v1/streams/current
```

Use stream online/offline webhooks where event-driven behavior is enough. Keep Discord live notification dispatch in `erwin-music` unless that is intentionally migrated later.

## Failure behavior

- Gateway retries signed webhooks and dead-letters permanently failed deliveries.
- `erwin-music` should return `2xx` only after it records/dedupes the event.
- Gateway retries outgoing chat safely and records dead-letter state when Twitch rejects or cannot accept a message after retries.
- Twitch EventSub duplicate messages are ignored by message ID.
