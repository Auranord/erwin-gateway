export const twitchAuthorizeUrl = 'https://id.twitch.tv/oauth2/authorize';
export const twitchTokenUrl = 'https://id.twitch.tv/oauth2/token';
export const twitchValidateUrl = 'https://id.twitch.tv/oauth2/validate';

export const botRequiredScopes = ['user:read:chat', 'user:write:chat', 'user:bot'] as const;
export const broadcasterRequiredScopes = [
  'channel:bot',
  'channel:manage:redemptions',
  'channel:read:redemptions',
  'channel:read:subscriptions',
  'bits:read'
] as const;

export type TwitchAccountRole = 'bot' | 'broadcaster';

export function requiredScopesForRole(role: TwitchAccountRole) {
  return role === 'bot' ? [...botRequiredScopes] : [...broadcasterRequiredScopes];
}

export function missingScopes(granted: string[], required: string[]) {
  const grantedSet = new Set(granted);
  return required.filter((scope) => !grantedSet.has(scope));
}
