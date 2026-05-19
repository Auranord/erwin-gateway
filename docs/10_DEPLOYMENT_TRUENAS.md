# 10 TrueNAS / Compose Deployment

## Requirements

Provide:

- `Dockerfile`
- `.dockerignore`
- `.env.example`
- `docker-compose.example.yml`
- GHCR workflow for `dev` and `main`
- Healthcheck compatible with wget/curl
- Persistent Postgres volume
- Optional logs volume

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

## Compose example shape

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
    command: ["sh", "-lc", "npm run db:migrate && node apps/api/dist/server.js"]
    volumes:
      - /mnt/fast/config/erwin-gateway/logs:/app/logs

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

Adminer is optional and should not be included by default because this service stores sensitive Twitch token material.

## Automatic migrations on deploy

TrueNAS SCALE Compose should run migrations automatically in the API startup command:

`command: ["sh", "-lc", "npm run db:migrate && node apps/api/dist/server.js"]`

If `db:migrate` fails, the API process does not start; fix the migration error and redeploy.

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
