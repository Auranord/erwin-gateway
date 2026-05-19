# 14 Official Docs and Final Rules

## Official docs to use during implementation

Use current official Twitch docs as source of truth during implementation:

```text
https://dev.twitch.tv/docs/chat/
https://dev.twitch.tv/docs/chat/authenticating/
https://dev.twitch.tv/docs/eventsub/handling-webhook-events/
https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/
https://dev.twitch.tv/docs/eventsub/manage-subscriptions/
https://dev.twitch.tv/docs/api/reference/
https://dev.twitch.tv/docs/authentication/scopes/
```

If Twitch docs conflict with this handoff, follow Twitch docs for protocol/API details and document the change.

## Required documentation deliverables

The repo must include strong docs.

Required docs:

```text
README.md
README.integration.md
README.deployment.md
README.twitch-auth.md
README.migration-erwin-music.md
README.migration-erwin-hatchery.md
```

At minimum, document:

- What the gateway is.
- What it owns.
- What it explicitly does not own.
- Required Twitch scopes grouped by feature.
- How to create the Twitch application.
- How to connect the bot account.
- How to connect the broadcaster account.
- How to configure TrueNAS deployment.
- How to register an app.
- How to generate and rotate an app API key.
- How to send a chat message.
- How to receive and verify app webhooks.
- How to handle idempotency.
- How to create/sync Channel Point rewards.
- How to receive redemption events.
- How Hatchery fulfills/cancels redemptions through the gateway.
- How erwin-music replaces IRC receive/send.
- How simple text commands like `!dc` are managed.
- How health checks work.
- How self-healing works.
- What to do when scopes are missing.
- What to do when EventSub subscriptions are revoked.
- What to do when webhook deliveries dead-letter.

## Final naming rules

Use:

```text
erwin-gateway
```

Do not use:

```text
the Twitch-specific gateway name
```

Use Twitch-specific names only for modules, routes, docs, and code that are actually Twitch-specific.

Examples:

```text
src/modules/twitch/
README.twitch-auth.md
/api/admin/twitch/setup/status
```

## Final MVP rule

Anything currently used by `erwin-hatchery` or `erwin-music` is MVP.

Later-only means not currently used by either app.

No existing Twitch behavior may be silently deferred.

## Final reliability rule

Do not silently drop events, chat messages, redemptions, or webhook deliveries.

If something fails permanently:

- persist a dead-letter record
- expose it in diagnostics/admin UI
- include retry where safe
- include enough context to debug without leaking secrets

## Final security rule

No secrets in logs, docs, examples, committed files, or UI output except one-time API key display during creation.

## Final app boundary rule

Gateway owns platform integration.

Downstream apps own domain logic.

Examples:

- Gateway owns Twitch chat transport.
- erwin-music owns song/vote logic.
- Gateway owns Twitch Channel Point reward API calls.
- erwin-hatchery owns egg/voucher economy logic.
- Gateway owns simple static text replies like `!dc`.
- erwin-music owns complex music commands like `!song`, `!vote`, `!skip`, `!pause`, `!resume`.
