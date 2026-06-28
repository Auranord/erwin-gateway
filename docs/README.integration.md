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

## Permission matrix

Use this matrix when requesting permissions for a registered app. All app-facing `/api/v1/*` routes require a valid app API key; rows marked "app API key only" do not require an additional app permission today.

| Gateway capability | Route or event | Required app permission | Notes |
| --- | --- | --- | --- |
| App identity smoke test | `GET /api/v1/me` | App API key only | Returns the authenticated app identity, enabled state, permissions, and key metadata. |
| Send chat messages | `POST /api/v1/chat/messages` | `chat:messages:send` | Also requires an `idempotency_key` for every outgoing chat write. |
| Chat message webhooks | `twitch.chat.message` | `chat:messages:receive` | Delivered to apps whose webhook filters match the event type. |
| Chat command webhooks | `twitch.chat.message` | `chat:commands:receive` | Commands are delivered as `twitch.chat.message` events with `chat.is_command = true`; subscribe to `twitch.chat.message` until a distinct command event type is intentionally added. |
| Channel Point reward read | `GET /api/v1/channel-points/rewards`, `GET /api/v1/channel-points/rewards/:rewardId`, reward sync/read helpers | `channel_points:rewards:read` | Read access includes listing and inspecting reward records. |
| Channel Point reward create | `POST /api/v1/channel-points/rewards` | `channel_points:rewards:create` | Creates app-owned custom rewards through the gateway. |
| Channel Point reward update | `PATCH /api/v1/channel-points/rewards/:rewardId` | `channel_points:rewards:update` | Only the owning app can mutate an app-owned reward. |
| Channel Point reward adopt | `POST /api/v1/channel-points/rewards/:rewardId/adopt` | `channel_points:rewards:adopt` or `channel_points:rewards:update` | Binds an unowned, manageable Twitch reward discovered by sync to the authenticated app. |
| Channel Point reward release | `POST /api/v1/channel-points/rewards/:rewardId/release` | `channel_points:rewards:adopt` or `channel_points:rewards:update` | Removes the app ownership binding without deleting the Twitch reward; only the owning app or admin override can release. |
| Channel Point reward delete | `DELETE /api/v1/channel-points/rewards/:rewardId` | `channel_points:rewards:delete` | Deletes or disables a manageable app-owned reward. |
| Channel Point redemption read | `GET /api/v1/channel-points/redemptions`, Twitch redemption fetch helpers | `channel_points:redemptions:read` | Required to list or inspect redemptions. |
| Channel Point redemption manage | `PATCH /api/v1/channel-points/rewards/:rewardId/redemptions/:redemptionId/status` | `channel_points:redemptions:manage` | Required to fulfill or cancel redemptions after downstream processing. |
| Channel Point webhook events | `twitch.channel_points.custom_reward_redemption.add`, `twitch.channel_points.custom_reward_redemption.update` | `channel_points:events:receive` | Used for Channel Point redemption event delivery. |
| Stream status/profile/schedule | `GET /api/v1/channel/status`, `GET /api/v1/streams/current`, `GET /api/v1/channels`, `GET /api/v1/channels/:channelId/profile`, `GET /api/v1/channels/:channelId/schedule`; stream/profile webhooks | `streams:read` | Also gates `twitch.stream.online`, `twitch.stream.offline`, and `twitch.channel.update` webhook delivery. |
| Subscriptions | `GET /api/v1/subscriptions`, subscription webhook events | `subscriptions:read` | Includes live subscription EventSub deliveries such as `twitch.channel.subscribe` and gift/message/end variants. |
| Subscription backfill | `POST /api/v1/subscriptions/backfill` | `subscriptions:backfill` | Use for historical or repair backfill runs. |
| Bits | `GET /api/v1/bits/leaderboard`, Bits webhook events | `bits:read` | Includes `twitch.channel.cheer` webhook delivery. |
| Bits backfill | `POST /api/v1/bits/backfill` | `bits:backfill` | Use for Bits leaderboard repair/backfill runs. |
| Webhook delivery inspection | `GET /api/v1/webhook-deliveries`, `GET /api/v1/webhook-deliveries/:deliveryId` | App API key only | Current app-facing routes are scoped to deliveries owned by the authenticated app and do not require a separate permission. If a dedicated delivery-inspection permission is added later, update this row. |
| Webhook delivery retry | `POST /api/v1/webhook-deliveries/:deliveryId/retry` | App API key only | Current app-facing retry is scoped to deliveries owned by the authenticated app and does not require a separate permission. If a dedicated delivery-retry permission is added later, update this row. |

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

