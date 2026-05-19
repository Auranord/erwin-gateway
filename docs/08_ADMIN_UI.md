# 08 Admin UI

The UI can be simple, but it must exist in MVP.

## Pages

### Dashboard

Show:

- Overall status.
- Bot account.
- Broadcaster account.
- Active channel.
- EventSub status.
- Queue depths.
- Last received chat message.
- Last sent chat message.
- Last redemption event.
- Last reward sync.
- Missing scopes.

### Twitch Setup

Show:

- Bot OAuth status.
- Broadcaster OAuth status.
- Granted scopes.
- Required scopes.
- Missing scopes.
- Token expiry.
- Buttons for:
  - bot login
  - broadcaster login
  - token refresh
  - EventSub sync

### Apps

Show:

- Registered apps.
- Enabled/disabled state.
- Permissions.
- API key rotation.
- Webhook URL.
- Webhook secret rotation.
- Event filters.
- Send test webhook.

### Text Commands

Manage simple static replies like `!dc`.

Must include:

- command
- aliases
- response text
- enabled
- required role
- cooldown
- user cooldown
- reply mode
- usage count
- last used
- test button

Text command behavior:

- static text only
- no arbitrary scripts
- no database-query templates
- safe placeholders only:
  - `{user}`
  - `{displayName}`
  - `{channel}`

### Chat Log

Show:

- Searchable chat messages.
- Command-only filter.
- User filter.
- Event type filter.
- Moderation delete/clear markers if available.

### Outgoing Messages

Show:

- queued
- sent
- dropped
- failed
- dead-lettered
- Twitch drop reason
- retry button where safe

### Webhook Deliveries

Show:

- app
- event
- delivery status
- attempts
- response excerpts
- next retry
- dead-letter state
- manual retry

### Channel Points

Show:

- reward list
- owning app
- manageable state
- sync from Twitch
- create/update controls
- delete control with confirmation
- recent redemptions
- redemption status
- delivery state to apps

### Diagnostics

Show:

- EventSub reconciliation result.
- Token refresh result.
- Rate limits.
- Scope problems.
- Queue watchdog state.
- Build metadata.
- Recent diagnostic events.

### Docs

Expose OpenAPI docs and integration examples.

## Admin authentication

Admin routes may be protected by local admin session, reverse proxy auth, or a strong admin API key in MVP.

Do not expose admin routes publicly without auth.

## UX priority

The admin UI can be basic but should make operational state obvious.

Important admin UI question:

```text
Is the gateway healthy enough that my downstream apps can trust it right now?
```

The UI should answer that quickly.
