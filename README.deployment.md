# erwin-gateway deployment

Use `docker-compose.example.yml` as the starting point for TrueNAS Scale deployments.

Required deployment components:

- `ghcr.io/auranord/erwin-gateway:dev` or `ghcr.io/auranord/erwin-gateway:main`
- `postgres:16-alpine`
- persistent Postgres storage
- environment variables copied from `.env.example` and replaced with real values outside git

The liveness health check is:

```text
GET /api/v1/health/live
```

Twitch EventSub requires a public HTTPS callback URL in later phases:

```text
TWITCH_EVENTSUB_CALLBACK_URL=https://gateway.example.com/webhooks/twitch/eventsub
```
