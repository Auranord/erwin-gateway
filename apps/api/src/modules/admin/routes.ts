import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { adminAuditLog, appApiKeys, apps, appWebhookEndpoints, events, twitchChannelPointRewards, twitchChannels, webhookDeliveries } from '../../db/schema.js';
import { archiveTextCommand, createTextCommand, getTextCommand, listTextCommandInvocations, listTextCommands, testTextCommand, textCommandReplyModes, textCommandRoles, updateTextCommand } from '../text-commands/service.js';
import { generateAppApiKey } from '../apps/api-keys.js';
import { appPermissions, defaultAppPermissions, normalizePermissions } from '../apps/permissions.js';
import { registerTwitchAdminRoutes } from '../twitch/routes.js';
import { getOutgoingChatMessage, listOutgoingChatMessages, retryOutgoingChatMessage } from '../twitch-chat/service.js';
import { deliverWebhookNow, generateWebhookSecret, getWebhookDeliveryWithAttempts, listChatLog, listWebhookDeliveries } from '../webhooks/service.js';
import { channelPointDiagnostics, createReward, deleteReward, listRedemptions, listRewards, syncRewards, updateReward } from '../channel-points/service.js';
import { twitchDataDiagnostics } from '../twitch-data.js';

const adminPages = [
  'Dashboard',
  'Twitch Setup',
  'Apps',
  'Text Commands',
  'Chat Log',
  'Outgoing Messages',
  'Webhook Deliveries',
  'Channel Points',
  'Diagnostics',
  'Docs'
];

const createAppSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/),
  description: z.string().max(500).optional().nullable(),
  enabled: z.boolean().optional(),
  permissions: z.array(z.string()).default([]),
  webhookUrl: z.string().url().optional().or(z.literal('')).nullable(),
  webhookEventFilters: z.array(z.string()).default([])
});

const updateAppSchema = createAppSchema.partial().extend({
  permissions: z.array(z.string()).optional(),
  webhookEventFilters: z.array(z.string()).optional()
});

const createKeySchema = z.object({
  name: z.string().min(1).max(120).default('Default key')
});

const textCommandSchema = z.object({
  channelId: z.string().uuid().optional().nullable(),
  command: z.string().min(1).max(80),
  aliases: z.array(z.string()).default([]),
  responseText: z.string().min(1).max(500),
  enabled: z.boolean().optional(),
  requiredRole: z.enum(textCommandRoles).default('everyone'),
  cooldownSeconds: z.number().int().min(0).max(86400).default(0),
  userCooldownSeconds: z.number().int().min(0).max(86400).default(0),
  replyMode: z.enum(textCommandReplyModes).default('message')
});

const updateTextCommandSchema = textCommandSchema.partial();


interface AdminRouteOptions {
  config: AppConfig;
  db?: Database;
}

function requireDatabase(db: Database | undefined, reply: FastifyReply): db is Database {
  if (!db) {
    reply.code(503).send({ error: 'Database is not configured' });
    return false;
  }
  return true;
}

function authorizeAdmin(config: AppConfig, request: FastifyRequest, reply: FastifyReply) {
  if (!config.INTERNAL_ADMIN_API_KEY) {
    reply.code(503).send({ error: 'Admin authentication is not configured' });
    return false;
  }

  const adminHeader = request.headers['x-admin-api-key'];
  const bearer = request.headers.authorization?.startsWith('Bearer ')
    ? request.headers.authorization.slice('Bearer '.length)
    : undefined;
  const provided = typeof adminHeader === 'string' ? adminHeader : bearer;

  if (provided !== config.INTERNAL_ADMIN_API_KEY) {
    reply.code(401).send({ error: 'Admin authentication required' });
    return false;
  }

  return true;
}

function serializeKey(key: typeof appApiKeys.$inferSelect) {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
    updatedAt: key.updatedAt.toISOString()
  };
}

