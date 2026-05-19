# 09 Health Checks and Self-Healing

## Health endpoints

### Liveness

```text
GET /api/v1/health/live
```

Returns healthy if process responds.

### Readiness

```text
GET /api/v1/health/ready
```

Returns ready only if:

- Postgres reachable.
- Migrations current.
- Required env vars present.
- Queue workers running.
- Required Twitch tokens exist or are refreshable.

### Deep health

```text
GET /api/v1/health/deep
```

Returns detailed JSON with:

- Twitch app token validity.
- Bot token validity.
- Broadcaster token validity.
- Missing scopes.
- EventSub subscription status.
- Last EventSub event time.
- Last chat message time.
- Last outgoing chat success.
- Outgoing queue depth and oldest queued age.
- Webhook delivery queue depth and oldest queued age.
- Dead-letter counts.
- Last reward sync.
- Last redemption event.
- Last subscription event.
- Last bits event.
- Rate limit state.
- Version, branch, image tag, build SHA.

## Self-healing routines

Implement:

- Proactive token refresh before expiry.
- Refresh-on-401 once, then mark degraded if still failing.
- EventSub reconciliation at startup.
- Periodic EventSub reconciliation.
- Delete/recreate mismatched EventSub subscriptions.
- Mark revoked subscriptions unhealthy.
- Detect missing required scopes.
- Detect stuck queue rows and requeue safely.
- Detect repeated downstream webhook failures and dead-letter them.
- Reward sync at startup.
- Periodic manageable reward sync.
- Detect rewards in DB missing on Twitch.
- Detect Twitch rewards created by this client but missing local ownership mapping.
- Detect duplicate Twitch EventSub deliveries.
- Detect duplicate redemption IDs.
- Admin retry buttons for failed queues.

Do not silently drop events.

If a permanent failure happens, store a dead-letter row with enough data for debugging.

## Outgoing chat queue behavior

Do not send chat directly inside request handlers.

Flow:

1. App calls `POST /api/v1/chat/messages` or gateway text command creates a response.
2. Validate permission, message length, channel, idempotency key, and rate limits.
3. Insert `outgoing_chat_messages` row with `queued` status.
4. Worker pulls queued message.
5. Worker sends through `POST /helix/chat/messages`.
6. Store Twitch response.
7. If Twitch returns `drop_reason`, mark as `dropped` and expose the reason.
8. Retry transient errors with backoff.
9. Dead-letter after max attempts.

Rate limiting:

- Track Twitch chat rate limits.
- Track Twitch API rate headers.
- Track per-app message limits.
- Track per-channel minimum spacing.
- Add priority support, but do not let low-priority messages starve forever.

## Webhook delivery behavior

- Gateway retries non-2xx app responses.
- Use exponential backoff with jitter.
- Persist every delivery attempt.
- Dead-letter after max attempts.
- Admin UI must allow safe retry.
- Apps must implement idempotency.

## Degraded states

The gateway should clearly report degraded if:

- database unavailable
- migrations not current
- app token invalid
- bot token missing or expired
- broadcaster token missing or expired
- required Twitch scopes missing
- required EventSub subscriptions missing/revoked
- outgoing queue stuck
- app webhook queue stuck
- reward sync failing
- redemption events not received recently while stream is active
- token refresh failing
- Twitch API repeatedly returns 401/403/429/5xx
