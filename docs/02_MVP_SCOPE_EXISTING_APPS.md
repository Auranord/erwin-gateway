# 02 MVP Scope for Existing Apps

## Non-negotiable MVP rule

Anything currently used by `erwin-hatchery` or `erwin-music` is MVP.

Later-only means not currently used by either app.

No existing Twitch behavior may be silently deferred. If there is a technical blocker, document it clearly before changing scope.

The gateway MVP is migration-complete for the two existing apps, not minimal chat-only infrastructure.

## Naming correction and downstream app roles

There are two separate apps:

### erwin-hatchery

Hatchery app. Twitch dependencies include:

- Channel Point custom rewards
- custom reward redemptions
- subscriptions
- bits
- stream state
- broadcaster profile
- schedule
- broadcaster setup

### erwin-music

Music app. Twitch dependencies include:

- chat receive
- chat send
- commands
- custom text command responses
- dashboard chat feed
- hype overlay triggers
- vote announcements
- stream status
- Discord live notification triggers
- bot token refresh migration
- role detection for mod/broadcaster-only commands

Do not merge these app scopes. The gateway serves both as separate clients.

## Shared gateway features required in MVP

MVP must include:

- Twitch OAuth setup for bot account.
- Twitch OAuth setup for broadcaster account.
- Token refresh before expiry.
- Recovery on Twitch 401 where safe.
- Scope validation.
- EventSub subscription reconciliation.
- Raw Twitch EventSub ingestion.
- EventSub signature verification.
- EventSub challenge response.
- EventSub revocation handling.
- Duplicate EventSub delivery detection.
- Full chat/event log.
- Signed app webhook delivery.
- Webhook retry and dead-letter handling.
- App registration and API key management.
- Simple admin UI.
- Generated OpenAPI docs.

## erwin-music MVP coverage

The gateway must support the following current music app functions:

- Receive Twitch chat messages.
- Send bot chat messages.
- Receive command messages such as `!vote`, `!song`, `!skip`, `!pause`, `!resume`.
- Preserve mod/broadcaster role detection for privileged commands.
- Support dashboard live chat feed by delivering chat events to erwin-music.
- Support hype/rave overlay triggers by delivering chat messages reliably.
- Support custom text command replies like `!dc` for Discord links.
- Support local music-domain command handling by erwin-music through webhook events.
- Support start/end vote announcements through the gateway chat-send API.
- Replace direct IRC socket behavior.
- Replace direct IRC PRIVMSG send behavior.
- Replace direct Twitch bot token refresh where possible.
- Provide stream status for live notification logic.

Important boundary:

- The gateway should own simple text response commands.
- erwin-music should keep music-domain logic, such as voting, song queue, skip/pause/resume rules, hype thresholds, dashboard broadcasting, and Discord notification dispatch.

## erwin-hatchery MVP coverage

The gateway must support the following current Hatchery Twitch functions:

- Broadcaster OAuth setup and token refresh.
- EventSub webhook subscription reconciliation.
- Channel Point custom reward create.
- Channel Point custom reward list/sync, including manageable rewards.
- Channel Point custom reward update.
- Channel Point custom reward delete for inactive mapped rewards.
- Channel Point custom reward redemption add events.
- Channel Point custom reward redemption update events.
- Get/list custom reward redemptions for recovery and admin diagnostics.
- Redemption status update endpoint for fulfill/cancel when Hatchery requests it.
- Subscriber events:
  - `channel.subscribe`
  - `channel.subscription.end`
  - `channel.subscription.message`
  - `channel.subscription.gift`
- Active subscription backfill through Helix subscriptions API.
- Bits cheer event ingestion through EventSub `channel.cheer`.
- Bits leaderboard baseline backfill.
- Stream live state and viewer count for incubation multiplier.
- Public broadcaster profile for stream panel.
- Public schedule panel data.

Important boundary:

- Hatchery economy logic remains in Hatchery.
- Hatchery grants eggs, vouchers, ledger entries, and user inventory changes.
- The gateway only delivers Twitch events and performs Twitch API operations.
- The gateway must never automatically fulfill or cancel Channel Point redemptions unless Hatchery explicitly requests it through the gateway API.

## Simple text response commands

Add gateway-owned simple command responses to MVP.

Purpose:

Move simple Twitch chat replies like `!dc`, `!discord`, `!youtube`, `!socials`, `!commands`, or `!lurk` out of erwin-music and into the gateway.

This is not a full bot framework. It is only static text reply commands.

### Admin UI requirements

Add a `Text Commands` page or section in the admin UI.

Admin must be able to:

- Create a command.
- Edit a command.
- Enable or disable a command.
- Delete or archive a command.
- Set command name, for example `dc`.
- Set command aliases, for example `discord`.
- Set command prefix, default `!`.
- Set plain text response.
- Set cooldown seconds.
- Set user cooldown seconds.
- Set required role:
  - everyone
  - subscriber
  - vip
  - moderator
  - broadcaster
- Set whether the reply should be a normal message or a reply to the triggering chat message.
- Send a test command response.
- See last used timestamp and usage count.

### Text command behavior

When a Twitch chat message starts with the configured command symbol:

1. Gateway logs the chat message.
2. Gateway normalizes and fans out the command webhook to apps.
3. Gateway checks if a matching enabled text command exists.
4. If found and cooldown/role checks pass, gateway enqueues the configured text response through the same outgoing chat queue used by apps.
5. If multiple aliases match the same command, use the canonical command record.
6. Do not execute arbitrary code.
7. Do not support dynamic templates in MVP except optional safe placeholders listed below.

Safe placeholders allowed in MVP:

```text
{user}
{displayName}
{channel}
```

Do not allow arbitrary JavaScript or database queries in command text.
