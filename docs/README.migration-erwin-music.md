# erwin-music migration guide

`erwin-music` should stop owning Twitch transport. The gateway owns Twitch chat receive/send, command intake transport, stream status calls, OAuth refresh, and simple static text replies. `erwin-music` keeps all music domain behavior.

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
