# 03 Architecture

## High-level architecture

`erwin-gateway` is a central integration gateway.

It has:

- one public Twitch EventSub webhook endpoint
- internal app-facing API endpoints
- signed webhook delivery to downstream apps
- admin web UI
- Postgres persistence
- background workers for queues, retries, token refresh, EventSub reconciliation, and sync tasks

## Twitch integration architecture decision

Use Twitch EventSub Webhooks, not EventSub WebSockets, for the MVP.

Reason:

- The project wants a dedicated bot account with proper Twitch Chat Bot Badge / Chat Bots identity.
- The cloud chatbot model needs EventSub Webhooks with App Access Tokens.
- EventSub WebSockets or IRC should not be the MVP path because they do not satisfy the desired Chat Bot Badge / chatters-list identity behavior.

The gateway must expose a public HTTPS Twitch callback endpoint:

```text
POST /webhooks/twitch/eventsub
```

This endpoint must be reachable through the configured public domain and reverse proxy.

Internal app APIs and admin UI may stay behind private network access or reverse proxy auth, but the Twitch webhook endpoint must be publicly reachable by Twitch.

## Gateway responsibilities

The gateway owns:

- Twitch app credentials
- Twitch bot identity
- Twitch broadcaster authorization
- token refresh
- EventSub subscription creation/reconciliation
- EventSub webhook verification
- normalized Twitch events
- full chat/event log
- outgoing Twitch chat queue
- Channel Point reward management
- Channel Point redemption persistence
- subscription and bits event forwarding
- stream/profile/schedule API proxying where needed
- app API keys
- app webhook signing
- simple text response commands
- health checks and diagnostics

## Downstream app responsibilities

### erwin-music keeps

- music queue
- song request logic
- vote logic
- skip/pause/resume domain behavior
- dashboard websocket broadcast
- hype/rave overlay thresholds
- Discord live notification dispatch unless explicitly migrated later

### erwin-hatchery keeps

- Hatchery economy rules
- egg grants
- voucher grants
- user inventory
- ledger
- incubation logic
- game UI and state

## Event flow: incoming chat

1. Twitch sends `channel.chat.message` to `/webhooks/twitch/eventsub`.
2. Gateway verifies Twitch signature.
3. Gateway deduplicates by Twitch EventSub message ID.
4. Gateway persists raw EventSub payload.
5. Gateway normalizes chat message.
6. Gateway stores chat log.
7. If message starts with command prefix, gateway parses command fields.
8. Gateway fans out signed webhook to subscribed apps.
9. Gateway checks simple text command table.
10. If a matching gateway-owned text response exists, enqueue outgoing chat message.
11. Outgoing chat worker sends the response through Twitch Send Chat Message API.

## Event flow: Channel Point redemption

1. Twitch sends redemption add/update EventSub event.
2. Gateway verifies signature.
3. Gateway deduplicates.
4. Gateway stores raw payload.
5. Gateway updates redemption table.
6. Gateway resolves reward ownership.
7. Gateway sends signed webhook to subscribed/owning app, usually Hatchery.
8. Hatchery performs economy transaction.
9. If Hatchery wants to fulfill/cancel, it explicitly calls the gateway redemption status API.
10. Gateway calls Twitch redemption status endpoint using broadcaster user token.

## Outgoing chat flow

1. App calls `POST /api/v1/chat/messages` or text command creates a response.
2. Gateway validates permission, channel, message, idempotency key, and rate limits.
3. Gateway inserts queued outgoing message.
4. Worker sends through `POST /helix/chat/messages`.
5. Gateway stores Twitch response.
6. If Twitch drops the message, store drop reason.
7. Retry transient failures with backoff.
8. Dead-letter permanent failures.

## Recommended internal modules

```text
src/modules/apps/
src/modules/auth/
src/modules/twitch/
src/modules/twitch-chat/
src/modules/twitch-eventsub/
src/modules/twitch-channel-points/
src/modules/twitch-subscriptions/
src/modules/twitch-bits/
src/modules/text-commands/
src/modules/webhooks/
src/modules/health/
src/modules/admin/
```

Future modules should be able to fit next to Twitch modules:

```text
src/modules/discord/
```

## EventSub webhook handling flow

1. Receive POST on `/webhooks/twitch/eventsub`.
2. Preserve raw body for signature verification.
3. Verify HMAC-SHA256 signature with the EventSub secret.
4. Reject invalid signatures with 4xx.
5. Dedupe by `Twitch-Eventsub-Message-Id`.
6. If message type is `webhook_callback_verification`, return raw challenge text with HTTP 200.
7. If message type is `notification`, write event quickly to DB and return 2xx.
8. If message type is `revocation`, mark subscription unhealthy, write diagnostic event, and return 2xx.
9. Async workers normalize events and deliver signed app webhooks.
10. Reconciliation worker repairs missing or broken subscriptions where possible.

Must not block Twitch callback while delivering downstream app webhooks.
