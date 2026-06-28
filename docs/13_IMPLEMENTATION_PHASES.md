# 13 Implementation Phases

## Phase 1: Project skeleton

Implement:

- TypeScript Fastify API.
- React/Vite admin UI shell.
- Postgres and Drizzle migrations.
- Dockerfile.
- Compose example.
- Health live endpoint.
- Pino logging.
- Config validation.

Acceptance:

- Container starts locally.
- Postgres healthcheck works.
- `/api/v1/health/live` returns healthy.
- CI builds image.

## Phase 2: App model and admin UI basics

Implement:

- Apps table.
- API key creation, hashing, revoke.
- App permissions.
- Webhook endpoint config.
- Admin Apps page.

Acceptance:

- Admin can create `erwin-music` app.
- Admin can create `erwin-hatchery` app.
- Raw API key shown only once.
- App can call `/api/v1/me`.

## Phase 3: Twitch OAuth and token storage

Implement:

- Bot OAuth flow.
- Broadcaster OAuth flow.
- Encrypted token storage.
- Token refresh worker.
- Scope health checks.
- Twitch Setup page.

Acceptance:

- Bot account connected with required bot scopes.
- Broadcaster connected with required broadcaster scopes.
- Missing scope is shown as degraded.
- Tokens refresh without exposing secrets.

## Phase 4: EventSub webhook receiver

Implement:

- Public `/webhooks/twitch/eventsub` endpoint.
- Raw body signature verification.
- Challenge response.
- Notification persistence.
- Revocation handling.
- Duplicate delivery detection.
- Subscription reconciliation worker.

Acceptance:

- Twitch CLI or real Twitch setup can validate webhook callback.
- Invalid signature is rejected.
- Duplicate EventSub message ID is ignored safely.
- Revocation marks subscription unhealthy.

## Phase 5: Chat receive and webhook fanout

Implement:

- `channel.chat.message` subscription.
- Chat normalization.
- Full chat log.
- Command parsing by prefix.
- App webhook fanout.
- Webhook signing.
- Retry and dead-letter queue.

Acceptance:

- erwin-music receives chat messages via webhook.
- erwin-music receives `!vote`, `!song`, `!skip`, `!pause`, `!resume` command messages.
- Role fields include broadcaster/mod where available.
- Dashboard chat feed can be rebuilt from gateway events.

## Phase 6: Outgoing chat queue

Implement:

- `POST /api/v1/chat/messages`.
- Outgoing queue worker.
- Twitch Send Chat Message API integration.
- Rate limiting.
- Idempotency keys.
- Status endpoint.
- Outgoing Messages admin page.

Acceptance:

- erwin-music can send vote announcements.
- Hatchery can send chat messages if needed.
- Twitch message ID and drop reason are stored.
- Duplicate idempotency key does not send duplicate chat.

## Phase 7: Simple text commands

Implement:

- Text Commands admin UI.
- Text command tables.
- Cooldowns.
- Role checks.
- Reply mode.
- Outgoing chat queue integration.

Acceptance:

- Admin creates `!dc` with a Discord link.
- Viewer writes `!dc`.
- Gateway responds in chat through outgoing queue.
- Cooldown prevents spam.
- Command still fans out to apps if they subscribe to commands.

## Phase 8: Channel Points

Implement:

- Reward APIs.
- Reward ownership.
- Reward sync.
- Redemption event subscriptions.
- Redemption storage.
- Redemption webhooks.
- Redemption status update endpoint.
- Channel Points admin page.

Acceptance:

- Hatchery can create a reward through gateway.
- Hatchery can update/delete a reward it owns.
- Non-owning app cannot mutate the reward.
- Redemption event arrives in Hatchery as signed webhook.
- Duplicate redemption event does not double-grant.
- Gateway never auto-fulfills/cancels without explicit Hatchery request.

## Phase 9: Subscriptions, Bits, stream/profile/schedule

Implement:

- Subscription EventSub events.
- Subscription read endpoint backed by live EventSub state; no automatic historical backfill.
- Bits cheer events.
- Bits leaderboard read endpoint; no automatic historical backfill.
- Stream status endpoint.
- Profile endpoint.
- Schedule endpoint.

Acceptance:

- Hatchery can replace direct subscription calls.
- Hatchery can replace direct bits calls.
- Hatchery can replace direct stream/profile/schedule calls.
- erwin-music can replace direct stream status polling.

## Phase 10: Documentation and migration polish

Implement:

- OpenAPI docs.
- README docs.
- Integration examples.
- Migration guides.
- Troubleshooting section.

Acceptance:

- A new app can integrate using only docs.
- erwin-music migration path is documented.
- erwin-hatchery migration path is documented.
- Required scopes are listed by feature.
- Health/degraded states are documented.

## Required final Codex behavior

Before implementation, inspect both existing app repositories if they are available in the workspace.

Produce a short feature inventory update before coding. If the inspection finds an additional Twitch function used by either app, add it to MVP unless there is a documented technical blocker.

Then implement in phases.

Do not claim completion until:

- Dev image builds.
- Migrations run.
- Health endpoints work.
- Admin UI exists.
- App API key flow works.
- Twitch setup flow exists.
- EventSub webhook receiver verifies signatures.
- Chat receive/send works.
- Simple text commands work.
- Channel Point reward management works.
- Channel Point redemption webhooks work.
- erwin-music migration docs exist.
- erwin-hatchery migration docs exist.
- OpenAPI docs exist.
