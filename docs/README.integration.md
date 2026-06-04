# erwin-gateway integration guide

This guide is enough for a new internal app to authenticate with `erwin-gateway`, call app APIs, send chat, and receive signed webhooks.

## 1. Register an app

Use the admin UI Apps page or the admin API:

```bash
curl -X POST https://gateway.example.com/api/admin/apps \
  -H 'X-Admin-API-Key: <admin-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Example App",
    "slug": "example-app",
    "permissions": ["chat:messages:send", "chat:messages:receive"],
    "webhookUrl": "https://example.internal/erwin-gateway/webhook",
    "webhookEventFilters": ["twitch.chat.message", "twitch.channel_points.custom_reward_redemption.add"]
  }'
```

Seeded MVP apps are `erwin-music` and `erwin-hatchery`. Keep permissions least-privilege; every app API route checks the app's permissions.

## 2. Generate an API key

```bash
curl -X POST https://gateway.example.com/api/admin/apps/<app-id>/keys \
  -H 'X-Admin-API-Key: <admin-key>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"production"}'
```

The response includes `rawKey` once. Store it in the consuming app's secret manager. The gateway stores only a key prefix and HMAC hash. Revoke old keys with:

```bash
curl -X DELETE https://gateway.example.com/api/admin/apps/<app-id>/keys/<key-id> \
  -H 'X-Admin-API-Key: <admin-key>'
```

Revoked keys fail authentication immediately.

## 3. Call `/api/v1/me`

```bash
curl https://gateway.example.com/api/v1/me \
  -H 'Authorization: Bearer <app-api-key>'
```

A successful response returns the app identity, enabled state, permissions, and API key metadata. Use this as a startup smoke test in downstream apps.

## 4. Send a Twitch chat message

```bash
curl -X POST https://gateway.example.com/api/v1/chat/messages \
  -H 'Authorization: Bearer <app-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Thanks for voting!",
    "idempotency_key": "vote-round-2026-05-18T00:00:00Z",
    "for_source_only": true,
    "priority": 0
  }'
```

Requirements:

- Permission: `chat:messages:send`.
- `idempotency_key` is required for every outgoing chat write.
- Reusing the same key with the same body returns the existing queued/sent message.
- Reusing the same key with different message parameters returns `409` and does not enqueue a duplicate.

Check status with:

```bash
curl https://gateway.example.com/api/v1/chat/messages/<message-id> \
  -H 'Authorization: Bearer <app-api-key>'
```

## 5. Receive and verify webhooks

Webhook deliveries are JSON `POST` requests to the app webhook URL. Headers:

```text
X-Erwin-Gateway-Delivery-Id: <delivery uuid>
X-Erwin-Gateway-Event-Id: <event uuid>
X-Erwin-Gateway-Timestamp: <ISO timestamp>
X-Erwin-Gateway-Signature: sha256=<hex hmac>
X-Erwin-Gateway-App-Id: <app uuid>
```

Signature input is:

```text
delivery_id + timestamp + raw_body
```

Node verification example:

```js
import crypto from 'node:crypto';

export function verifyGatewayWebhook({ secret, deliveryId, timestamp, rawBody, signature }) {
  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(deliveryId)
    .update(timestamp)
    .update(rawBody)
    .digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

Important receiver rules:

- Verify against the exact raw request body, not parsed/re-serialized JSON.
- Reject old timestamps to limit replay risk.
- Store `X-Erwin-Gateway-Delivery-Id` or payload `event_id` to make your handler idempotent.
- Return any `2xx` response only after the app has durably recorded the event or safely detected a duplicate.

Common event types and filters:

- `twitch.chat.message`
- `twitch.channel_points.custom_reward_redemption.add`
- `twitch.channel_points.custom_reward_redemption.update`
- `twitch.*` for all Twitch events
- `*` for all deliverable events
- `twitch.channel.subscribe`
- `twitch.channel.subscription.gift`
- `twitch.channel.cheer`
- `twitch.stream.online`
- `twitch.stream.offline`

## Idempotency expectations

- Gateway write endpoints require idempotency keys where duplicate external effects are possible.
- Chat sends dedupe by `(app, scope, idempotency_key)` and reject same-key/different-body conflicts.
- EventSub messages dedupe by Twitch message ID.
- Channel Point redemptions dedupe by Twitch redemption ID.
- Downstream webhook receivers must also dedupe because HTTP retries can deliver the same event more than once.

## Retry and dead-letter behavior

- Webhook deliveries retry on network errors and non-2xx responses.
- Retry attempts use bounded exponential backoff and are recorded in delivery attempts.
- After the retry limit, the delivery is marked `dead_lettered` and appears in admin diagnostics.
- Operators can inspect and force retry delivery from the admin UI/API after fixing the downstream app.
- Outgoing chat messages also retry safe Twitch failures and dead-letter permanently failed sends with status, response excerpts, and diagnostic context that excludes secrets.

## Health checks for consumers

- `GET /api/v1/health/live` confirms the process is running.
- `GET /api/v1/health/ready` confirms database/Twitch readiness.
- `GET /api/v1/health/deep` includes scope, EventSub, queue, Channel Point, Bits/subscription, and dead-letter diagnostics.
