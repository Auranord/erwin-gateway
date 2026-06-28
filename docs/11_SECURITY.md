# 11 Security Requirements

## General security rules

- Use Bitwarden or TrueNAS secrets for real deployment secrets.
- Do not commit secrets.
- Do not log secrets.
- Encrypt Twitch tokens at rest.
- Store app API keys as hashes only.
- Sign app webhooks.
- Verify Twitch EventSub signatures using raw request body.
- Require admin auth for admin UI and admin API.
- Restrict CORS to configured origins.
- Validate all payloads with Zod.
- Use idempotency keys for write endpoints.
- Audit all admin changes.
- Audit reward mutations.
- Audit API key creation/revocation.
- Use permission checks for every app API route.
- Enforce reward ownership for update/delete/status actions.

NTKOH account hygiene requires no plain text passwords/secrets in chats or docs, 2FA everywhere, and shared credentials through Bitwarden.

## Secrets that must never be logged

- Twitch client secret
- Twitch EventSub secret
- Twitch access token
- Twitch refresh token
- App Access Token
- app API keys
- webhook secrets
- OAuth authorization code
- `Authorization` headers
- `Cookie` headers
- session secrets
- token encryption key
- API key pepper

## App API key storage

Requirements:

- Show the raw app API key only once.
- Store only a strong hash.
- Support key prefixes for lookup.
- Support multiple keys per app.
- Support key rotation.
- Support key revocation.
- Track last used timestamp.
- Include audit log entries for key creation/revocation.

Recommended format:

```text
egw_live_<key_id>_<secret>
egw_dev_<key_id>_<secret>
```

## Webhook signing

Use HMAC-SHA256 with a per-app webhook secret.

Headers:

```text
X-Erwin-Gateway-Delivery-Id
X-Erwin-Gateway-Event-Id
X-Erwin-Gateway-Timestamp
X-Erwin-Gateway-Signature
X-Erwin-Gateway-App-Id
```

Signature input:

```text
delivery_id + timestamp + raw_body
```

Downstream apps must verify signatures using timing-safe comparison.

## Twitch EventSub signature verification

The gateway must verify Twitch EventSub signatures using the raw request body and Twitch EventSub headers.

Do not parse and re-stringify the JSON before verification.

## Permission checks

Every app-facing API route must check app permissions.

Reward operations must also check ownership:

- read if app has reward read permission
- create if app has create permission
- update/delete only if app owns the reward or admin override is used
- redemption manage only if app owns the reward or has explicit manage permission

## Admin auth

The current MVP admin API/UI model is intentionally simple and must be deployed behind an operator-controlled boundary:

- `INTERNAL_ADMIN_API_KEY` must be configured before admin routes are usable. Treat it as a production secret and store it in TrueNAS secrets, Bitwarden, or an equivalent secret manager.
- Admin API clients authenticate with either `X-Admin-API-Key: <key>` or `Authorization: Bearer <key>`. Do not log either header.
- The only `/api/admin/twitch/*/callback` exception is the Twitch OAuth callback route family, because Twitch redirects the operator's browser back to those endpoints during bot or broadcaster authorization. These callbacks still rely on the OAuth state flow and should only use the configured public gateway origin.
- The admin UI is not a public application. Do not expose `/`, `/admin`, `/admin/*`, or `/api/admin/*` directly to the internet unless a reverse proxy, VPN, private LAN, SSO/basic-auth layer, IP allowlist, or another network boundary protects access.

Expected TrueNAS/reverse proxy posture:

- Publish only the public HTTPS routes required by external systems, especially `POST /webhooks/twitch/eventsub` and the Twitch OAuth callback URLs configured in Twitch.
- Keep admin UI and admin API access private, or require reverse-proxy authentication before traffic reaches the gateway.
- Forward the original host/proto headers consistently so OAuth redirect URLs and generated public URLs match `PUBLIC_APP_URL`/`PUBLIC_API_URL` and `TWITCH_EVENTSUB_CALLBACK_URL`.
- Rotate `INTERNAL_ADMIN_API_KEY` after suspected exposure and whenever operator access changes.
