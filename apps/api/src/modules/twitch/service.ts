import { eq, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { gatewaySettings, twitchAccounts, twitchChannels, twitchTokens } from '../../db/schema.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { missingScopes, requiredScopesForRole, twitchAuthorizeUrl, twitchTokenUrl, twitchValidateUrl, type TwitchAccountRole } from './constants.js';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string[];
  token_type: string;
}

interface ValidateResponse {
  client_id: string;
  login?: string;
  scopes: string[];
  user_id?: string;
  expires_in: number;
}

interface OAuthStateValue {
  state: string;
  role: TwitchAccountRole;
  redirectUri: string;
  returnTo: string | null;
  expiresAt: string;
}

const oauthStatePrefix = 'twitch_oauth_state:';
let appTokenCache: { accessToken: string; expiresAt: Date } | null = null;

export function getRedirectUri(config: AppConfig, role: TwitchAccountRole) {
  const base = config.PUBLIC_API_URL ?? config.PUBLIC_APP_URL;
  if (!base) throw new Error('PUBLIC_API_URL or PUBLIC_APP_URL is required for Twitch OAuth redirects');
  return new URL(`/api/admin/twitch/${role}/callback`, base).toString();
}

function requireClientConfig(config: AppConfig) {
  if (!config.TWITCH_CLIENT_ID || !config.TWITCH_CLIENT_SECRET) {
    throw new Error('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are required');
  }
}

async function postTwitchToken(params: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(twitchTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  if (!response.ok) throw new Error(`Twitch token request failed with ${response.status}`);
  return TokenResponseSchema(await response.json());
}

function TokenResponseSchema(value: unknown): TokenResponse {
  if (!value || typeof value !== 'object') throw new Error('Invalid Twitch token response');
  const data = value as Partial<TokenResponse>;
  if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number' || typeof data.token_type !== 'string') {
    throw new Error('Invalid Twitch token response');
  }
  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_in: data.expires_in,
    scope: Array.isArray(data.scope) ? data.scope.filter((scope): scope is string => typeof scope === 'string') : [],
    token_type: data.token_type
  };
}

function validateResponseSchema(value: unknown): ValidateResponse {
  if (!value || typeof value !== 'object') throw new Error('Invalid Twitch validate response');
  const data = value as Partial<ValidateResponse>;
  if (typeof data.client_id !== 'string' || !Array.isArray(data.scopes) || typeof data.expires_in !== 'number') {
    throw new Error('Invalid Twitch validate response');
  }
  return {
    client_id: data.client_id,
    login: typeof data.login === 'string' ? data.login : undefined,
    scopes: data.scopes.filter((scope): scope is string => typeof scope === 'string'),
    user_id: typeof data.user_id === 'string' ? data.user_id : undefined,
    expires_in: data.expires_in
  };
}

export async function validateAccessToken(accessToken: string) {
  const response = await fetch(twitchValidateUrl, {
    headers: { Authorization: `OAuth ${accessToken}` }
  });
  if (!response.ok) throw new Error(`Twitch token validation failed with ${response.status}`);
  return validateResponseSchema(await response.json());
}

function sanitizeReturnTo(config: AppConfig, returnTo: string | null) {
  if (!returnTo) return null;
  const allowedOrigins = [config.PUBLIC_APP_URL, config.PUBLIC_API_URL].filter((value): value is string => Boolean(value)).map((value) => new URL(value).origin);
  const candidate = new URL(returnTo);
  return allowedOrigins.includes(candidate.origin) ? candidate.toString() : null;
}

