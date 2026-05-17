# 12 Migration Guides

## erwin-music migration

Replace:

- direct IRC socket receive
- direct IRC PRIVMSG send
- direct bot OAuth refresh
- direct stream status Helix calls where applicable
- local simple text commands where desired

With:

- gateway `twitch.chat.message` webhook
- gateway `twitch.chat.command` webhook or parsed command fields
- gateway `POST /api/v1/chat/messages`
- gateway `GET /api/v1/channel/status`
- gateway Text Commands UI for simple commands like `!dc`

Keep in erwin-music:

- song queue
- vote logic
- skip/pause/resume logic
- custom music behavior
- dashboard websocket broadcast
- hype/rave overlay thresholds
- Discord live notification dispatch unless explicitly migrated later

### erwin-music commands

The gateway must deliver chat/command webhooks for:

```text
!vote
!song
!skip
!pause
!resume
```

erwin-music handles the domain behavior.

### erwin-music simple text commands

Move simple static response commands into the gateway where possible.

Examples:

```text
!dc
!discord
!youtube
!socials
!commands
!lurk
```

Gateway handles these using the Text Commands UI and outgoing chat queue.

### erwin-music chat send

Replace direct IRC send calls with:

```text
POST /api/v1/chat/messages
```

Use idempotency keys for vote announcements and timer-based messages.

### erwin-music chat receive

Replace direct IRC receive with signed app webhook:

```text
twitch.chat.message
```

The webhook payload includes:

- text
- command fields
- badges
- role booleans
- Twitch message ID
- channel
- user identity

### erwin-music stream status

Replace direct Helix stream polling with:

```text
GET /api/v1/channel/status
```

or:

```text
GET /api/v1/streams/current
```

## erwin-hatchery migration

Replace:

- broadcaster token storage and refresh
- EventSub webhook receiver
- EventSub subscription reconciliation
- direct Channel Point reward create/list/update/delete calls
- direct redemption event ingestion
- direct subscriptions backfill
- direct bits leaderboard backfill
- direct stream/profile/schedule Helix calls

With:

- gateway Channel Points APIs
- gateway signed redemption webhooks
- gateway signed subscription and bits webhooks
- gateway backfill APIs
- gateway stream/profile/schedule APIs

Keep in Hatchery:

- Hatchery economy rules
- egg grant logic
- voucher grant logic
- user inventory
- ledger
- incubation logic
- UI/game state

### Hatchery Channel Point rewards

Use:

```text
GET    /api/v1/channel-points/rewards
POST   /api/v1/channel-points/rewards
GET    /api/v1/channel-points/rewards/:rewardId
PATCH  /api/v1/channel-points/rewards/:rewardId
DELETE /api/v1/channel-points/rewards/:rewardId
POST   /api/v1/channel-points/rewards/sync
```

Gateway owns Twitch reward IDs and reward ownership.

### Hatchery redemptions

Receive signed webhooks:

```text
twitch.channel_points.custom_reward_redemption.add
twitch.channel_points.custom_reward_redemption.update
```

Hatchery must be idempotent by:

- gateway `event_id`
- Twitch redemption ID

### Hatchery redemption status update

If Hatchery grants the reward and wants to fulfill the redemption, call:

```text
PATCH /api/v1/channel-points/rewards/:rewardId/redemptions/:redemptionId/status
```

Example:

```json
{
  "status": "FULFILLED",
  "reason": "Hatchery granted the egg and wrote its ledger transaction."
}
```

Gateway must never auto-fulfill/cancel without explicit Hatchery request.

### Hatchery subscriptions

Use gateway webhooks for:

```text
twitch.channel.subscribe
twitch.channel.subscription.end
twitch.channel.subscription.message
twitch.channel.subscription.gift
```

Use backfill:

```text
POST /api/v1/subscriptions/backfill
GET  /api/v1/subscriptions
```

### Hatchery Bits

Use gateway webhook:

```text
twitch.channel.cheer
```

Use backfill:

```text
POST /api/v1/bits/backfill
GET  /api/v1/bits/leaderboard
```

### Hatchery stream/profile/schedule

Use:

```text
GET /api/v1/streams/current
GET /api/v1/channels/:channelId/profile
GET /api/v1/channels/:channelId/schedule
```

## Required docs for migration

The repo must include:

```text
README.migration-erwin-music.md
README.migration-erwin-hatchery.md
```

Each migration doc should include:

- old behavior
- new gateway endpoint/webhook
- required app permissions
- required Twitch scopes
- example request/payload
- idempotency notes
- failure/retry behavior
