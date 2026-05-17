# Twitch auth

Phase 3 implements Twitch OAuth setup for `erwin-gateway` without IRC and without EventSub subscription creation.

## Required environment variables

- `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` identify the registered Twitch application.
- `PUBLIC_API_URL` or `PUBLIC_APP_URL` is used to build OAuth callback URLs.
- `TOKEN_ENCRYPTION_KEY` is required before storing user access and refresh tokens. Use a 32-byte UTF-8 string, 64-character hex string, or 32-byte base64 value.
- `INTERNAL_ADMIN_API_KEY` protects the admin setup routes when configured.

## Registered Twitch callback URLs

Register these callback URLs in the Twitch developer console for the same base URL configured in `PUBLIC_API_URL` or `PUBLIC_APP_URL`:

- `/api/admin/twitch/bot/callback`
- `/api/admin/twitch/broadcaster/callback`

## OAuth flow

1. An admin opens the Twitch Setup page.
2. The UI calls `POST /api/admin/twitch/bot/login/start` or `POST /api/admin/twitch/broadcaster/login/start`.
3. The API creates a one-time CSRF `state`, stores it temporarily in `gateway_settings`, and returns a Twitch authorization URL using authorization-code flow.
4. Twitch redirects back to the role-specific callback with `code` and `state`.
5. The callback validates `state`, exchanges the code for user access/refresh tokens, validates the access token with Twitch, and stores encrypted tokens in `twitch_tokens`.
6. Setup status and deep health report connected accounts, granted scopes, missing scopes, expiry, and refresh errors.

## Required scopes

Bot account:

- `user:read:chat`
- `user:write:chat`
- `user:bot`

Broadcaster account:

- `channel:bot`
- `channel:manage:redemptions`
- `channel:read:redemptions`
- `channel:read:subscriptions`
- `bits:read`

Missing required scopes make Twitch setup and deep health degraded.

## Security choices

- User tokens are encrypted at rest with AES-256-GCM using `TOKEN_ENCRYPTION_KEY`.
- Token ciphertext is stored in `twitch_tokens`; raw access tokens and refresh tokens are never returned to the UI.
- Log redaction covers authorization headers, OAuth tokens, client secrets, encryption keys, and raw API keys.
- OAuth `state` is random, role-bound, callback-bound, and expires after 10 minutes.
- The proactive worker refreshes tokens before expiry and records refresh errors without persisting raw secrets.
