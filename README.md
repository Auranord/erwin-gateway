# erwin-gateway

`erwin-gateway` is the central integration gateway for NTKOH apps. Twitch is the first module, but the service is intentionally named and structured so future modules such as Discord can be added without renaming the app.

Phase 1 builds the boring foundation only:

- TypeScript Fastify API
- React/Vite admin UI shell
- Postgres 16 deployment shape
- Drizzle schema and migrations
- Zod environment validation
- Pino structured logging with secret redaction
- Docker, compose, and GHCR workflow scaffolding
- `/api/v1/health/live`

Twitch behavior is not implemented in phase 1.

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy local environment settings:

   ```bash
   cp .env.example .env
   ```

3. Start the API:

   ```bash
   npm run dev:api
   ```

4. In another terminal, start the admin UI dev server:

   ```bash
   npm run dev:web
   ```

5. Open:

   - Admin UI: <http://localhost:5173>
   - API health: <http://localhost:3000/api/v1/health/live>

## Checks

```bash
npm run typecheck
npm run build
docker build -t erwin-gateway:local .
```

## Docker compose

`docker-compose.example.yml` contains the TrueNAS-style stack with:

- `ghcr.io/auranord/erwin-gateway:dev`
- `postgres:16-alpine`
- a persistent Postgres volume
- an optional logs volume
- container health checks

Copy the example and replace every `CHANGE_ME` value before deployment. Do not commit real secrets.

## Migrations

Drizzle configuration lives in `drizzle.config.ts`. Phase 1 includes the first foundation migration in `drizzle/`.

```bash
npm run db:generate
npm run db:migrate
```

## Naming

Use `erwin-gateway` for the service and image names. Twitch-specific code belongs under Twitch-specific modules; the gateway service name remains `erwin-gateway`.
