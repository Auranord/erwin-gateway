# 10 TrueNAS SCALE Deployment

## Requirements

Provide:

- `Dockerfile`
- `.dockerignore`
- `.env.example`
- `truenas-deployment.yml`
- GHCR workflow for `dev` and `main`
- Healthcheck compatible with wget/curl
- Persistent Postgres volume
- Optional logs volume
- One-shot `migrate` service that runs before API startup

## Environment variables

```text
NODE_ENV=production
TZ=Europe/Berlin
HOST=0.0.0.0
PORT=3000
DATABASE_URL=postgres://...
PUBLIC_APP_URL=https://gateway.example.com
PUBLIC_API_URL=https://gateway.example.com
TWITCH_EVENTSUB_CALLBACK_URL=https://gateway.example.com/webhooks/twitch/eventsub
CORS_ORIGIN=https://gateway.example.com
SESSION_SECRET=...
TOKEN_ENCRYPTION_KEY=...
API_KEY_PEPPER=...
INTERNAL_ADMIN_API_KEY=...
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
TWITCH_EVENTSUB_SECRET=...
TWITCH_BOT_LOGIN=...
TWITCH_BOT_USER_ID=...
TWITCH_BROADCASTER_ID=...
TWITCH_CHANNEL_LOGIN=...
LOG_HEALTHCHECK_REQUESTS=false
```

## TrueNAS deployment file shape

```yaml
services:
  erwin-gateway:
    image: ghcr.io/auranord/erwin-gateway:main
    container_name: erwin-gateway
    restart: unless-stopped
    pull_policy: always
    ports:
      - "3100:3000"
    environment:
      NODE_ENV: production
      TZ: Europe/Berlin
      HOST: 0.0.0.0
      PORT: 3000
      DATABASE_URL: postgres://erwin_gateway:CHANGE_ME@postgres:5432/erwin_gateway
      PUBLIC_APP_URL: https://erwin-gateway.example.com
      PUBLIC_API_URL: https://erwin-gateway.example.com
      TWITCH_EVENTSUB_CALLBACK_URL: https://erwin-gateway.example.com/webhooks/twitch/eventsub
      CORS_ORIGIN: https://erwin-gateway.example.com
      SESSION_SECRET: CHANGE_ME
      TOKEN_ENCRYPTION_KEY: CHANGE_ME
      API_KEY_PEPPER: CHANGE_ME
      INTERNAL_ADMIN_API_KEY: CHANGE_ME
      TWITCH_CLIENT_ID: CHANGE_ME
      TWITCH_CLIENT_SECRET: CHANGE_ME
      TWITCH_EVENTSUB_SECRET: CHANGE_ME
      TWITCH_BOT_LOGIN: CHANGE_ME
      TWITCH_BOT_USER_ID: CHANGE_ME
      TWITCH_BROADCASTER_ID: CHANGE_ME
      TWITCH_CHANNEL_LOGIN: CHANGE_ME
      LOG_HEALTHCHECK_REQUESTS: "false"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 20s
    depends_on:
      postgres:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    command: ["node", "apps/api/dist/server.js"]
    volumes:
      - /mnt/fast/config/erwin-gateway/logs:/app/logs

  migrate:
    image: ghcr.io/auranord/erwin-gateway:main
    container_name: erwin-gateway-migrate
    restart: "no"
    pull_policy: always
    environment:
      NODE_ENV: production
      TZ: Europe/Berlin
      DATABASE_URL: postgres://erwin_gateway:CHANGE_ME@postgres:5432/erwin_gateway
    depends_on:
      postgres:
        condition: service_healthy
    command: ["npm", "run", "db:migrate"]

  postgres:
    image: postgres:16-alpine
    container_name: erwin-gateway-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: erwin_gateway
      POSTGRES_USER: erwin_gateway
      POSTGRES_PASSWORD: CHANGE_ME
    volumes:
      - /mnt/fast/config/erwin-gateway/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U erwin_gateway -d erwin_gateway"]
      interval: 10s
      timeout: 5s
      retries: 10
```

## Migration behavior

Production migration command:

`npm run db:migrate` → `node apps/api/dist/db/migrate.js`

Development migration command:

`npm run db:migrate:dev` → `drizzle-kit migrate --config drizzle.config.ts`

The `migrate` service runs once and exits. The API container never runs `drizzle-kit` at startup.

## Troubleshooting

- **`relation "twitch_accounts" does not exist`**
  - Cause: schema was not migrated yet.
  - Fix: `docker compose run --rm migrate`, then verify `psql -d erwin_gateway -c '\dt'` includes gateway tables.

- **Migrations missing in container**
  - Cause: image does not include `drizzle/` or compiled migration runner.
  - Fix: rebuild and publish image, then verify files exist in container (`/app/drizzle`, `/app/apps/api/dist/db/migrate.js`).

- **`migrate` service failed**
  - Check logs: `docker compose logs migrate`.
  - Common causes: wrong `DATABASE_URL`, Postgres not healthy, or DB credentials mismatch.

- **API waiting for migrations**
  - `erwin-gateway` depends on `migrate: service_completed_successfully`.
  - If API does not start, inspect `docker compose ps` and `docker compose logs migrate` first.

## Image tags

Use only:

```text
ghcr.io/auranord/erwin-gateway:dev
ghcr.io/auranord/erwin-gateway:main
```

## Public endpoint requirement

Twitch EventSub Webhooks require a public HTTPS callback.

The gateway must be reachable at:

```text
TWITCH_EVENTSUB_CALLBACK_URL=https://gateway.example.com/webhooks/twitch/eventsub
```

Internal app APIs can remain private or protected, but the Twitch callback must be reachable by Twitch.

## Volumes

Recommended persistent paths:

```text
/mnt/fast/config/erwin-gateway/postgres
/mnt/fast/config/erwin-gateway/logs
```

Adjust paths as needed for the final TrueNAS setup.
