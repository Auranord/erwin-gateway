import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
};

export const gatewaySettings = pgTable('gateway_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 320 }).notNull(),
  displayName: text('display_name'),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  ...timestamps
}, (table) => [uniqueIndex('admin_users_email_idx').on(table.email)]);

export const adminSessions = pgTable('admin_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminUserId: uuid('admin_user_id').references(() => adminUsers.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps
});

export const adminAuditLog = pgTable('admin_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminUserId: uuid('admin_user_id').references(() => adminUsers.id),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [index('admin_audit_log_target_idx').on(table.targetType, table.targetId)]);

export const apps = pgTable('apps', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: varchar('slug', { length: 80 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  description: text('description'),
  permissions: jsonb('permissions_json').$type<string[]>().notNull().default([]),
  ...timestamps
}, (table) => [uniqueIndex('apps_slug_idx').on(table.slug)]);

export const appApiKeys = pgTable('app_api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  appId: uuid('app_id').notNull().references(() => apps.id),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex('app_api_keys_key_prefix_idx').on(table.keyPrefix),
  index('app_api_keys_app_id_idx').on(table.appId)
]);

export const appWebhookEndpoints = pgTable('app_webhook_endpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  appId: uuid('app_id').notNull().references(() => apps.id),
  name: text('name').notNull().default('default'),
  url: text('url'),
  enabled: boolean('enabled').notNull().default(false),
  eventFilters: jsonb('event_filters_json').$type<string[]>().notNull().default([]),
  secretHash: text('secret_hash'),
  lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
  ...timestamps
}, (table) => [index('app_webhook_endpoints_app_id_idx').on(table.appId)]);


export const twitchAccounts = pgTable('twitch_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  role: varchar('role', { length: 32 }).notNull(),
  twitchUserId: text('twitch_user_id').notNull(),
  login: text('login').notNull(),
  displayName: text('display_name'),
  grantedScopes: jsonb('granted_scopes_json').$type<string[]>().notNull().default([]),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex('twitch_accounts_role_idx').on(table.role),
  uniqueIndex('twitch_accounts_twitch_user_id_idx').on(table.twitchUserId)
]);

export const twitchTokens = pgTable('twitch_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => twitchAccounts.id),
  tokenType: varchar('token_type', { length: 32 }).notNull().default('bearer'),
  accessTokenCiphertext: text('access_token_ciphertext').notNull(),
  refreshTokenCiphertext: text('refresh_token_ciphertext').notNull(),
  scopes: jsonb('scopes_json').$type<string[]>().notNull().default([]),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  validatedAt: timestamp('validated_at', { withTimezone: true }),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
  lastRefreshError: text('last_refresh_error'),
  ...timestamps
}, (table) => [
  uniqueIndex('twitch_tokens_account_id_idx').on(table.accountId),
  index('twitch_tokens_expires_at_idx').on(table.expiresAt)
]);

export const twitchChannels = pgTable('twitch_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  broadcasterUserId: text('broadcaster_user_id').notNull(),
  broadcasterAccountId: uuid('broadcaster_account_id').references(() => twitchAccounts.id),
  login: text('login').notNull(),
  displayName: text('display_name'),
  enabled: boolean('enabled').notNull().default(true),
  primaryChannel: boolean('primary_channel').notNull().default(false),
  commandPrefix: varchar('command_prefix', { length: 8 }).notNull().default('!'),
  ...timestamps
}, (table) => [
  uniqueIndex('twitch_channels_broadcaster_user_id_idx').on(table.broadcasterUserId),
  index('twitch_channels_broadcaster_account_id_idx').on(table.broadcasterAccountId)
]);

export const diagnosticEvents = pgTable('diagnostic_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  severity: varchar('severity', { length: 20 }).notNull(),
  module: text('module').notNull(),
  message: text('message').notNull(),
  details: jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [index('diagnostic_events_created_at_idx').on(table.createdAt)]);

export const twitchEventsubSubscriptions = pgTable('twitch_eventsub_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  twitchSubscriptionId: text('twitch_subscription_id'),
  type: text('type').notNull(),
  version: varchar('version', { length: 16 }).notNull(),
  condition: jsonb('condition_json').$type<Record<string, string>>().notNull().default({}),
  callbackUrl: text('callback_url').notNull(),
  status: varchar('status', { length: 64 }).notNull().default('desired'),
  transportMethod: varchar('transport_method', { length: 32 }).notNull().default('webhook'),
  cost: integer('cost'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: text('revoke_reason'),
  lastError: text('last_error'),
  ...timestamps
}, (table) => [
  uniqueIndex('twitch_eventsub_subscriptions_twitch_id_idx').on(table.twitchSubscriptionId),
  uniqueIndex('twitch_eventsub_subscriptions_desired_idx').on(table.type, table.version, table.condition),
  index('twitch_eventsub_subscriptions_status_idx').on(table.status)
]);

export const twitchEventsubMessages = pgTable('twitch_eventsub_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: text('message_id').notNull(),
  messageType: varchar('message_type', { length: 64 }).notNull(),
  subscriptionType: text('subscription_type'),
  subscriptionVersion: varchar('subscription_version', { length: 16 }),
  twitchSubscriptionId: text('twitch_subscription_id'),
  eventType: text('event_type'),
  payload: jsonb('payload').notNull().default({}),
  headers: jsonb('headers').notNull().default({}),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  duplicate: boolean('duplicate').notNull().default(false)
}, (table) => [
  uniqueIndex('twitch_eventsub_messages_message_id_idx').on(table.messageId),
  index('twitch_eventsub_messages_received_at_idx').on(table.receivedAt),
  index('twitch_eventsub_messages_event_type_idx').on(table.eventType)
]);

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: varchar('source', { length: 64 }).notNull(),
  type: text('type').notNull(),
  externalId: text('external_id'),
  channelId: uuid('channel_id').references(() => twitchChannels.id),
  twitchMessageId: text('twitch_message_id'),
  twitchSubscriptionId: text('twitch_subscription_id'),
  payload: jsonb('payload').notNull().default({}),
  status: varchar('status', { length: 32 }).notNull().default('queued'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex('events_external_id_source_idx').on(table.source, table.externalId),
  index('events_status_idx').on(table.status),
  index('events_type_idx').on(table.type),
  index('events_occurred_at_idx').on(table.occurredAt)
]);

export const healthCheckSnapshots = pgTable('health_check_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: varchar('status', { length: 32 }).notNull(),
  checks: jsonb('checks').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const placeholderQueues = pgTable('placeholder_queues', {
  id: uuid('id').primaryKey().defaultRandom(),
  queueName: text('queue_name').notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
