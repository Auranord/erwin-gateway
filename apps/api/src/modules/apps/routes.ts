import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { appApiKeys, apps } from '../../db/schema.js';
import { deliverWebhookNow, getEvent, getWebhookDeliveryWithAttempts, listChatLog, listEvents, listWebhookDeliveries } from '../webhooks/service.js';
import { z } from 'zod';
import { extractKeyPrefix, hashAppApiKey, safeCompareHashes } from './api-keys.js';

interface AppRouteOptions {
  config: AppConfig;
  db?: Database;
}

interface AuthenticatedApp {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  permissions: string[];
  apiKey: {
    id: string;
    name: string;
    keyPrefix: string;
  };
}

interface AuthenticatedAppRequest extends FastifyRequest {
  authenticatedApp?: AuthenticatedApp;
}

async function authenticateAppApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
  options: AppRouteOptions
): Promise<AuthenticatedApp | null> {
  if (!options.db) {
    reply.code(503).send({ error: 'Database is not configured' });
    return null;
  }

  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'App API key is required' });
    return null;
  }

  const rawKey = authorization.slice('Bearer '.length).trim();
  const keyPrefix = extractKeyPrefix(rawKey);
  if (!keyPrefix) {
    reply.code(401).send({ error: 'Invalid app API key' });
    return null;
  }

  const [keyRecord] = await options.db
    .select()
    .from(appApiKeys)
    .where(and(eq(appApiKeys.keyPrefix, keyPrefix), isNull(appApiKeys.revokedAt)))
    .limit(1);

  if (!keyRecord) {
    reply.code(401).send({ error: 'Invalid app API key' });
    return null;
  }

  const candidateHash = hashAppApiKey(rawKey, options.config);
  if (!safeCompareHashes(candidateHash, keyRecord.keyHash)) {
    reply.code(401).send({ error: 'Invalid app API key' });
    return null;
  }

  const [appRecord] = await options.db.select().from(apps).where(eq(apps.id, keyRecord.appId)).limit(1);
  if (!appRecord || !appRecord.enabled) {
    reply.code(403).send({ error: 'App is disabled' });
    return null;
  }

  await options.db
    .update(appApiKeys)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(appApiKeys.id, keyRecord.id));

  return {
    id: appRecord.id,
    name: appRecord.name,
    slug: appRecord.slug,
    enabled: appRecord.enabled,
    permissions: appRecord.permissions,
    apiKey: {
      id: keyRecord.id,
      name: keyRecord.name,
      keyPrefix: keyRecord.keyPrefix
    }
  };
}

function appAuthenticationMiddleware(options: AppRouteOptions) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authenticatedApp = await authenticateAppApiKey(request, reply, options);
    if (!authenticatedApp) return;
    (request as AuthenticatedAppRequest).authenticatedApp = authenticatedApp;
  };
}

export async function registerAppApiRoutes(app: FastifyInstance, options: AppRouteOptions) {
  app.get('/api/v1/me', { preHandler: appAuthenticationMiddleware(options) }, async (request) => {
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;

    return {
      app: {
        id: authenticatedApp.id,
        name: authenticatedApp.name,
        slug: authenticatedApp.slug,
        enabled: authenticatedApp.enabled,
        permissions: authenticatedApp.permissions
      },
      apiKey: authenticatedApp.apiKey
    };
  });

  app.get('/api/v1/events', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const query = z.object({ type: z.string().optional(), limit: z.coerce.number().int().positive().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query', issues: query.error.issues });
    return { events: await listEvents(options.db, query.data) };
  });

  app.get('/api/v1/events/:eventId', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const params = z.object({ eventId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid event id' });
    const event = await getEvent(options.db, params.data.eventId);
    if (!event) return reply.code(404).send({ error: 'Event not found' });
    return { event };
  });

  app.get('/api/v1/chat/log', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const query = z.object({ q: z.string().optional(), command: z.string().optional(), limit: z.coerce.number().int().positive().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query', issues: query.error.issues });
    return { messages: await listChatLog(options.db, query.data) };
  });

  app.get('/api/v1/webhook-deliveries', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const query = z.object({ status: z.string().optional(), limit: z.coerce.number().int().positive().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query', issues: query.error.issues });
    return { deliveries: await listWebhookDeliveries(options.db, query.data) };
  });

  app.get('/api/v1/webhook-deliveries/:deliveryId', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const params = z.object({ deliveryId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid delivery id' });
    const result = await getWebhookDeliveryWithAttempts(options.db, params.data.deliveryId);
    if (!result) return reply.code(404).send({ error: 'Delivery not found' });
    return result;
  });

  app.post('/api/v1/webhook-deliveries/:deliveryId/retry', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const params = z.object({ deliveryId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid delivery id' });
    const delivery = await deliverWebhookNow(options.db, params.data.deliveryId, true);
    if (!delivery) return reply.code(404).send({ error: 'Delivery not found' });
    return { delivery };
  });

}