export async function createOAuthStart(db: Database, config: AppConfig, role: TwitchAccountRole, returnTo: string | null) {
  requireClientConfig(config);
  const state = randomUUID();
  const redirectUri = getRedirectUri(config, role);
  const value: OAuthStateValue = {
    state,
    role,
    redirectUri,
    returnTo: sanitizeReturnTo(config, returnTo),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
  };
  await db.insert(gatewaySettings).values({ key: `${oauthStatePrefix}${state}`, value })
    .onConflictDoUpdate({ target: gatewaySettings.key, set: { value, updatedAt: new Date() } });

  const url = new URL(twitchAuthorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.TWITCH_CLIENT_ID!);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', requiredScopesForRole(role).join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('force_verify', 'true');
  return { authorizationUrl: url.toString(), state, expiresAt: value.expiresAt };
}

export async function completeOAuthCallback(db: Database, config: AppConfig, role: TwitchAccountRole, code: string, state: string) {
  requireClientConfig(config);
  const key = `${oauthStatePrefix}${state}`;
  const [stateRecord] = await db.select().from(gatewaySettings).where(eq(gatewaySettings.key, key)).limit(1);
  const stored = stateRecord?.value as OAuthStateValue | undefined;
  if (!stored || stored.state !== state || stored.role !== role || new Date(stored.expiresAt).getTime() < Date.now()) {
    throw new Error('Invalid or expired Twitch OAuth state');
  }

  const token = await postTwitchToken(new URLSearchParams({
    client_id: config.TWITCH_CLIENT_ID!,
    client_secret: config.TWITCH_CLIENT_SECRET!,
    code,
    grant_type: 'authorization_code',
    redirect_uri: stored.redirectUri
  }));
  if (!token.refresh_token) throw new Error('Twitch did not return a refresh token');

  const validation = await validateAccessToken(token.access_token);
  if (!validation.user_id) throw new Error('Twitch validation did not include a user id');
  const scopes = token.scope?.length ? token.scope : validation.scopes;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + token.expires_in * 1000);

  const [account] = await db.insert(twitchAccounts).values({
    role,
    twitchUserId: validation.user_id,
    login: validation.login ?? validation.user_id,
    displayName: validation.login ?? null,
    grantedScopes: scopes,
    connectedAt: now,
    disabledAt: null
  }).onConflictDoUpdate({
    target: twitchAccounts.role,
    set: {
      twitchUserId: validation.user_id,
      login: validation.login ?? validation.user_id,
      displayName: validation.login ?? null,
      grantedScopes: scopes,
      connectedAt: now,
      disabledAt: null,
      updatedAt: now
    }
  }).returning();
  if (!account) throw new Error('Unable to store Twitch account');

  await db.insert(twitchTokens).values({
    accountId: account.id,
    tokenType: token.token_type,
    accessTokenCiphertext: encryptSecret(token.access_token, config),
    refreshTokenCiphertext: encryptSecret(token.refresh_token, config),
    scopes,
    expiresAt,
    validatedAt: now,
    lastRefreshedAt: now,
    lastRefreshError: null
  }).onConflictDoUpdate({
    target: twitchTokens.accountId,
    set: {
      tokenType: token.token_type,
      accessTokenCiphertext: encryptSecret(token.access_token, config),
      refreshTokenCiphertext: encryptSecret(token.refresh_token, config),
      scopes,
      expiresAt,
      validatedAt: now,
      lastRefreshedAt: now,
      lastRefreshError: null,
      updatedAt: now
    }
  });

  if (role === 'broadcaster') {
    await db.insert(twitchChannels).values({
      broadcasterUserId: validation.user_id,
      broadcasterAccountId: account.id,
      login: validation.login ?? validation.user_id,
      displayName: validation.login ?? null,
      primaryChannel: true
    }).onConflictDoUpdate({
      target: twitchChannels.broadcasterUserId,
      set: { broadcasterAccountId: account.id, login: validation.login ?? validation.user_id, displayName: validation.login ?? null, updatedAt: now }
    });
  }

  await db.delete(gatewaySettings).where(eq(gatewaySettings.key, key));
  return { role, login: validation.login ?? validation.user_id, missingScopes: missingScopes(scopes, requiredScopesForRole(role)), returnTo: stored.returnTo };
}

