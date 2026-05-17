# erwin-gateway integration notes

Phase 2 exposes the app registry, app API key rotation, and the first authenticated app endpoint required before downstream apps call the gateway.

## App authentication

App-facing APIs use the contract header:

```text
Authorization: Bearer <app_api_key>
```

App API keys are generated from the admin API/UI, shown once, and never stored raw. The database stores only the key prefix and a keyed SHA-256 hash. A revoked key no longer authenticates.

## Current endpoints

- `GET /api/v1/health/live` returns a process liveness response.
- `GET /api/v1/health/ready` checks database reachability when configured.
- `GET /api/v1/me` authenticates the bearer app API key and returns app identity, API key identity, and permissions.
- `GET /api/admin/apps` lists apps, permissions, webhook placeholders, and API key metadata.
- `POST /api/admin/apps` creates an app.
- `GET /api/admin/apps/:id` returns one app.
- `PATCH /api/admin/apps/:id` updates app metadata, enabled state, permissions, and default webhook placeholders.
- `POST /api/admin/apps/:id/keys` generates an API key and returns the raw key one time.
- `DELETE /api/admin/apps/:id/keys/:keyId` revokes a key.

Admin routes accept `X-Admin-API-Key: <INTERNAL_ADMIN_API_KEY>` or `Authorization: Bearer <INTERNAL_ADMIN_API_KEY>` when `INTERNAL_ADMIN_API_KEY` is configured. If it is not configured, admin auth is intentionally open for local development only and must not be exposed publicly.

## Initial app seed

The Drizzle migration `drizzle/0001_phase_2_app_registry.sql` creates or updates the two initial app records:

### erwin-music

- `chat:messages:send`
- `chat:messages:receive`
- `chat:commands:receive`
- `streams:read`
- `logs:read_own`

### erwin-hatchery

- `chat:messages:send`
- `channel_points:rewards:read`
- `channel_points:rewards:create`
- `channel_points:rewards:update`
- `channel_points:rewards:delete`
- `channel_points:redemptions:read`
- `channel_points:redemptions:manage`
- `channel_points:events:receive`
- `subscriptions:read`
- `subscriptions:backfill`
- `bits:read`
- `bits:backfill`
- `streams:read`
- `events:receive_twitch_events`
- `logs:read_own`

Run migrations with:

```bash
npm run db:migrate
```

Then generate per-app keys from the Apps page or with `POST /api/admin/apps/:id/keys`.

Twitch transport behavior, chat send APIs, webhook delivery workers, idempotency, and Channel Point flows are implemented in later phases.
