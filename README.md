# erwin-gateway

`erwin-gateway` is the central integration gateway for NTKOH apps. Twitch is the first production module: the gateway owns Twitch OAuth, token refresh, EventSub ingestion, chat receive/send, Channel Point rewards/redemptions, subscription/Bits events, stream/profile/schedule reads, app-facing webhooks, health diagnostics, and the admin UI.

Downstream apps keep their domain logic:

- `erwin-music` owns song queues, votes, skip/pause/resume behavior, dashboard overlays, and Discord notification behavior.
- `erwin-hatchery` owns egg/voucher economy behavior and decides when redemptions are fulfilled or canceled.

The gateway does **not** own music queue logic, Hatchery economy logic, Discord posting, public SaaS tenancy, Twitch moderation actions, polls/predictions, raids, clips, markers, or arbitrary command scripting.

## MVP capabilities

- Fastify API, React/Vite admin UI, Postgres 16, Drizzle migrations, Zod validation, and Pino logging with redaction.
- Admin app registration, hashed app API keys, key revocation, app permissions, and webhook endpoint configuration.
- Twitch bot and broadcaster OAuth setup with encrypted token storage, refresh, and required-scope health checks.
- Twitch EventSub receiver at `POST /webhooks/twitch/eventsub` with raw-body signature verification, challenge handling, revocation handling, duplicate detection, and diagnostics.
- Chat receive normalization, command parsing, chat log storage, signed webhook fanout, retry, and dead-letter tracking.
- Outgoing chat queue through `POST /api/v1/chat/messages` using the Twitch Send Chat Message API and idempotency keys.
- Simple static text commands such as `!dc` with role checks, global/user cooldowns, and chat replies.
- Channel Point reward ownership, reward sync, redemption webhooks, and explicit fulfill/cancel APIs.
- Subscription, Bits, stream status, broadcaster profile, and schedule support.
- Generated API docs at `GET /openapi.json` and `GET /docs`.
- Health endpoints at `GET /api/v1/health/live`, `GET /api/v1/health/ready`, and `GET /api/v1/health/deep`.

## Local development

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev:api
npm run dev:web
```

Open:

- Admin UI: <http://localhost:5173>
- API health: <http://localhost:3000/api/v1/health/live>
- OpenAPI JSON: <http://localhost:3000/openapi.json>
- API docs: <http://localhost:3000/docs>

Admin API routes are protected by `INTERNAL_ADMIN_API_KEY`. Send it as `X-Admin-API-Key` or `Authorization: Bearer` when calling `/api/admin/*`.

## Checks

```bash
npm run typecheck
npm test
npm run build
docker build -t erwin-gateway:local .
```

## Deployment and migration docs

- `README.deployment.md` — TrueNAS/container deployment, migrations, health checks, and operations.
- `README.integration.md` — registering apps, creating API keys, calling app APIs, webhook verification, idempotency, and retry/dead-letter behavior.
- `README.twitch-auth.md` — Twitch app setup, bot/broadcaster OAuth, exact scopes by feature, and EventSub callback requirements.
- `README.migration-erwin-music.md` — replacing IRC receive/send, music command intake, simple commands, and stream polling.
- `README.migration-erwin-hatchery.md` — replacing rewards, redemptions, subscriptions, Bits, stream/profile/schedule calls.

## Naming

Use `erwin-gateway` for the service, image, package names, and documentation. Twitch-specific code belongs under Twitch-specific modules; the gateway service name remains `erwin-gateway` so future modules can be added without a rename.