export async function refreshUserToken(db: Database, config: AppConfig, role: TwitchAccountRole) {
  requireClientConfig(config);
  const [row] = await db.select({ account: twitchAccounts, token: twitchTokens })
    .from(twitchAccounts)
    .innerJoin(twitchTokens, eq(twitchTokens.accountId, twitchAccounts.id))
    .where(eq(twitchAccounts.role, role))
    .limit(1);
  if (!row) throw new Error(`Twitch ${role} token is not connected`);

  try {
    const refreshToken = decryptSecret(row.token.refreshTokenCiphertext, config);
    const token = await postTwitchToken(new URLSearchParams({
      client_id: config.TWITCH_CLIENT_ID!,
      client_secret: config.TWITCH_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }));
    const newRefreshToken = token.refresh_token ?? refreshToken;
    const now = new Date();
    const scopes = token.scope?.length ? token.scope : row.token.scopes;
    const expiresAt = new Date(now.getTime() + token.expires_in * 1000);
    await db.update(twitchTokens).set({
      accessTokenCiphertext: encryptSecret(token.access_token, config),
      refreshTokenCiphertext: encryptSecret(newRefreshToken, config),
      tokenType: token.token_type,
      scopes,
      expiresAt,
      lastRefreshedAt: now,
      lastRefreshError: null,
      updatedAt: now
    }).where(eq(twitchTokens.id, row.token.id));
    await db.update(twitchAccounts).set({ grantedScopes: scopes, updatedAt: now }).where(eq(twitchAccounts.id, row.account.id));
    return { role, expiresAt: expiresAt.toISOString(), missingScopes: missingScopes(scopes, requiredScopesForRole(role)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown refresh error';
    await db.update(twitchTokens).set({ lastRefreshError: message, updatedAt: new Date() }).where(eq(twitchTokens.id, row.token.id));
    throw error;
  }
}

export async function refreshAllUserTokens(db: Database, config: AppConfig) {
  const results = [];
  for (const role of ['bot', 'broadcaster'] as const) {
    try {
      results.push(await refreshUserToken(db, config, role));
    } catch (error) {
      results.push({ role, error: error instanceof Error ? error.message : 'unknown refresh error' });
    }
  }
  return results;
}

export async function refreshExpiringTokens(db: Database, config: AppConfig) {
  const cutoff = new Date(Date.now() + 30 * 60_000);
  const rows = await db.select({ role: twitchAccounts.role })
    .from(twitchAccounts)
    .innerJoin(twitchTokens, eq(twitchTokens.accountId, twitchAccounts.id))
    .where(lte(twitchTokens.expiresAt, cutoff));
  for (const row of rows) {
    if (row.role === 'bot' || row.role === 'broadcaster') {
      await refreshUserToken(db, config, row.role);
    }
  }
}

export async function getUserAccessToken(db: Database, config: AppConfig, role: TwitchAccountRole) {
  requireClientConfig(config);
  const [row] = await db.select({ account: twitchAccounts, token: twitchTokens })
    .from(twitchAccounts)
    .innerJoin(twitchTokens, eq(twitchTokens.accountId, twitchAccounts.id))
    .where(eq(twitchAccounts.role, role))
    .limit(1);
  if (!row) throw new Error(`Twitch ${role} token is not connected`);
  if (row.token.expiresAt.getTime() <= Date.now() + 60_000) {
    await refreshUserToken(db, config, role);
    const [refreshed] = await db.select({ account: twitchAccounts, token: twitchTokens })
      .from(twitchAccounts)
      .innerJoin(twitchTokens, eq(twitchTokens.accountId, twitchAccounts.id))
      .where(eq(twitchAccounts.role, role))
      .limit(1);
    if (!refreshed) throw new Error(`Twitch ${role} token is not connected`);
    return { accessToken: decryptSecret(refreshed.token.accessTokenCiphertext, config), account: refreshed.account, scopes: refreshed.token.scopes.length ? refreshed.token.scopes : refreshed.account.grantedScopes };
  }
  return { accessToken: decryptSecret(row.token.accessTokenCiphertext, config), account: row.account, scopes: row.token.scopes.length ? row.token.scopes : row.account.grantedScopes };
}

export async function getAppAccessToken(config: AppConfig) {
  requireClientConfig(config);
  if (appTokenCache && appTokenCache.expiresAt.getTime() > Date.now() + 60_000) return appTokenCache;
  const token = await postTwitchToken(new URLSearchParams({
    client_id: config.TWITCH_CLIENT_ID!,
    client_secret: config.TWITCH_CLIENT_SECRET!,
    grant_type: 'client_credentials'
  }));
  appTokenCache = { accessToken: token.access_token, expiresAt: new Date(Date.now() + token.expires_in * 1000) };
  return appTokenCache;
}

export async function getTwitchSetupStatus(db: Database, config: AppConfig) {
  const records = await db.select({ account: twitchAccounts, token: twitchTokens })
    .from(twitchAccounts)
    .innerJoin(twitchTokens, eq(twitchTokens.accountId, twitchAccounts.id));
  const byRole = new Map(records.map((record) => [record.account.role, record]));

  async function accountStatus(role: TwitchAccountRole) {
    const record = byRole.get(role);
    const required = requiredScopesForRole(role);
    if (!record) return { role, connected: false, login: null, twitchUserId: null, grantedScopes: [], requiredScopes: required, missingScopes: required, expiresAt: null, tokenExpired: true, tokenValid: false, validationError: 'not_connected', lastRefreshError: null };
    const granted = record.token.scopes.length ? record.token.scopes : record.account.grantedScopes;
    const tokenExpired = record.token.expiresAt.getTime() <= Date.now();
    let tokenValid = !tokenExpired;
    let validationError: string | null = null;
    if (!tokenExpired) {
      try {
        await validateAccessToken(decryptSecret(record.token.accessTokenCiphertext, config));
        await db.update(twitchTokens).set({ validatedAt: new Date(), updatedAt: new Date() }).where(eq(twitchTokens.id, record.token.id));
      } catch (error) {
        tokenValid = false;
        validationError = error instanceof Error ? error.message : 'unknown validation error';
      }
    }
    return {
      role,
      connected: true,
      login: record.account.login,
      twitchUserId: record.account.twitchUserId,
      grantedScopes: granted,
      requiredScopes: required,
      missingScopes: missingScopes(granted, required),
      expiresAt: record.token.expiresAt.toISOString(),
      tokenExpired,
      tokenValid,
      validationError,
      lastRefreshError: record.token.lastRefreshError
    };
  }

  const bot = await accountStatus('bot');
  const broadcaster = await accountStatus('broadcaster');
  let appToken = { configured: Boolean(config.TWITCH_CLIENT_ID && config.TWITCH_CLIENT_SECRET), valid: false, expiresAt: null as string | null, error: null as string | null };
  if (appToken.configured) {
    try {
      const token = await getAppAccessToken(config);
      appToken = { configured: true, valid: true, expiresAt: token.expiresAt.toISOString(), error: null };
    } catch (error) {
      appToken = { configured: true, valid: false, expiresAt: null, error: error instanceof Error ? error.message : 'unknown app token error' };
    }
  }

  const degradedReasons = [bot, broadcaster].flatMap((status) => [
    ...(!status.connected ? [`${status.role}_missing`] : []),
    ...(status.missingScopes.length ? [`${status.role}_missing_scopes`] : []),
    ...(status.tokenExpired ? [`${status.role}_token_expired`] : []),
    ...(!status.tokenValid ? [`${status.role}_token_invalid`] : []),
    ...(status.lastRefreshError ? [`${status.role}_refresh_error`] : [])
  ]);
  if (!appToken.valid) degradedReasons.push('app_token_invalid');

  return { status: degradedReasons.length ? 'degraded' : 'healthy', appToken, bot, broadcaster, degradedReasons };
}