## 6. Downstream client implementation examples

The examples below are intentionally app-side code, not gateway internals. They show the minimum patterns each downstream app should copy before it starts producing external effects.

### 6.1 Authenticated gateway client with common error handling

Use `Authorization: Bearer <app-api-key>` on every `/api/v1/*` request. Treat the API key as a secret and do not log it.

```ts
const gatewayBaseUrl = process.env.ERWIN_GATEWAY_URL ?? 'https://gateway.example.com';
const appApiKey = process.env.ERWIN_GATEWAY_APP_API_KEY!;

type GatewayErrorCode = 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503 | 504;

class GatewayError extends Error {
  constructor(
    public status: GatewayErrorCode,
    message: string,
    public responseBody: unknown,
  ) {
    super(message);
  }
}

function gatewayErrorMessage(status: number) {
  if (status === 401) return 'Gateway API key is missing, malformed, revoked, or invalid.';
  if (status === 403) return 'Gateway API key is valid but the app lacks the required permission.';
  if (status === 404) return 'Gateway resource was not found or does not belong to this app.';
  if (status === 409) return 'Idempotency conflict: the same key was reused with different request parameters.';
  if (status === 429) return 'Gateway or upstream Twitch rate limit reached; retry after the response delay if provided.';
  if (status >= 500) return 'Gateway or upstream dependency is temporarily unavailable; retry with backoff.';
  return `Gateway request failed with HTTP ${status}.`;
}

export async function gatewayFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(new URL(path, gatewayBaseUrl), {
    ...init,
    headers: {
      Authorization: `Bearer ${appApiKey}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new GatewayError(
      response.status as GatewayErrorCode,
      gatewayErrorMessage(response.status),
      body,
    );
  }

  return body as T;
}
```

Recommended handling by status:

| Status | App action |
| --- | --- |
| `401` | Stop startup or disable gateway features until the app API key is fixed. Do not retry with the same key in a hot loop. |
| `403` | Treat as configuration drift. Request the missing permission for the registered app. |
| `404` | Verify the app owns the requested reward, message, delivery, or redemption before retrying. |
| `409` | Use the existing resource returned by the gateway if available; otherwise create a new stable idempotency key only for a genuinely new action. |
| `429` | Back off, respect `Retry-After` if the gateway returns it, and keep the original idempotency key for retried writes. |
| `5xx` | Retry with exponential backoff and jitter; preserve idempotency keys so retries do not duplicate Twitch side effects. |

### 6.2 Send chat with a stable `idempotency_key`

Build the key from a business identifier that stays the same across process restarts, queue retries, and deploys. Do not use a random UUID per retry.

```ts
type SendChatResponse = {
  message: {
    id: string;
    status: 'queued' | 'sending' | 'sent' | 'retrying' | 'dead_lettered';
    idempotencyKey: string;
  };
};

export async function announceVoteRound(roundId: string, text: string) {
  const idempotencyKey = `erwin-music:vote-round:${roundId}:announcement:v1`;

  return gatewayFetch<SendChatResponse>('/api/v1/chat/messages', {
    method: 'POST',
    body: JSON.stringify({
      message: text,
      idempotency_key: idempotencyKey,
      for_source_only: true,
      priority: 0,
      metadata: {
        source: 'erwin-music',
        round_id: roundId,
      },
    }),
  });
}
```

If the app times out after sending this request, retry the same payload with the same `idempotency_key`. The gateway returns the existing queued or sent message for exact duplicates and returns `409` when the same key is reused for different message parameters.

### 6.3 Verify webhook signatures from the raw body

The gateway signs the concatenation of `X-Erwin-Gateway-Delivery-Id`, `X-Erwin-Gateway-Timestamp`, and the exact raw request body using the app webhook signing secret. The receiver must verify the signature before parsing or trusting the payload.

```ts
import crypto from 'node:crypto';
import express from 'express';

const webhookSigningSecret = process.env.ERWIN_GATEWAY_WEBHOOK_SIGNING_SECRET!;
const app = express();

function timingSafeSignatureCheck(expected: string, received: string) {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const receivedBytes = Buffer.from(received ?? '', 'utf8');
  return expectedBytes.length === receivedBytes.length
    && crypto.timingSafeEqual(expectedBytes, receivedBytes);
}

function verifyErwinGatewayWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer) {
  const deliveryId = String(headers['x-erwin-gateway-delivery-id'] ?? '');
  const timestamp = String(headers['x-erwin-gateway-timestamp'] ?? '');
  const signature = String(headers['x-erwin-gateway-signature'] ?? '');

  const ageMs = Math.abs(Date.now() - Date.parse(timestamp));
  if (!deliveryId || !timestamp || !signature || Number.isNaN(ageMs) || ageMs > 5 * 60_000) {
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac('sha256', webhookSigningSecret)
    .update(deliveryId)
    .update(timestamp)
    .update(rawBody)
    .digest('hex')}`;

  return timingSafeSignatureCheck(expected, signature);
}

app.post('/erwin-gateway/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!verifyErwinGatewayWebhook(req.headers, req.body)) {
    return res.status(401).send('invalid signature');
  }

  const payload = JSON.parse(req.body.toString('utf8'));
  await handleGatewayEvent(payload);
  return res.status(204).send();
});
```

Framework notes:

- Configure the route to expose the raw request body as bytes. Do not verify against `JSON.stringify(req.body)` after a JSON parser has normalized whitespace or key order.
- Use the `X-Erwin-Gateway-Delivery-Id` header for delivery-level dedupe and the payload `event_id` for event-level dedupe.
- Reject stale `X-Erwin-Gateway-Timestamp` values, for example older than five minutes, to limit replay risk.

### 6.4 Store webhook idempotency records before side effects

Persist idempotency keys in your app database before granting inventory, posting chat, updating ledgers, or fulfilling/canceling redemptions. A single Twitch EventSub event can be delivered more than once, and one logical Twitch redemption can appear in both `add` and `update` flows.

```sql
CREATE TABLE erwin_gateway_processed_events (
  delivery_id text PRIMARY KEY,
  event_id text NOT NULL,
  twitch_redemption_id text,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id),
  UNIQUE (twitch_redemption_id)
);
```

```ts
type GatewayWebhookPayload = {
  delivery_id: string;
  event_id: string;
  type: string;
  redemption?: { id: string; status: string; user_input?: string };
  reward?: { gateway_reward_id?: string; id: string; title: string };
};

async function handleGatewayEvent(payload: GatewayWebhookPayload) {
  const twitchRedemptionId = payload.redemption?.id ?? null;

  const inserted = await db.processedEvents.insertIgnore({
    deliveryId: payload.delivery_id,
    eventId: payload.event_id,
    twitchRedemptionId,
    eventType: payload.type,
  });

  if (!inserted) {
    return; // duplicate delivery_id, event_id, or Twitch redemption id: acknowledge without repeating side effects
  }

  if (payload.type === 'twitch.channel_points.custom_reward_redemption.add') {
    await grantRewardAndSettleRedemption(payload);
  }
}
```

Choose uniqueness based on the external effect:

- `delivery_id`: prevents repeating work for the same HTTP delivery retry.
- `event_id`: prevents repeating work when the same gateway event is redelivered.
- Twitch redemption id (`payload.redemption.id`): prevents granting the same Channel Point reward twice across `add`, `update`, manual retry, or app reprocessing paths.


### 6.5 Adopt or release existing Channel Point rewards

Run `POST /api/v1/channel-points/rewards/sync` before adoption so the gateway has local records for existing Twitch rewards. Adoption is for cutovers where the app should become the gateway owner of an existing Twitch reward instead of creating a duplicate reward.

Adopt an existing reward:

```ts
async function adoptExistingReward(rewardId: string, twitchRewardId: string) {
  return gatewayFetch(`/api/v1/channel-points/rewards/${rewardId}/adopt`, {
    method: 'POST',
    body: JSON.stringify({
      app_ownership_key: 'hatchery:mystery_egg',
      expected_twitch_reward_id: twitchRewardId,
      local_reward_type: 'mystery_egg',
    }),
  });
}
```

Release a reward back to admin-managed local state without deleting the Twitch reward:

```ts
async function releaseReward(rewardId: string, twitchRewardId: string) {
  return gatewayFetch(`/api/v1/channel-points/rewards/${rewardId}/release`, {
    method: 'POST',
    body: JSON.stringify({
      app_ownership_key: 'hatchery:mystery_egg',
      expected_twitch_reward_id: twitchRewardId,
      local_reward_type: 'mystery_egg',
    }),
  });
}
```

Required permissions and constraints:

- Adoption and release require `channel_points:rewards:adopt` or `channel_points:rewards:update`.
- Adoption only succeeds for a local, non-deleted reward that is manageable by the gateway Twitch client and is unowned or already owned by the authenticated app.
- `expected_twitch_reward_id` is optional but strongly recommended; when supplied, the gateway rejects the request if the local reward points at a different Twitch reward.
- Release does not delete, disable, or mutate the Twitch reward. It clears the local owner and ownership key so the reward becomes admin-managed.
- A non-admin app cannot adopt a reward owned by another app or release a reward it does not own.

During Hatchery cutover, adopt existing Twitch rewards when they represent Hatchery economy products and Hatchery will own future reward edits, redemption fulfillment/cancelation, and lifecycle through the gateway. Leave rewards admin-managed when the broadcaster intends to keep manual control, another app shares or owns the behavior, the gateway Twitch client cannot manage the reward, or Hatchery only needs to observe redemptions without mutating reward configuration.

### 6.6 Fulfill or cancel Channel Point redemptions

The gateway records redemptions but does not auto-fulfill or auto-cancel them. After your app durably completes or rejects its domain work, call the explicit status endpoint for the app-owned reward.

Fulfill after successful domain work:

```ts
async function fulfillRedemption(rewardId: string, redemptionId: string, ledgerTransactionId: string) {
  return gatewayFetch(`/api/v1/channel-points/rewards/${rewardId}/redemptions/${redemptionId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'FULFILLED',
      reason: `Granted reward in ledger transaction ${ledgerTransactionId}`,
    }),
  });
}
```

Cancel when the app cannot safely complete the reward:

```ts
async function cancelRedemption(rewardId: string, redemptionId: string, reason: string) {
  return gatewayFetch(`/api/v1/channel-points/rewards/${rewardId}/redemptions/${redemptionId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'CANCELED',
      reason: reason.slice(0, 500),
    }),
  });
}
```

Typical redemption flow:

1. Verify the webhook signature from the raw body.
2. Insert `delivery_id`, `event_id`, and `redemption.id` into the app idempotency table.
3. Run the app's domain transaction, such as granting an item, writing an economy ledger entry, or validating user input.
4. Call `PATCH /api/v1/channel-points/rewards/:rewardId/redemptions/:redemptionId/status` with `FULFILLED` only after the domain transaction commits.
5. Call the same endpoint with `CANCELED` when validation fails or the app cannot complete the reward.
6. Return `2xx` from the webhook only after the duplicate check and domain decision are durable.

Required permissions:

- `channel_points:redemptions:read` to list or inspect redemptions.
- `channel_points:redemptions:manage` to fulfill or cancel redemptions.

### 6.6 Inspect and retry webhook deliveries

Downstream apps can inspect only their own deliveries through the app-facing `/api/v1/webhook-deliveries` endpoints.

List recent failed or dead-lettered deliveries:

```bash
curl 'https://gateway.example.com/api/v1/webhook-deliveries?status=dead_lettered&limit=25' \
  -H 'Authorization: Bearer <app-api-key>'
```

Inspect one delivery and its attempts:

```bash
curl 'https://gateway.example.com/api/v1/webhook-deliveries/<delivery-id>' \
  -H 'Authorization: Bearer <app-api-key>'
```

Force a retry after fixing the receiver:

```bash
curl -X POST 'https://gateway.example.com/api/v1/webhook-deliveries/<delivery-id>/retry' \
  -H 'Authorization: Bearer <app-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Operational guidance:

- Admin operators inspect and retry webhook deliveries across apps with `GET /api/admin/webhook-deliveries`, `GET /api/admin/webhook-deliveries/:deliveryId`, and `POST /api/admin/webhook-deliveries/:deliveryId/retry`.
- Admin operators inspect and retry outgoing chat queue messages with `GET /api/admin/outgoing-chat/messages`, `GET /api/admin/outgoing-chat/messages/:messageId`, and `POST /api/admin/outgoing-chat/messages/:messageId/retry`.
- `/api/admin/queues/*` names are not active routes; only mention them as planned aliases if aliases are intentionally implemented later.
- Retry only after the app is ready to accept the event and its idempotency table is working.
- Expect the same `event_id` and domain identifiers again when a delivery is retried.
- Inspect delivery attempts for HTTP status, error text, and response excerpts before retrying repeatedly.
- Use status filters such as `queued`, `retrying`, `delivered`, and `dead_lettered` when triaging incidents.
