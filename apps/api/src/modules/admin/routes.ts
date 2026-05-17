import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { adminAuditLog, appApiKeys, apps, appWebhookEndpoints, events, webhookDeliveries } from '../../db/schema.js';
import { generateAppApiKey } from '../apps/api-keys.js';
import { appPermissions, defaultAppPermissions, normalizePermissions } from '../apps/permissions.js';
import { registerTwitchAdminRoutes } from '../twitch/routes.js';
import { deliverWebhookNow, generateWebhookSecret, getWebhookDeliveryWithAttempts, listChatLog, listWebhookDeliveries } from '../webhooks/service.js';

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
    return true;
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
    updatedAt: appRecord.updatedAt.toISOString(),
    apiKeys: keys.map(serializeKey),
    webhook: serializeWebhook(webhook)
  };
}

async function audit(db: Database, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  await db.insert(adminAuditLog).values({ action, targetType, targetId, metadata });
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
    if (request.url.startsWith('/api/admin/') && !authorizeAdmin(options.config, request, reply)) {
      return;
    }
  });

  app.get('/api/admin/shell', async () => ({
    service: 'erwin-gateway',
    phase: 'phase-3-twitch-auth',
    pages: adminPages,
    adminAuth: options.config.INTERNAL_ADMIN_API_KEY ? 'internal_admin_api_key' : 'not_configured_for_development',
    message: 'Admin UI shell is available with app registry and Twitch setup management.'
  }));

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

  app.get('/api/admin/chat/log', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const query = z.object({ q: z.string().optional(), command: z.string().optional(), limit: z.coerce.number().int().positive().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query', issues: query.error.issues });
    return { messages: await listChatLog(options.db, query.data) };
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