function serializeWebhook(webhook: typeof appWebhookEndpoints.$inferSelect | undefined) {
  return webhook
    ? {
        id: webhook.id,
        name: webhook.name,
        url: webhook.url ?? '',
        enabled: webhook.enabled,
        eventFilters: webhook.eventFilters,
        lastDeliveryAt: webhook.lastDeliveryAt?.toISOString() ?? null,
        signingSecretConfigured: Boolean(webhook.signingSecret || webhook.secretHash),
        createdAt: webhook.createdAt.toISOString(),
        updatedAt: webhook.updatedAt.toISOString()
      }
    : {
        id: null,
        name: 'default',
        url: '',
        enabled: false,
        eventFilters: [],
        lastDeliveryAt: null,
        signingSecretConfigured: false,
        createdAt: null,
        updatedAt: null
      };
}

function serializeApp(
  appRecord: typeof apps.$inferSelect,
  keys: Array<typeof appApiKeys.$inferSelect> = [],
  webhook?: typeof appWebhookEndpoints.$inferSelect
) {
  return {
    id: appRecord.id,
    name: appRecord.name,
    slug: appRecord.slug,
    enabled: appRecord.enabled,
    description: appRecord.description,
    permissions: appRecord.permissions,
    createdAt: appRecord.createdAt.toISOString(),
    archivedAt: appRecord.archivedAt?.toISOString() ?? null,
    updatedAt: appRecord.updatedAt.toISOString(),
    apiKeys: keys.map(serializeKey),
    webhook: serializeWebhook(webhook)
  };
}

async function audit(db: Database, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  await db.insert(adminAuditLog).values({ action, targetType, targetId, metadata });
}

function buildArchivedSlug(slug: string, appId: string) {
  const shortId = appId.replaceAll('-', '').slice(0, 8);
  const suffix = `--archived-${shortId}`;
  return `${slug.slice(0, 80 - suffix.length)}${suffix}`;
}

async function getFirstWebhook(db: Database, appId: string) {
  const [webhook] = await db
    .select()
    .from(appWebhookEndpoints)
    .where(eq(appWebhookEndpoints.appId, appId))
    .orderBy(desc(appWebhookEndpoints.createdAt))
    .limit(1);
  return webhook;
}

async function upsertDefaultWebhook(db: Database, appId: string, webhookUrl?: string | null, eventFilters?: string[]) {
  if (webhookUrl === undefined && eventFilters === undefined) {
    return;
  }

  const existing = await getFirstWebhook(db, appId);
  const url = webhookUrl === '' ? null : webhookUrl;
  const values = {
    url,
    enabled: Boolean(url),
    eventFilters: eventFilters ?? existing?.eventFilters ?? [],
    updatedAt: new Date()
  };

  if (existing) {
    await db.update(appWebhookEndpoints).set({ ...values, signingSecret: existing.signingSecret ?? generateWebhookSecret() }).where(eq(appWebhookEndpoints.id, existing.id));
    return;
  }

  await db.insert(appWebhookEndpoints).values({
    appId,
    name: 'default',
    url,
    enabled: Boolean(url),
    eventFilters: eventFilters ?? [],
    signingSecret: generateWebhookSecret()
  });
}

