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
name: erwin-gateway-dev

networks:
  erwin_internal_test:
    name: erwin_internal_test

services:
  api:
    image: ghcr.io/auranord/erwin-gateway:dev
    container_name: erwin-gateway-api-dev
    restart: unless-stopped
    pull_policy: always
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NODE_ENV: production
      TZ: Europe/Berlin
      HOST: 0.0.0.0
      PORT: 3000
      DATABASE_URL: postgres://erwin_gateway:CHANGE_ME@postgres:5432/erwin_gateway
      PUBLIC_APP_URL: https://gateway.example.com
      PUBLIC_API_URL: https://gateway.example.com
      TWITCH_EVENTSUB_CALLBACK_URL: https://gateway.example.com/webhooks/twitch/eventsub
      CORS_ORIGIN: https://gateway.example.com
      SESSION_SECRET: CHANGE_ME
      TOKEN_ENCRYPTION_KEY: CHANGE_ME_32_BYTES_MIN
      API_KEY_PEPPER: CHANGE_ME
      INTERNAL_ADMIN_API_KEY: CHANGE_ME
      TWITCH_CLIENT_ID: CHANGE_ME
      TWITCH_CLIENT_SECRET: CHANGE_ME
      TWITCH_EVENTSUB_SECRET: CHANGE_ME
      TWITCH_BOT_LOGIN: CHANGE_ME
      TWITCH_BOT_USER_ID: CHANGE_ME
      TWITCH_BROADCASTER_ID: "53471337"
      TWITCH_CHANNEL_LOGIN: ntkoh
      LOG_HEALTHCHECK_REQUESTS: "false"
    networks:
      - erwin_internal_test
    ports:
      - "3030:3000"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/v1/health/ready"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
    volumes:
      - /mnt/fast/config/erwin-gateway-dev/logs:/app/logs

  postgres:
    image: postgres:16-alpine
    container_name: erwin-gateway-postgres-dev
    restart: unless-stopped
    pull_policy: always
    environment:
      POSTGRES_DB: erwin_gateway
      POSTGRES_USER: erwin_gateway
      POSTGRES_PASSWORD: CHANGE_ME
    networks:
      - erwin_internal_test
    volumes:
      - /mnt/fast/config/erwin-gateway-dev/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U erwin_gateway -d erwin_gateway"]
      interval: 10s
      timeout: 5s
      retries: 10
```

Adminer is optional and should not be included by default because this service stores sensitive Twitch token material.

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
/mnt/fast/config/erwin-gateway-dev/postgres
/mnt/fast/config/erwin-gateway-dev/logs
```

Adjust paths as needed for the final TrueNAS setup.
