# 04 Twitch Auth and Scopes

## Dedicated bot account

Use a dedicated bot Twitch account. The bot account must not be the broadcaster account.

Required bot user authorization scopes:

```text
user:read:chat
user:write:chat
user:bot
```

Purpose:

- `user:read:chat`: read chat as the bot.
- `user:write:chat`: send chat as the bot.
- `user:bot`: allow this user to be used as a bot for EventSub and chat behavior.

## Broadcaster account

The broadcaster/channel owner must authorize the same Twitch application.

Required broadcaster authorization scopes for MVP:

```text
channel:bot
channel:manage:redemptions
channel:read:redemptions
channel:read:subscriptions
bits:read
```

Notes:

- `channel:bot` is required for the cloud chatbot model and proper bot identity.
- `channel:manage:redemptions` is required because Hatchery creates, updates, deletes, and manages custom rewards.
- `channel:read:redemptions` is acceptable for read-only redemption events, but the gateway should request `channel:manage:redemptions` for Hatchery support because reward management is MVP.
- `channel:read:subscriptions` is required for Hatchery subscription events and subscription backfill.
- `bits:read` is required for Bits cheer events and Bits leaderboard backfill.

## App Access Token

The gateway must maintain a Twitch App Access Token for:

- EventSub webhook subscription creation.
- Cloud chatbot compatible chat subscriptions.
- Chat send path where required for bot badge support.
- Public Twitch API reads where app token is sufficient.

Important:

- App Access Tokens do not replace broadcaster user tokens for broadcaster-owned actions.
- Custom reward create, update, delete, and redemption status updates must use the broadcaster user access token with `channel:manage:redemptions`.

## Token storage

Store Twitch tokens encrypted at rest.

Do not log:

- access tokens
- refresh tokens
- app API keys
- webhook secrets
- OAuth codes
- Authorization headers

Use a server-side `TOKEN_ENCRYPTION_KEY` from environment variables or TrueNAS secrets.

## EventSub subscriptions required in MVP

### Chat

```text
channel.chat.message
channel.chat.notification
channel.chat.message_delete
channel.chat.clear
channel.chat.clear_user_messages
channel.chat_settings.update
```

Minimum hard requirement for chat migration is `channel.chat.message`.

The others are useful for full chat log correctness and diagnostics.

### Channel Points

```text
channel.channel_points_custom_reward_redemption.add
channel.channel_points_custom_reward_redemption.update
```

### Subscriptions

```text
channel.subscribe
channel.subscription.end
channel.subscription.message
channel.subscription.gift
```

### Bits

```text
channel.cheer
```

### Stream status

```text
stream.online
stream.offline
channel.update
```

Stream status may also be queried through Helix `GET /helix/streams`. Include both polling endpoint and EventSub handling if it does not delay migration.

## Twitch API calls required in MVP

### Chat

```text
POST /helix/chat/messages
```

Support:

- message
- reply_parent_message_id
- for_source_only when relevant
- Twitch response `message_id`
- Twitch response `is_sent`
- Twitch response `drop_reason`

### EventSub management

```text
GET    /helix/eventsub/subscriptions
POST   /helix/eventsub/subscriptions
DELETE /helix/eventsub/subscriptions
```

### Channel Points

```text
POST   /helix/channel_points/custom_rewards
GET    /helix/channel_points/custom_rewards
PATCH  /helix/channel_points/custom_rewards
DELETE /helix/channel_points/custom_rewards
GET    /helix/channel_points/custom_rewards/redemptions
PATCH  /helix/channel_points/custom_rewards/redemptions
```

### Subscriptions

```text
GET /helix/subscriptions
```

### Bits

```text
GET /helix/bits/leaderboard
```

### Stream/profile/schedule

```text
GET /helix/streams
GET /helix/users
GET /helix/schedule
```

## Scope health checks

The gateway health checks must report degraded if:

- bot authorization is missing
- broadcaster authorization is missing
- `channel:bot` is missing
- `channel:manage:redemptions` is missing while reward management is enabled
- neither `channel:read:redemptions` nor `channel:manage:redemptions` is present while redemption events are enabled
- `channel:read:subscriptions` is missing while subscription events/backfill are enabled
- `bits:read` is missing while bits events/backfill are enabled
- token refresh fails
- App Access Token cannot be obtained
