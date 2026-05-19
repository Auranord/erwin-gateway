# Twitch auth and EventSub setup

`erwin-gateway` uses Twitch OAuth authorization-code flow for two identities:

- **Bot account**: sends and receives chat as the bot and qualifies for Twitch chat bot behavior.
- **Broadcaster account**: owns Channel Point rewards, redemptions, subscriptions, Bits, stream/profile/schedule access, and EventSub subscriptions.

## Twitch app setup

1. Open the Twitch Developer Console.
2. Create or select the Twitch application for `erwin-gateway`.
3. Set OAuth redirect URLs for the public API origin:
   - `https://gateway.example.com/api/admin/twitch/bot/callback`
   - `https://gateway.example.com/api/admin/twitch/broadcaster/callback`
4. Store the client ID and client secret in deployment secrets:
   - `TWITCH_CLIENT_ID`
   - `TWITCH_CLIENT_SECRET`
5. Generate a strong `TWITCH_EVENTSUB_SECRET` and configure `TWITCH_EVENTSUB_CALLBACK_URL` as:
   - `https://gateway.example.com/webhooks/twitch/eventsub`

## Bot account OAuth

From the admin UI Twitch Setup page, start **Connect bot account**. The bot account should be the dedicated Twitch bot user, not the broadcaster unless you intentionally use one account for both roles.

Required bot scopes by feature:

| Feature | Required scopes |
| --- | --- |
| Receive chat through EventSub `channel.chat.message` as a bot | `user:read:chat`, `user:bot` |
| Send chat through Twitch Send Chat Message API | `user:write:chat`, `user:bot` |
| Bot relationship with broadcaster | broadcaster must also grant `channel:bot` |

## Broadcaster OAuth

From the admin UI Twitch Setup page, start **Connect broadcaster account** while logged in as the broadcaster/channel owner.

Required broadcaster scopes by feature:

| Feature | Required scopes |
| --- | --- |
| Allow bot chat integration | `channel:bot` |
| Channel Point reward create/update/delete/sync | `channel:manage:redemptions` |
| Channel Point redemption events and status reads | `channel:read:redemptions`, `channel:manage:redemptions` |
| Fulfill/cancel redemptions | `channel:manage:redemptions` |
| Subscription EventSub/backfill | `channel:read:subscriptions` |
| Bits cheer events/leaderboard | `bits:read` |
| Stream online/offline and stream/profile/schedule reads | no extra user scope for public reads; broadcaster OAuth is still required for gateway ownership and diagnostics |

## Scope troubleshooting

Missing scopes make Twitch setup and `GET /api/v1/health/deep` degraded.

1. Check the Twitch Setup page or deep health `checks.twitch.missingScopes`.
2. Confirm whether the missing scope belongs to the bot or broadcaster role.
3. Update the gateway code/config only if the desired feature changed; otherwise reconnect the affected account from the admin UI.
4. If EventSub subscriptions are revoked, fix the missing scope and run EventSub sync.
5. If token refresh fails, reconnect the affected account; raw tokens are never shown in the UI or logs.

Common problems:

- Connecting the broadcaster while logged in as the bot account causes reward/subscription/Bits failures.
- Forgetting broadcaster `channel:bot` causes chat bot EventSub/send authorization problems.
- Rotating the Twitch client secret requires updating the deployment secret and restarting the API.
- OAuth redirect URL mismatch causes Twitch to reject the callback before the gateway receives a code.

## EventSub callback requirements

- Public HTTPS URL reachable by Twitch: `TWITCH_EVENTSUB_CALLBACK_URL`.
- Gateway endpoint: `POST /webhooks/twitch/eventsub`.
- The endpoint verifies Twitch headers and the raw body with `TWITCH_EVENTSUB_SECRET`.
- Challenge requests return the exact challenge as `text/plain`.
- Notification requests are persisted, deduped by Twitch message ID, normalized, and fanned out to app webhooks.
- Revocation requests mark subscriptions unhealthy so health/admin diagnostics can drive repair.

## Security choices

- User access/refresh tokens are encrypted at rest with `TOKEN_ENCRYPTION_KEY`.
- Raw Twitch tokens, OAuth codes, Twitch client secret, EventSub secret, Authorization headers, cookies, API keys, and webhook secrets are redacted from logs.
- Admin setup routes require `INTERNAL_ADMIN_API_KEY`.
