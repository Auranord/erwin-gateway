# 01 Project Overview

## Task for Codex

Create a new internal service called `erwin-gateway`.

This service centralizes Twitch chat, Twitch EventSub, Twitch API access, bot identity, Channel Points, stream status, and app-facing Twitch webhooks for two existing downstream apps:

- `erwin-hatchery`
- `erwin-music`

Do not split Twitch bot behavior across multiple app-specific bots anymore. The gateway is the single Twitch integration boundary.

Downstream apps must stop owning Twitch bot connections, Twitch EventSub subscriptions, Twitch reward management, and Twitch token refresh where those functions are moved into this gateway.

This is a new repository and container, not a patch inside either existing app.

## Why the app is named erwin-gateway

The first implementation scope is Twitch, but the service should be named `erwin-gateway` because it may later centralize other integration functions, such as:

- Discord support
- YouTube support
- shared notification routing
- shared auth/session bridges
- shared overlay/event routing
- future platform integrations

Keep Twitch code modular so the service does not become hard-coded as “Twitch only”.

## Primary project goal

Build `erwin-gateway` as the central integration service for NTKOH apps.

The gateway must:

- Own the dedicated Twitch bot identity.
- Support proper Twitch Chat Bot Badge behavior.
- Receive Twitch chat and EventSub events.
- Send Twitch chat messages through the Twitch Send Chat Message API.
- Manage Twitch OAuth grants and token refresh.
- Manage Channel Point custom rewards for Hatchery.
- Fan out signed webhooks to downstream apps.
- Expose secure internal APIs for downstream apps.
- Provide a simple admin web UI.
- Provide strong health checks, diagnostics, self-healing routines, and generated API documentation.
- Run as a TrueNAS Scale compatible container stack with Postgres.

## Preferred technical stack

Use the newer Hatchery-style stack as the default pattern:

- TypeScript
- Node.js 22 LTS
- Fastify API
- React/Vite admin UI
- Postgres 16
- Drizzle ORM and migrations
- Zod for request/response validation
- Pino structured logging
- Native fetch or undici for Twitch API calls
- Docker image published to GHCR
- Branch/image tags: `dev` and `main` only

Do not use SQLite for the gateway.

Do not use IRC as the primary Twitch integration.

## Repository shape suggestion

```text
erwin-gateway/
  apps/
    api/
    web/
  packages/
    shared/
  docs/
  docker/
  README.md
  README.integration.md
  README.deployment.md
```

Alternative monorepo layouts are fine if they remain simple and well documented.

## Suggested module shape

```text
src/modules/apps/
src/modules/auth/
src/modules/twitch/
src/modules/twitch-chat/
src/modules/twitch-eventsub/
src/modules/twitch-channel-points/
src/modules/twitch-subscriptions/
src/modules/twitch-bits/
src/modules/text-commands/
src/modules/webhooks/
src/modules/health/
src/modules/admin/
```

Future modules should be able to fit next to Twitch modules, for example:

```text
src/modules/discord/
```

## Explicit non-goals for first version

Do not implement unless needed for current app migration:

- Public SaaS multi-tenant support.
- Multiple active Twitch channels at runtime.
- Twitch Extensions.
- Full moderation actions like ban, timeout, blocked terms, announcements.
- Poll/prediction management.
- Raid automation.
- Clip creation.
- Stream marker creation.
- Discord posting inside the gateway.
- Hatchery economy logic.
- Music queue or vote logic.
- Arbitrary scripting for custom commands.
- IRC fallback unless source inspection proves a currently used feature cannot be supported via EventSub/API.

Schema should be multi-channel-ready, but MVP only needs one active channel.
