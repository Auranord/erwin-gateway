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
});

export const apps = pgTable('apps', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: varchar('slug', { length: 80 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  description: text('description'),
  ...timestamps
}, (table) => [uniqueIndex('apps_slug_idx').on(table.slug)]);

export const twitchChannels = pgTable('twitch_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  broadcasterUserId: text('broadcaster_user_id').notNull(),
  login: text('login').notNull(),
  displayName: text('display_name'),
  enabled: boolean('enabled').notNull().default(true),
  primaryChannel: boolean('primary_channel').notNull().default(false),
  commandPrefix: varchar('command_prefix', { length: 8 }).notNull().default('!'),
  ...timestamps
}, (table) => [uniqueIndex('twitch_channels_broadcaster_user_id_idx').on(table.broadcasterUserId)]);

export const diagnosticEvents = pgTable('diagnostic_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  severity: varchar('severity', { length: 20 }).notNull(),
  module: text('module').notNull(),
  message: text('message').notNull(),
  details: jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [index('diagnostic_events_created_at_idx').on(table.createdAt)]);

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
