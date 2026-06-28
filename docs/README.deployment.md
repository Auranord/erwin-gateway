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

## Admin UI and admin API protection

The current MVP admin model requires an internal admin API key plus a deployment boundary:

- `INTERNAL_ADMIN_API_KEY` must be set to a strong secret for admin routes.
- Admin API clients can authenticate with `X-Admin-API-Key: <key>` or `Authorization: Bearer <key>`.
- Twitch OAuth callback routes are the only `/api/admin/twitch/*/callback` exception, so `GET /api/admin/twitch/bot/callback` and `GET /api/admin/twitch/broadcaster/callback` can complete Twitch browser redirects.
- The admin UI must not be exposed publicly unless a reverse proxy, VPN, private network, SSO/basic-auth layer, IP allowlist, or equivalent network boundary protects it.

The production API container also serves the built admin UI bundle. Browser entry points are:

- `GET /`
- `GET /admin`
- `GET /admin/*` (SPA fallback to `index.html`)

API and webhook routes continue to return JSON responses (`/api/*`, `/webhooks/*`) and are not SPA-fallback routes.

## Expected TrueNAS/reverse proxy setup

- Store `INTERNAL_ADMIN_API_KEY` and all Twitch/database/token secrets in TrueNAS secrets or another secret manager, not in git.
- Route public HTTPS traffic for Twitch to the gateway only for the required callback surfaces:
  - `POST /webhooks/twitch/eventsub`
  - `GET /api/admin/twitch/bot/callback`
  - `GET /api/admin/twitch/broadcaster/callback`
  - `GET /api/v1/twitch/oauth/bot/callback` if that compatibility route is configured in Twitch
  - `GET /api/v1/twitch/oauth/broadcaster/callback` if that compatibility route is configured in Twitch
- Keep `/`, `/admin`, `/admin/*`, and general `/api/admin/*` access on a private LAN/VPN or require reverse-proxy authentication before forwarding to the gateway.
- Configure forwarded host/proto headers so the gateway's public URLs match `PUBLIC_APP_URL`/`PUBLIC_API_URL` and `TWITCH_EVENTSUB_CALLBACK_URL`.
- Limit CORS with `CORS_ORIGIN` to the trusted admin/app origins that need browser access.

## First-run setup

1. Deploy using `truenas-deployment.yml`.
2. Confirm `migrate` completed successfully.
3. Start `erwin-gateway`.
4. Open admin UI and complete Twitch bot/broadcaster OAuth.
5. Validate deep health and EventSub sync.
