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

## Which doc to read

- OpenAPI (`GET /openapi.json`, `GET /docs`, source: `apps/api/src/modules/docs/openapi.ts`) — exact route contract, auth schemes, parameters, and request/response summaries.
- `docs/README.integration.md` — app integration source of truth: app registration, bearer API keys, permissions, webhook signing, idempotency, Channel Point adopt/release, redemption status, payload examples, client examples, and delivery retry/dead-letter behavior.
- `docs/05_API_CONTRACT.md` — compact endpoint inventory and API conventions.
- `docs/README.migration-erwin-music.md` — `erwin-music` cutover checklist, exact event filters, smoke tests, rollback, and app-specific domain boundaries.
- `docs/README.migration-erwin-hatchery.md` — Hatchery cutover checklist, exact event filters, reward adoption decisions, smoke tests, rollback, and app-specific domain boundaries.
- `docs/README.deployment.md` / `docs/10_DEPLOYMENT_TRUENAS.md` — TrueNAS/runtime deployment, health checks, migrations, and operations.
- `docs/11_SECURITY.md` — auth, secrets, admin boundary, and security model.
- `docs/README.twitch-auth.md` / `docs/04_TWITCH_AUTH_AND_SCOPES.md` — Twitch app setup, bot/broadcaster OAuth, required scopes, and EventSub callback requirements.
- `truenas-deployment.yml` — production TrueNAS SCALE deployment file.

## Naming

Use `erwin-gateway` for the service, image, package names, and documentation. Twitch-specific code belongs under Twitch-specific modules; the gateway service name remains `erwin-gateway` so future modules can be added without a rename.
