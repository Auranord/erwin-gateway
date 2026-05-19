# erwin-gateway TrueNAS SCALE deployment

Use `truenas-deployment.yml` as the single production deployment file for TrueNAS SCALE.

## Required components

- `ghcr.io/auranord/erwin-gateway:main`
- `postgres:16-alpine` with persistent storage
- Public HTTPS URL for Twitch EventSub callbacks
- Secrets managed outside git (TrueNAS secrets or equivalent)

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

## Migrations

The deployment uses a one-shot `migrate` service:

- Runs `npm run db:migrate` once.
- Prints `Running migrations...` and `Migrations completed successfully` on success.
- Exits non-zero on failure.
- API waits for `migrate` with `service_completed_successfully` before startup.

Do not run migrations inside the API startup command.

## Health endpoints

Use:

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`
- `GET /api/v1/health/deep`

## First-run setup

1. Deploy using `truenas-deployment.yml`.
2. Confirm `migrate` completed successfully.
3. Start `erwin-gateway`.
4. Open admin UI and complete Twitch bot/broadcaster OAuth.
5. Validate deep health and EventSub sync.
