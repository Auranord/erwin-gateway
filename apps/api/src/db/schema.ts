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
  signingSecret: text('signing_secret'),
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


export const twitchChatMessages = pgTable('twitch_chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  twitchMessageId: text('twitch_message_id').notNull(),
  channelId: uuid('channel_id').references(() => twitchChannels.id),
  chatterUserId: text('chatter_user_id'),
  chatterLogin: text('chatter_login'),
  chatterDisplayName: text('chatter_display_name'),
  text: text('text').notNull(),
  fragments: jsonb('fragments_json').$type<unknown[]>().notNull().default([]),
  badges: jsonb('badges_json').$type<unknown[]>().notNull().default([]),
  color: text('color'),
  isBroadcaster: boolean('is_broadcaster').notNull().default(false),
  isMod: boolean('is_mod').notNull().default(false),
  isVip: boolean('is_vip').notNull().default(false),
  isSubscriber: boolean('is_subscriber').notNull().default(false),
  isCommand: boolean('is_command').notNull().default(false),
  commandSymbol: varchar('command_symbol', { length: 8 }),
  commandName: text('command_name'),
  commandArgsText: text('command_args_text'),
  commandArgs: jsonb('command_args_json').$type<string[]>().notNull().default([]),
  replyParentMessageId: text('reply_parent_message_id'),
  moderationState: text('moderation_state'),
  rawEventId: uuid('raw_event_id').references(() => twitchEventsubMessages.id),
  eventId: uuid('event_id').references(() => events.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('twitch_chat_messages_twitch_message_id_idx').on(table.twitchMessageId),
  index('twitch_chat_messages_channel_created_idx').on(table.channelId, table.createdAt),
  index('twitch_chat_messages_command_idx').on(table.commandName)
]);


export const outgoingChatMessages = pgTable('outgoing_chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceAppId: uuid('source_app_id').notNull().references(() => apps.id),
  channelId: uuid('channel_id').notNull().references(() => twitchChannels.id),
  message: text('message').notNull(),
  replyParentMessageId: text('reply_parent_message_id'),
  forSourceOnly: boolean('for_source_only').notNull().default(true),
  priority: integer('priority').notNull().default(0),
  status: varchar('status', { length: 32 }).notNull().default('queued'),
  idempotencyKey: text('idempotency_key').notNull(),
  twitchMessageId: text('twitch_message_id'),
  twitchIsSent: boolean('twitch_is_sent'),
  twitchDropReason: jsonb('twitch_drop_reason_json'),
  responseCode: integer('response_code'),
  responseBodyExcerpt: text('response_body_excerpt'),
  rateLimit: jsonb('rate_limit_json').$type<Record<string, string | null>>().notNull().default({}),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true })
}, (table) => [
  uniqueIndex('outgoing_chat_messages_app_idempotency_idx').on(table.sourceAppId, table.idempotencyKey),
  index('outgoing_chat_messages_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
  index('outgoing_chat_messages_channel_created_idx').on(table.channelId, table.createdAt),
  index('outgoing_chat_messages_source_app_idx').on(table.sourceAppId)
]);

export const outgoingChatAttempts = pgTable('outgoing_chat_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  outgoingChatMessageId: uuid('outgoing_chat_message_id').notNull().references(() => outgoingChatMessages.id),
  attemptNumber: integer('attempt_number').notNull(),
  request: jsonb('request_json').notNull().default({}),
  responseCode: integer('response_code'),
  responseJson: jsonb('response_json'),
  responseBodyExcerpt: text('response_body_excerpt'),
  error: text('error'),
  rateLimit: jsonb('rate_limit_json').$type<Record<string, string | null>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('outgoing_chat_attempts_message_idx').on(table.outgoingChatMessageId),
  uniqueIndex('outgoing_chat_attempts_number_idx').on(table.outgoingChatMessageId, table.attemptNumber)
]);


export const twitchChannelPointRewards = pgTable('twitch_channel_point_rewards', {
  id: uuid('id').primaryKey().defaultRandom(),
  twitchRewardId: text('twitch_reward_id').notNull(),
  channelId: uuid('channel_id').notNull().references(() => twitchChannels.id),
  owningAppId: uuid('owning_app_id').references(() => apps.id),
  appOwnershipKey: text('app_ownership_key'),
  title: text('title').notNull(),
  cost: integer('cost').notNull(),
  prompt: text('prompt'),
  enabled: boolean('enabled').notNull().default(true),
  manageable: boolean('manageable').notNull().default(false),
  backgroundColor: text('background_color'),
  isUserInputRequired: boolean('is_user_input_required').notNull().default(false),
  limits: jsonb('limits_json').$type<Record<string, unknown>>().notNull().default({}),
  rawPayload: jsonb('raw_payload_json').notNull().default({}),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
}, (table) => [
  uniqueIndex('twitch_channel_point_rewards_twitch_id_idx').on(table.twitchRewardId),
  index('twitch_channel_point_rewards_channel_idx').on(table.channelId),
  index('twitch_channel_point_rewards_owning_app_idx').on(table.owningAppId),
  index('twitch_channel_point_rewards_deleted_idx').on(table.deletedAt)
]);

export const twitchChannelPointRedemptions = pgTable('twitch_channel_point_redemptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  twitchRedemptionId: text('twitch_redemption_id').notNull(),
  channelId: uuid('channel_id').notNull().references(() => twitchChannels.id),
  rewardId: uuid('reward_id').references(() => twitchChannelPointRewards.id),
  twitchRewardId: text('twitch_reward_id').notNull(),
  userId: text('user_id'),
  userLogin: text('user_login'),
  userDisplayName: text('user_display_name'),
  status: varchar('status', { length: 32 }).notNull(),
  userInput: text('user_input'),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull(),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  rawPayload: jsonb('raw_payload_json').notNull().default({}),
  rawEventId: uuid('raw_event_id').references(() => twitchEventsubMessages.id),
  eventId: uuid('event_id').references(() => events.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('twitch_channel_point_redemptions_twitch_id_idx').on(table.twitchRedemptionId),
  index('twitch_channel_point_redemptions_reward_idx').on(table.rewardId),
  index('twitch_channel_point_redemptions_channel_idx').on(table.channelId, table.redeemedAt),
  index('twitch_channel_point_redemptions_status_idx').on(table.status)
]);

