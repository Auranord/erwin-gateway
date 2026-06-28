# erwin-gateway Codex Handoff

## Purpose

`erwin-gateway` is the central integration gateway for NTKOH apps.

The first implementation module is Twitch. The name is intentionally broader than a Twitch-specific gateway name so future modules such as Discord, YouTube, overlays, or shared notification routing can be added later without renaming the service.

## Downstream apps covered by MVP

- `erwin-hatchery`
- `erwin-music`

## Non-negotiable MVP rule

Anything currently used by `erwin-hatchery` or `erwin-music` is MVP.

Later-only means not currently used by either app.

No existing Twitch behavior may be silently deferred. If there is a technical blocker, document it clearly before changing scope.

## Which doc to read

- OpenAPI (`GET /openapi.json`, `GET /docs`, source: `../apps/api/src/modules/docs/openapi.ts`) — exact machine-readable API contract, including route paths, methods, auth schemes, parameters, and request/response summaries.
- `README.integration.md` — human-readable app integration source of truth: app authentication, bearer API keys, permission matrix, webhook raw-body signing, idempotency, Channel Point adopt/release, redemption status, payload examples, client examples, and delivery retry/dead-letter behavior.
- `05_API_CONTRACT.md` — compact endpoint inventory and API conventions; link to the integration guide instead of duplicating long examples.
- `README.migration-erwin-music.md` and `README.migration-erwin-hatchery.md` — app-specific cutover checklists, exact webhook filters, permissions, smoke tests, rollback, and domain-boundary decisions.
- `README.deployment.md` and `10_DEPLOYMENT_TRUENAS.md` — TrueNAS/runtime deployment, migrations, health checks, and operations.
- `11_SECURITY.md` — auth, secrets, admin model, and exposure boundaries.
- `04_TWITCH_AUTH_AND_SCOPES.md` / `README.twitch-auth.md` — Twitch OAuth setup and required scopes.

## Recommended reading order for Codex

1. `01_PROJECT_OVERVIEW.md`
2. `02_MVP_SCOPE_EXISTING_APPS.md`
3. `03_ARCHITECTURE.md`
4. `04_TWITCH_AUTH_AND_SCOPES.md`
5. `README.integration.md`
6. `05_API_CONTRACT.md`
7. `06_WEBHOOK_CONTRACT.md`
8. `07_DATABASE_SCHEMA.md`
9. `08_ADMIN_UI.md`
10. `09_HEALTH_SELF_HEALING.md`
11. `10_DEPLOYMENT_TRUENAS.md`
12. `11_SECURITY.md`
13. `README.migration-erwin-music.md`
14. `README.migration-erwin-hatchery.md`
15. `12_MIGRATION_GUIDES.md`
16. `13_IMPLEMENTATION_PHASES.md`
17. `14_OFFICIAL_DOCS_AND_FINAL_RULES.md`

## Naming rule

Use:

```text
erwin-gateway
```

Do not use:

```text
the Twitch-specific gateway name
```

Twitch-specific code should live under clearly named modules/packages such as:

```text
src/modules/twitch/
src/modules/apps/
src/modules/webhooks/
src/modules/admin/
```

Future integrations should fit naturally as sibling modules, for example:

```text
src/modules/discord/
```
