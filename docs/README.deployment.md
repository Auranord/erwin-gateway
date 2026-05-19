# erwin-gateway deployment

Use `docker-compose.example.yml` as the starting point for TrueNAS Scale or any Docker-compatible host.

## Required components

- `ghcr.io/auranord/erwin-gateway:dev` for dev or `ghcr.io/auranord/erwin-gateway:main` for stable deployments.
- `postgres:16-alpine` with persistent storage.
- A public HTTPS reverse proxy URL for Twitch EventSub callbacks.
- Secrets stored outside git, preferably TrueNAS secrets or Bitwarden.

## Required environment

Copy `.env.example` and set at least:

- `DATABASE_URL`
- `PUBLIC_APP_URL` or `PUBLIC_API_URL`
- `TWITCH_EVENTSUB_CALLBACK_URL=https://<public-host>/webhooks/twitch/eventsub`
- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `TWITCH_EVENTSUB_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `API_KEY_PEPPER`
- `SESSION_SECRET`
- `INTERNAL_ADMIN_API_KEY`
- `CORS_ORIGIN`

Never commit real values. Do not expose admin routes without `INTERNAL_ADMIN_API_KEY`.

## Migrations

Run migrations before starting a new image or as a one-shot admin task:

```bash
npm run db:migrate
```

For TrueNAS SCALE / Compose deployments, prefer an automatic one-shot `migrate` service that runs before `api`, using:

- `depends_on.postgres.condition: service_healthy` on `migrate`
- `depends_on.migrate.condition: service_completed_successfully` on `api`

This ensures first boot after a fresh Postgres volume applies schema before readiness checks and worker startup.

The MVP migrations create app registry, hashed API keys, Twitch OAuth/token tables, EventSub tables, chat/webhook tables, outgoing chat queue, text commands, Channel Point tables, subscriptions, Bits, stream/profile/schedule cache, diagnostics, and idempotency records.

## Health endpoints

Configure container/reverse-proxy health checks with:

```text
GET /api/v1/health/live
GET /api/v1/health/ready
GET /api/v1/health/deep
```

- `live` should stay `200` unless the process is wedged.
- `ready` returns `503` when database or Twitch readiness is degraded.
- `deep` returns detailed diagnostics for missing scopes, EventSub subscription drift/revocations, queue depth, dead letters, Channel Point reward sync, and Twitch data backfills.

## First-run setup

1. Deploy Postgres, `migrate`, and the gateway container.
2. Confirm `migrate` exits successfully.
3. Open the admin UI.
4. Connect the Twitch bot account.
5. Connect the Twitch broadcaster account.
6. Confirm `GET /api/v1/health/deep` is healthy or review missing scopes.
7. Sync EventSub subscriptions from the admin UI.
8. Register or confirm `erwin-music` and `erwin-hatchery` app records.
9. Generate app API keys and webhook secrets; store them in each downstream app's secret manager.
10. Send a webhook test delivery to each app.

## Operations

- EventSub revocations appear in deep health and admin diagnostics. Fix scopes/callback URL and run EventSub sync.
- Webhook dead letters mean a downstream receiver did not accept delivery after retries. Fix the receiver and retry from admin diagnostics.
- Outgoing chat dead letters mean Twitch rejected or could not accept the message after retries. Inspect status and response excerpts in the admin UI.
- Missing scopes degrade health. Re-run the correct bot or broadcaster OAuth flow after updating the Twitch app/scopes.
