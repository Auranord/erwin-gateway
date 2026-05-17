# erwin-gateway integration notes

Phase 1 exposes only the service foundation and health endpoint. Downstream app registration, API keys, chat message APIs, webhooks, idempotency, and Channel Point flows are planned for later phases.

Current endpoint:

- `GET /api/v1/health/live` returns a process liveness response.

No Twitch transport behavior is implemented in phase 1.