export const appChannelPointRewardBindings = pgTable('app_channel_point_reward_bindings', {
  id: uuid('id').primaryKey().defaultRandom(),
  appId: uuid('app_id').notNull().references(() => apps.id),
  rewardId: uuid('reward_id').notNull().references(() => twitchChannelPointRewards.id),
  permission: varchar('permission', { length: 32 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('app_channel_point_reward_bindings_app_reward_idx').on(table.appId, table.rewardId),
  index('app_channel_point_reward_bindings_reward_idx').on(table.rewardId)
]);

export const rewardSyncRuns = pgTable('reward_sync_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => twitchChannels.id),
  requestedByAppId: uuid('requested_by_app_id').references(() => apps.id),
  status: varchar('status', { length: 32 }).notNull().default('running'),
  rewardsSeen: integer('rewards_seen').notNull().default(0),
  rewardsCreated: integer('rewards_created').notNull().default(0),
  rewardsUpdated: integer('rewards_updated').notNull().default(0),
  rewardsMissingOwnership: integer('rewards_missing_ownership').notNull().default(0),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, (table) => [
  index('reward_sync_runs_channel_started_idx').on(table.channelId, table.startedAt),
  index('reward_sync_runs_status_idx').on(table.status)
]);


export const textCommands = pgTable('text_commands', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').references(() => twitchChannels.id),
  command: text('command').notNull(),
  aliases: jsonb('aliases_json').$type<string[]>().notNull().default([]),
  prefix: varchar('prefix', { length: 8 }).notNull().default('!'),
  responseText: text('response_text').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  requiredRole: varchar('required_role', { length: 32 }).notNull().default('everyone'),
  cooldownSeconds: integer('cooldown_seconds').notNull().default(0),
  userCooldownSeconds: integer('user_cooldown_seconds').notNull().default(0),
  replyMode: varchar('reply_mode', { length: 32 }).notNull().default('message'),
  usageCount: integer('usage_count').notNull().default(0),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdByAdminId: uuid('created_by_admin_id').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true })
}, (table) => [
  index('text_commands_channel_prefix_idx').on(table.channelId, table.prefix),
  index('text_commands_enabled_idx').on(table.enabled)
]);

export const textCommandInvocations = pgTable('text_command_invocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  textCommandId: uuid('text_command_id').notNull().references(() => textCommands.id),
  twitchMessageId: text('twitch_message_id'),
  channelId: uuid('channel_id').references(() => twitchChannels.id),
  userId: text('user_id'),
  userLogin: text('user_login'),
  status: varchar('status', { length: 32 }).notNull(),
  dropReason: text('drop_reason'),
  queuedChatMessageId: uuid('queued_chat_message_id').references(() => outgoingChatMessages.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('text_command_invocations_command_created_idx').on(table.textCommandId, table.createdAt),
  index('text_command_invocations_user_created_idx').on(table.textCommandId, table.userId, table.createdAt),
  index('text_command_invocations_status_idx').on(table.status)
]);

export const idempotencyKeys = pgTable('idempotency_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceAppId: uuid('source_app_id').notNull().references(() => apps.id),
  scope: varchar('scope', { length: 80 }).notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  resourceType: varchar('resource_type', { length: 80 }).notNull(),
  resourceId: uuid('resource_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true })
}, (table) => [
  uniqueIndex('idempotency_keys_app_scope_key_idx').on(table.sourceAppId, table.scope, table.idempotencyKey),
  index('idempotency_keys_resource_idx').on(table.resourceType, table.resourceId)
]);

export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  id: uuid('id').primaryKey().defaultRandom(),
  bucketType: varchar('bucket_type', { length: 64 }).notNull(),
  bucketKey: text('bucket_key').notNull(),
  limit: integer('limit'),
  remaining: integer('remaining'),
  resetAt: timestamp('reset_at', { withTimezone: true }),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  metadata: jsonb('metadata_json').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('rate_limit_buckets_type_key_idx').on(table.bucketType, table.bucketKey),
  index('rate_limit_buckets_reset_idx').on(table.resetAt)
]);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  appId: uuid('app_id').notNull().references(() => apps.id),
  endpointId: uuid('endpoint_id').notNull().references(() => appWebhookEndpoints.id),
  eventId: uuid('event_id').notNull().references(() => events.id),
  status: varchar('status', { length: 32 }).notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
  payload: jsonb('payload_json').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true })
}, (table) => [
  uniqueIndex('webhook_deliveries_endpoint_event_idx').on(table.endpointId, table.eventId),
  index('webhook_deliveries_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
  index('webhook_deliveries_event_idx').on(table.eventId)
]);

export const webhookDeliveryAttempts = pgTable('webhook_delivery_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  deliveryId: uuid('delivery_id').notNull().references(() => webhookDeliveries.id),
  attemptNumber: integer('attempt_number').notNull(),
  statusCode: integer('status_code'),
  durationMs: integer('duration_ms').notNull(),
  responseExcerpt: text('response_excerpt'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('webhook_delivery_attempts_delivery_idx').on(table.deliveryId),
  uniqueIndex('webhook_delivery_attempts_number_idx').on(table.deliveryId, table.attemptNumber)
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
