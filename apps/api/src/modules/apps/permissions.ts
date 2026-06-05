export const appPermissions = [
  'chat:messages:send',
  'chat:messages:receive',
  'chat:commands:receive',
  'events:receive_twitch_events',
  'events:read',
  'logs:read_own',
  'logs:read_all',
  'channel_points:rewards:read',
  'channel_points:rewards:create',
  'channel_points:rewards:update',
  'channel_points:rewards:adopt',
  'channel_points:rewards:delete',
  'channel_points:redemptions:read',
  'channel_points:redemptions:manage',
  'channel_points:events:receive',
  'subscriptions:read',
  'subscriptions:backfill',
  'bits:read',
  'bits:backfill',
  'streams:read',
  'admin:apps',
  'admin:twitch'
] as const;

export type AppPermission = (typeof appPermissions)[number];

export const defaultAppPermissions = {
  'erwin-music': [
    'chat:messages:send',
    'chat:messages:receive',
    'chat:commands:receive',
    'streams:read',
    'logs:read_own'
  ],
  'erwin-hatchery': [
    'chat:messages:send',
    'channel_points:rewards:read',
    'channel_points:rewards:create',
    'channel_points:rewards:update',
    'channel_points:rewards:adopt',
    'channel_points:rewards:delete',
    'channel_points:redemptions:read',
    'channel_points:redemptions:manage',
    'channel_points:events:receive',
    'subscriptions:read',
    'subscriptions:backfill',
    'bits:read',
    'bits:backfill',
    'streams:read',
    'events:receive_twitch_events',
    'logs:read_own'
  ]
} satisfies Record<string, AppPermission[]>;

const permissionSet = new Set<string>(appPermissions);

export function normalizePermissions(permissions: string[]): AppPermission[] {
  return [...new Set(permissions)].filter((permission): permission is AppPermission => permissionSet.has(permission));
}
