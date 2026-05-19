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

## Recommended reading order for Codex

1. `01_PROJECT_OVERVIEW.md`
2. `02_MVP_SCOPE_EXISTING_APPS.md`
3. `03_ARCHITECTURE.md`
4. `04_TWITCH_AUTH_AND_SCOPES.md`
5. `05_API_CONTRACT.md`
6. `06_WEBHOOK_CONTRACT.md`
7. `07_DATABASE_SCHEMA.md`
8. `08_ADMIN_UI.md`
9. `09_HEALTH_SELF_HEALING.md`
10. `10_DEPLOYMENT_TRUENAS.md`
11. `11_SECURITY.md`
12. `12_MIGRATION_GUIDES.md`
13. `13_IMPLEMENTATION_PHASES.md`
14. `14_OFFICIAL_DOCS_AND_FINAL_RULES.md`

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