export async function registerAdminApiRoutes(app: FastifyInstance, options: AdminRouteOptions) {
  app.addHook('preHandler', async (request, reply) => {
    const isTwitchOAuthCallback = /^\/api\/admin\/twitch\/(bot|broadcaster)\/callback(?:\?|$)/.test(request.url);
    if (request.url.startsWith('/api/admin/') && !isTwitchOAuthCallback && !authorizeAdmin(options.config, request, reply)) {
      return;
    }
  });

  app.get('/api/admin/shell', async () => ({
    service: 'erwin-gateway',
    phase: 'phase-10-mvp-hardening',
    pages: adminPages,
    adminAuth: 'internal_admin_api_key',
    message: 'Admin UI shell is available with app registry, Twitch setup, outgoing queue, and text command management.'
  }));


  app.get('/api/admin/diagnostics', async (_request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const recentEvents = await options.db.select().from(events).orderBy(desc(events.createdAt)).limit(25);
    return { twitchData: await twitchDataDiagnostics(options.db), channelPoints: await channelPointDiagnostics(options.db), recentEvents };
  });

  app.get('/api/admin/apps', async (_request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;

    const records = await options.db.select().from(apps).orderBy(apps.slug);
    const appIds = records.map((record) => record.id);
    const [keys, webhooks] = await Promise.all([
      appIds.length ? options.db.select().from(appApiKeys).orderBy(desc(appApiKeys.createdAt)) : Promise.resolve([]),
      appIds.length ? options.db.select().from(appWebhookEndpoints).orderBy(desc(appWebhookEndpoints.createdAt)) : Promise.resolve([])
    ]);

    return {
      permissions: appPermissions,
      defaultAppPermissions,
      apps: records.map((record) => serializeApp(
        record,
        keys.filter((key) => key.appId === record.id),
        webhooks.find((webhook) => webhook.appId === record.id)
      ))
    };
  });

  app.post('/api/admin/apps', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;

    const parsed = createAppSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid app payload', issues: parsed.error.issues });
    }

    const permissions = normalizePermissions(parsed.data.permissions);
    const [created] = await options.db.insert(apps).values({
      name: parsed.data.name,
      slug: parsed.data.slug,
      enabled: parsed.data.enabled ?? true,
      description: parsed.data.description ?? null,
      permissions
    }).returning();

    if (!created) return reply.code(500).send({ error: 'App was not created' });
    await upsertDefaultWebhook(options.db, created.id, parsed.data.webhookUrl, parsed.data.webhookEventFilters);
    await audit(options.db, 'app.create', 'app', created.id, { slug: created.slug, permissions });

    const webhook = await getFirstWebhook(options.db, created.id);
    return reply.code(201).send({ app: serializeApp(created, [], webhook) });
  });

  app.get('/api/admin/apps/:id', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid app id' });

    const [record] = await options.db.select().from(apps).where(eq(apps.id, params.data.id)).limit(1);
    if (!record) return reply.code(404).send({ error: 'App not found' });

    const [keys, webhook] = await Promise.all([
      options.db.select().from(appApiKeys).where(eq(appApiKeys.appId, record.id)).orderBy(desc(appApiKeys.createdAt)),
      getFirstWebhook(options.db, record.id)
    ]);

    return { app: serializeApp(record, keys, webhook) };
  });

  app.patch('/api/admin/apps/:id', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid app id' });

    const parsed = updateAppSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid app payload', issues: parsed.error.issues });

    const updateValues: Partial<typeof apps.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updateValues.name = parsed.data.name;
    if (parsed.data.slug !== undefined) updateValues.slug = parsed.data.slug;
    if (parsed.data.description !== undefined) updateValues.description = parsed.data.description ?? null;
    if (parsed.data.enabled !== undefined) updateValues.enabled = parsed.data.enabled;
    if (parsed.data.permissions !== undefined) updateValues.permissions = normalizePermissions(parsed.data.permissions);

    const [updated] = await options.db.update(apps).set(updateValues).where(eq(apps.id, params.data.id)).returning();
    if (!updated) return reply.code(404).send({ error: 'App not found' });

    await upsertDefaultWebhook(options.db, updated.id, parsed.data.webhookUrl, parsed.data.webhookEventFilters);
    await audit(options.db, 'app.update', 'app', updated.id, {
      changedFields: Object.keys(parsed.data).filter((field) => field !== 'webhookUrl')
    });

    const [keys, webhook] = await Promise.all([
      options.db.select().from(appApiKeys).where(eq(appApiKeys.appId, updated.id)).orderBy(desc(appApiKeys.createdAt)),
      getFirstWebhook(options.db, updated.id)
    ]);

    return { app: serializeApp(updated, keys, webhook) };
  });

  app.delete('/api/admin/apps/:id', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid app id' });

    const [record] = await options.db.select().from(apps).where(eq(apps.id, params.data.id)).limit(1);
    if (!record) return reply.code(404).send({ error: 'App not found' });

    const archivedAt = new Date();
    const archivedSlug = buildArchivedSlug(record.slug, record.id);
    const [archived] = await options.db.update(apps).set({
      slug: archivedSlug,
      enabled: false,
      archivedAt,
      updatedAt: archivedAt
    }).where(eq(apps.id, record.id)).returning();

    const [revokedKeys, disabledWebhooks] = await Promise.all([
      options.db.update(appApiKeys).set({
        revokedAt: archivedAt,
        updatedAt: archivedAt
      }).where(and(eq(appApiKeys.appId, record.id), isNull(appApiKeys.revokedAt))).returning(),
      options.db.update(appWebhookEndpoints).set({
        enabled: false,
        updatedAt: archivedAt
      }).where(eq(appWebhookEndpoints.appId, record.id)).returning()
    ]);

    await audit(options.db, 'app.archive', 'app', record.id, {
      slug: record.slug,
      archivedSlug,
      archivalStrategy: 'archive-with-reusable-slug',
      previousEnabled: record.enabled,
      revokedApiKeyIds: revokedKeys.map((key) => key.id),
      disabledWebhookEndpointIds: disabledWebhooks.map((webhook) => webhook.id)
    });

    const keys = await options.db.select().from(appApiKeys).where(eq(appApiKeys.appId, record.id)).orderBy(desc(appApiKeys.createdAt));
    const webhook = await getFirstWebhook(options.db, record.id);
    return { archived: true, app: serializeApp(archived ?? { ...record, slug: archivedSlug, enabled: false, archivedAt, updatedAt: archivedAt }, keys, webhook), archivedAt: archivedAt.toISOString(), previousSlug: record.slug, archivedSlug };
  });

  app.post('/api/admin/apps/:id/keys', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid app id' });
    const parsed = createKeySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid key payload', issues: parsed.error.issues });

    const [record] = await options.db.select().from(apps).where(eq(apps.id, params.data.id)).limit(1);
    if (!record) return reply.code(404).send({ error: 'App not found' });

    const generated = generateAppApiKey(options.config);
    const [createdKey] = await options.db.insert(appApiKeys).values({
      appId: record.id,
      name: parsed.data.name,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash
    }).returning();

    if (!createdKey) return reply.code(500).send({ error: 'API key was not created' });
    await audit(options.db, 'app_api_key.create', 'app_api_key', createdKey.id, {
      appId: record.id,
      keyPrefix: generated.keyPrefix
    });

    return reply.code(201).send({
      apiKey: serializeKey(createdKey),
      rawKey: generated.rawKey,
      rawKeyShownOnlyOnce: true
    });
  });





  app.post('/api/admin/apps/:id/webhook-secret', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid app id' });
    const [record] = await options.db.select().from(apps).where(eq(apps.id, params.data.id)).limit(1);
    if (!record) return reply.code(404).send({ error: 'App not found' });
    const webhook = await getFirstWebhook(options.db, record.id);
    if (!webhook) return reply.code(404).send({ error: 'Webhook not found' });
    const rawSecret = generateWebhookSecret();
    const [updated] = await options.db.update(appWebhookEndpoints).set({ signingSecret: rawSecret, updatedAt: new Date() }).where(eq(appWebhookEndpoints.id, webhook.id)).returning();
    await audit(options.db, 'app_webhook_secret.rotate', 'app_webhook_endpoint', webhook.id, { appId: record.id });
    return { webhook: serializeWebhook(updated), rawSecret, rawSecretShownOnlyOnce: true };
  });

  app.post('/api/admin/apps/:id/webhook-test', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid app id' });
    const [record] = await options.db.select().from(apps).where(eq(apps.id, params.data.id)).limit(1);
    if (!record) return reply.code(404).send({ error: 'App not found' });
    const webhook = await getFirstWebhook(options.db, record.id);
    if (!webhook?.url || !webhook.enabled) return reply.code(400).send({ error: 'App webhook is not enabled' });
    const [event] = await options.db.insert(events).values({
      source: 'admin',
      type: 'gateway.webhook.test',
      externalId: `webhook-test-${Date.now()}`,
      payload: { test: true, app_id: record.id, message: 'Webhook test from erwin-gateway' },
      status: 'processed',
      processedAt: new Date()
    }).returning();
    if (!event) return reply.code(500).send({ error: 'Test event was not created' });
    const [delivery] = await options.db.insert(webhookDeliveries).values({ appId: record.id, endpointId: webhook.id, eventId: event.id, status: 'queued', payload: { schema: 'erwin.gateway.webhook.v1', delivery_id: null, event_id: event.id, type: event.type, occurred_at: event.occurredAt.toISOString(), received_at: event.createdAt.toISOString(), test: true, app_id: record.id, message: 'Webhook test from erwin-gateway' } }).returning();
    if (!delivery) return reply.code(500).send({ error: 'Test delivery was not created' });
    return { delivery: await deliverWebhookNow(options.db, delivery.id, true) };
  });


  app.get('/api/admin/twitch/primary-channel/command-prefix', async (_request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const [channel] = await options.db.select().from(twitchChannels).where(eq(twitchChannels.primaryChannel, true)).limit(1);
    if (!channel) return reply.code(404).send({ error: 'Primary Twitch channel not found' });
    return { channelId: channel.id, commandPrefix: channel.commandPrefix };
  });

  app.patch('/api/admin/twitch/primary-channel/command-prefix', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const parsed = z.object({ commandPrefix: z.string().trim().min(1).max(8) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid command prefix payload', issues: parsed.error.issues });
    const [existing] = await options.db.select().from(twitchChannels).where(eq(twitchChannels.primaryChannel, true)).limit(1);
    if (!existing) return reply.code(404).send({ error: 'Primary Twitch channel not found' });
    const [channel] = await options.db.update(twitchChannels).set({ commandPrefix: parsed.data.commandPrefix, updatedAt: new Date() }).where(eq(twitchChannels.id, existing.id)).returning();
    await audit(options.db, 'twitch_channel.command_prefix.update', 'twitch_channel', channel!.id, { commandPrefix: channel!.commandPrefix });
    return { channelId: channel!.id, commandPrefix: channel!.commandPrefix };
  });

  app.get('/api/admin/text-commands', async (_request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    return { commands: await listTextCommands(options.db) };
  });

  app.post('/api/admin/text-commands', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const parsed = textCommandSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid text command payload', issues: parsed.error.issues });
    const result = await createTextCommand(options.db, parsed.data);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error, issues: result.issues });
    await audit(options.db, 'text_command.create', 'text_command', result.command.id, { command: result.command.command });
    return reply.code(201).send({ command: result.command });
  });

  app.get('/api/admin/text-commands/:id', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid text command id' });
    const command = await getTextCommand(options.db, params.data.id);
    if (!command) return reply.code(404).send({ error: 'Text command not found' });
    return { command, invocations: await listTextCommandInvocations(options.db, params.data.id) };
  });

  app.patch('/api/admin/text-commands/:id', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid text command id' });
    const parsed = updateTextCommandSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid text command payload', issues: parsed.error.issues });
    const result = await updateTextCommand(options.db, params.data.id, parsed.data);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error, issues: 'issues' in result ? result.issues : undefined });
    await audit(options.db, 'text_command.update', 'text_command', result.command.id, { command: result.command.command });
    return { command: result.command };
  });

  app.delete('/api/admin/text-commands/:id', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid text command id' });
    const command = await archiveTextCommand(options.db, params.data.id);
    if (!command) return reply.code(404).send({ error: 'Text command not found' });
    await audit(options.db, 'text_command.archive', 'text_command', command.id, { command: command.command });
    return { command };
  });

  app.post('/api/admin/text-commands/:id/test', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid text command id' });
    const body = z.object({ user: z.string().optional(), displayName: z.string().optional(), channel: z.string().optional() }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Invalid test payload', issues: body.error.issues });
    const result = await testTextCommand(options.db, params.data.id, body.data);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    await audit(options.db, 'text_command.test', 'text_command', params.data.id, { status: result.result.status });
    return result;
  });

  app.get('/api/admin/chat/log', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const query = z.object({ q: z.string().optional(), command: z.string().optional(), limit: z.coerce.number().int().positive().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query', issues: query.error.issues });
    return { messages: await listChatLog(options.db, query.data) };
  });


  app.get('/api/admin/outgoing-chat/messages', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const query = z.object({
      status: z.string().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      limit: z.coerce.number().int().positive().optional()
    }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query', issues: query.error.issues });
    return { messages: await listOutgoingChatMessages(options.db, query.data) };
  });

  app.get('/api/admin/outgoing-chat/messages/:messageId', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ messageId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid message id' });
    const result = await getOutgoingChatMessage(options.db, params.data.messageId);
    if (!result) return reply.code(404).send({ error: 'Message not found' });
    return result;
  });

  app.post('/api/admin/outgoing-chat/messages/:messageId/retry', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ messageId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid message id' });
    const message = await retryOutgoingChatMessage(options.db, options.config, params.data.messageId);
    if (!message) return reply.code(404).send({ error: 'Message not found' });
    await audit(options.db, 'outgoing_chat.retry', 'outgoing_chat_message', message.id, { status: message.status });
    return { message };
  });

  app.get('/api/admin/webhook-deliveries', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const query = z.object({ status: z.string().optional(), limit: z.coerce.number().int().positive().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query', issues: query.error.issues });
    return { deliveries: await listWebhookDeliveries(options.db, query.data) };
  });

  app.get('/api/admin/webhook-deliveries/:deliveryId', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ deliveryId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid delivery id' });
    const result = await getWebhookDeliveryWithAttempts(options.db, params.data.deliveryId);
    if (!result) return reply.code(404).send({ error: 'Delivery not found' });
    return result;
  });

  app.post('/api/admin/webhook-deliveries/:deliveryId/retry', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ deliveryId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid delivery id' });
    const delivery = await deliverWebhookNow(options.db, params.data.deliveryId, true);
    if (!delivery) return reply.code(404).send({ error: 'Delivery not found' });
    return { delivery };
  });


  const adminChannelPointApp = { id: '00000000-0000-0000-0000-000000000000', slug: 'admin', permissions: ['channel_points:rewards:read', 'channel_points:rewards:create', 'channel_points:rewards:update', 'channel_points:rewards:delete', 'channel_points:redemptions:read', 'channel_points:redemptions:manage', 'channel_points:events:receive'] };
  const adminRewardPayloadSchema = z.object({
    title: z.string().min(1).max(45).optional(),
    cost: z.number().int().min(1).max(1_000_000_000).optional(),
    prompt: z.string().max(200).optional().nullable(),
    owning_app_id: z.preprocess((value) => value === '' ? undefined : value, z.string().uuid().optional()),
    is_enabled: z.boolean().optional(),
    background_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    is_user_input_required: z.boolean().optional(),
    should_redemptions_skip_request_queue: z.boolean().optional()
  });

  app.get('/api/admin/channel-points', async (_request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const rewards = await listRewards(options.db, adminChannelPointApp, { includeDeleted: true });
    const redemptions = await listRedemptions(options.db, adminChannelPointApp, { limit: 25 });
    return { rewards: rewards.ok ? rewards.rewards : [], redemptions: redemptions.ok ? redemptions.redemptions : [], diagnostics: await channelPointDiagnostics(options.db) };
  });

  app.post('/api/admin/channel-points/rewards/sync', async (_request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const result = await syncRewards(options.db, options.config, null);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    await audit(options.db, 'channel_points.rewards.sync', 'channel_point_reward', 'all', { runId: result.run.id });
    return { run: result.run, rewards: result.rewards };
  });

  app.post('/api/admin/channel-points/rewards', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const body = adminRewardPayloadSchema.extend({ title: z.string().min(1).max(45), cost: z.number().int().min(1).max(1_000_000_000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid reward payload', issues: body.error.issues });
    const [owner] = body.data.owning_app_id
      ? await options.db.select().from(apps).where(eq(apps.id, body.data.owning_app_id)).limit(1)
      : await options.db.select().from(apps).where(eq(apps.slug, 'erwin-hatchery')).limit(1);
    if (!owner && body.data.owning_app_id) return reply.code(400).send({ error: 'Owning app not found for admin reward creation' });
    if (!owner) return reply.code(400).send({ error: 'Select an owning app for admin reward creation; no owning_app_id was provided and default app erwin-hatchery was not found' });
    const ownerApp = { id: owner.id, slug: owner.slug, permissions: adminChannelPointApp.permissions };
    const result = await createReward(options.db, options.config, ownerApp, body.data);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    await audit(options.db, 'channel_points.reward.create_admin_override', 'channel_point_reward', result.reward.id, { explicitAdminOverride: true });
    return reply.code(201).send({ reward: result.reward });
  });

  app.patch('/api/admin/channel-points/rewards/:rewardId', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ rewardId: z.string().uuid() }).safeParse(request.params);
    const body = adminRewardPayloadSchema.safeParse(request.body);
    if (!params.success) return reply.code(400).send({ error: 'Invalid reward id' });
    if (!body.success) return reply.code(400).send({ error: 'Invalid reward payload', issues: body.error.issues });
    const [reward] = await options.db.select().from(twitchChannelPointRewards).where(eq(twitchChannelPointRewards.id, params.data.rewardId)).limit(1);
    const overrideApp = { ...adminChannelPointApp, id: reward?.owningAppId ?? adminChannelPointApp.id };
    const result = await updateReward(options.db, options.config, overrideApp, params.data.rewardId, body.data);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    await audit(options.db, 'channel_points.reward.update_admin_override', 'channel_point_reward', params.data.rewardId, { explicitAdminOverride: true });
    return { reward: result.reward };
  });

  app.delete('/api/admin/channel-points/rewards/:rewardId', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ rewardId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid reward id' });
    const [reward] = await options.db.select().from(twitchChannelPointRewards).where(eq(twitchChannelPointRewards.id, params.data.rewardId)).limit(1);
    const overrideApp = { ...adminChannelPointApp, id: reward?.owningAppId ?? adminChannelPointApp.id };
    const result = await deleteReward(options.db, options.config, overrideApp, params.data.rewardId);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    await audit(options.db, 'channel_points.reward.delete_admin_override', 'channel_point_reward', params.data.rewardId, { explicitAdminOverride: true });
    return { reward: result.reward };
  });

  await registerTwitchAdminRoutes(app, options);

  app.delete('/api/admin/apps/:id/keys/:keyId', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const params = z.object({ id: z.string().uuid(), keyId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid app or key id' });

    const [revoked] = await options.db.update(appApiKeys).set({
      revokedAt: new Date(),
      updatedAt: new Date()
    }).where(and(eq(appApiKeys.id, params.data.keyId), eq(appApiKeys.appId, params.data.id))).returning();

    if (!revoked) return reply.code(404).send({ error: 'API key not found' });

    await audit(options.db, 'app_api_key.revoke', 'app_api_key', revoked.id, {
      appId: params.data.id,
      keyPrefix: revoked.keyPrefix
    });

    return { apiKey: serializeKey(revoked) };
  });
}
