import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { appApiKeys, apps } from '../../db/schema.js';
import { createOutgoingChatMessage, getOutgoingChatMessage, listOutgoingChatMessages } from '../twitch-chat/service.js';
import { adoptReward, createReward, deleteReward, fetchRedemptionsFromTwitch, getReward, listRedemptions, listRewards, releaseReward, syncRewards, updateRedemptionStatus, updateReward } from '../channel-points/service.js';
import { deliverWebhookNow, getEvent, getWebhookDeliveryWithAttempts, listChatLog, listEvents, listWebhookDeliveries } from '../webhooks/service.js';
import { getChannelProfile, getChannelSchedule, getCurrentStream, listBitsLeaderboard, listChannels, listSubscriptions } from '../twitch-data.js';
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

function gatewayErrorBody(result: { error: string; code?: string; details?: unknown; twitchStatus?: number; twitchErrorExcerpt?: string }) {
  return { error: result.error, code: result.code ?? 'request_failed', details: result.details ?? null, ...(result.twitchStatus ? { twitchStatus: result.twitchStatus } : {}), ...(result.twitchErrorExcerpt ? { twitchErrorExcerpt: result.twitchErrorExcerpt } : {}) };
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


  app.post('/api/v1/chat/messages', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const body = z.object({
      channel_id: z.string().uuid().optional(),
      channel_login: z.string().min(1).max(80).optional(),
      broadcaster_user_id: z.string().min(1).max(80).optional(),
      message: z.string().min(1).max(500),
      reply_parent_message_id: z.string().max(128).optional().nullable(),
      for_source_only: z.boolean().optional(),
      idempotency_key: z.string().min(8).max(200),
      priority: z.number().int().min(-100).max(100).optional()
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid outgoing chat message', issues: body.error.issues });
    const result = await createOutgoingChatMessage(options.db, authenticatedApp, body.data);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error, issues: result.issues });
    if (result.idempotencyConflict) return reply.code(409).send({ error: 'Idempotency key was already used for different message parameters', message: result.message });
    return reply.code(result.duplicate ? 200 : 202).send({ message: result.message, duplicate: result.duplicate });
  });

  app.get('/api/v1/chat/messages', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const query = z.object({
      status: z.string().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      limit: z.coerce.number().int().positive().optional()
    }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query', issues: query.error.issues });
    return { messages: await listOutgoingChatMessages(options.db, query.data) };
  });

  app.get('/api/v1/chat/messages/:id', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid message id' });
    const result = await getOutgoingChatMessage(options.db, params.data.id);
    if (!result) return reply.code(404).send({ error: 'Message not found' });
    return result;
  });


  const rewardPayloadSchema = z.object({
    title: z.string().min(1).max(45).optional(),
    cost: z.number().int().min(1).max(1_000_000_000).optional(),
    prompt: z.string().max(200).optional().nullable(),
    is_enabled: z.boolean().optional(),
    background_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    is_user_input_required: z.boolean().optional(),
    is_max_per_stream_enabled: z.boolean().optional(),
    max_per_stream: z.number().int().positive().optional(),
    is_max_per_user_per_stream_enabled: z.boolean().optional(),
    max_per_user_per_stream: z.number().int().positive().optional(),
    is_global_cooldown_enabled: z.boolean().optional(),
    global_cooldown_seconds: z.number().int().positive().optional(),
    should_redemptions_skip_request_queue: z.boolean().optional()
  });
  const createRewardSchema = rewardPayloadSchema.extend({ title: z.string().min(1).max(45), cost: z.number().int().min(1).max(1_000_000_000), app_ownership_key: z.string().min(1).max(200).optional(), local_reward_type: z.string().min(1).max(120).optional() });
  const adoptRewardSchema = z.object({ app_ownership_key: z.string().min(1).max(200), expected_twitch_reward_id: z.string().min(1).optional(), local_reward_type: z.string().min(1).max(120).optional() });

  app.get('/api/v1/channel-points/rewards', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const query = z.object({ include_deleted: z.coerce.boolean().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query', issues: query.error.issues });
    const result = await listRewards(options.db, authenticatedApp, { includeDeleted: query.data.include_deleted });
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { rewards: result.rewards };
  });

  app.post('/api/v1/channel-points/rewards', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const body = createRewardSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid reward payload', issues: body.error.issues });
    const result = await createReward(options.db, options.config, authenticatedApp, body.data);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return reply.code(result.statusCode).send({ reward: result.reward });
  });

  app.post('/api/v1/channel-points/rewards/sync', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const result = await syncRewards(options.db, options.config, authenticatedApp);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { run: result.run, rewards: result.rewards };
  });

  app.get('/api/v1/channel-points/rewards/:rewardId', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const params = z.object({ rewardId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid reward id' });
    const result = await getReward(options.db, authenticatedApp, params.data.rewardId);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { reward: result.reward };
  });

  app.patch('/api/v1/channel-points/rewards/:rewardId', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const params = z.object({ rewardId: z.string().uuid() }).safeParse(request.params);
    const body = rewardPayloadSchema.safeParse(request.body);
    if (!params.success) return reply.code(400).send({ error: 'Invalid reward id' });
    if (!body.success) return reply.code(400).send({ error: 'Invalid reward payload', issues: body.error.issues });
    const result = await updateReward(options.db, options.config, authenticatedApp, params.data.rewardId, body.data);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { reward: result.reward };
  });

  app.delete('/api/v1/channel-points/rewards/:rewardId', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const params = z.object({ rewardId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid reward id' });
    const result = await deleteReward(options.db, options.config, authenticatedApp, params.data.rewardId);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { reward: result.reward };
  });


  app.post('/api/v1/channel-points/rewards/:rewardId/adopt', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured', code: 'database_not_configured', details: null });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const params = z.object({ rewardId: z.string().uuid() }).safeParse(request.params);
    const body = adoptRewardSchema.safeParse(request.body);
    if (!params.success) return reply.code(400).send({ error: 'Invalid reward id', code: 'invalid_reward_id', details: params.error.issues });
    if (!body.success) return reply.code(400).send({ error: 'Invalid adoption payload', code: 'invalid_adoption_payload', details: body.error.issues });
    const result = await adoptReward(options.db, authenticatedApp, params.data.rewardId, body.data);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { reward: result.reward };
  });

  app.post('/api/v1/channel-points/rewards/:rewardId/release', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured', code: 'database_not_configured', details: null });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const params = z.object({ rewardId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid reward id', code: 'invalid_reward_id', details: params.error.issues });
    const result = await releaseReward(options.db, authenticatedApp, params.data.rewardId);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { reward: result.reward };
  });

  app.get('/api/v1/channel-points/rewards/:rewardId/redemptions', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const params = z.object({ rewardId: z.string().uuid() }).safeParse(request.params);
    const query = z.object({ status: z.string().optional(), sync: z.coerce.boolean().optional(), limit: z.coerce.number().int().positive().optional() }).safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'Invalid redemptions request' });
    const result = query.data.sync ? await fetchRedemptionsFromTwitch(options.db, options.config, authenticatedApp, params.data.rewardId, query.data.status) : await listRedemptions(options.db, authenticatedApp, { rewardId: params.data.rewardId, status: query.data.status, limit: query.data.limit });
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { redemptions: result.redemptions };
  });

  app.get('/api/v1/channel-points/redemptions', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const query = z.object({ status: z.string().optional(), limit: z.coerce.number().int().positive().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query', issues: query.error.issues });
    const result = await listRedemptions(options.db, authenticatedApp, query.data);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { redemptions: result.redemptions };
  });

  app.patch('/api/v1/channel-points/rewards/:rewardId/redemptions/:redemptionId/status', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const params = z.object({ rewardId: z.string().uuid(), redemptionId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ status: z.enum(['FULFILLED', 'CANCELED']), reason: z.string().max(500).optional() }).safeParse(request.body);
    if (!params.success) return reply.code(400).send({ error: 'Invalid reward or redemption id' });
    if (!body.success) return reply.code(400).send({ error: 'Invalid status payload', issues: body.error.issues });
    const result = await updateRedemptionStatus(options.db, options.config, authenticatedApp, params.data.rewardId, params.data.redemptionId, body.data.status, body.data.reason);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { redemption: result.redemption };
  });

  app.get('/api/v1/subscriptions', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const query = z.object({ status: z.string().optional(), limit: z.coerce.number().int().positive().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query', issues: query.error.issues });
    const result = await listSubscriptions(options.db, authenticatedApp, query.data);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { subscriptions: result.subscriptions };
  });

  app.get('/api/v1/bits/leaderboard', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const query = z.object({ period: z.string().optional(), limit: z.coerce.number().int().positive().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query', issues: query.error.issues });
    const result = await listBitsLeaderboard(options.db, authenticatedApp, query.data);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { leaderboard: result.leaderboard };
  });

  app.get('/api/v1/channel/status', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const result = await getCurrentStream(options.db, options.config, authenticatedApp);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return result.status;
  });

  app.get('/api/v1/streams/current', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const result = await getCurrentStream(options.db, options.config, authenticatedApp);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { stream: result.stream, status: result.status };
  });

  app.get('/api/v1/channels', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const result = await listChannels(options.db, authenticatedApp);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { channels: result.channels };
  });

  app.get('/api/v1/channels/:channelId/profile', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const params = z.object({ channelId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid channel id' });
    const result = await getChannelProfile(options.db, options.config, authenticatedApp, params.data.channelId);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { profile: result.profile };
  });

  app.get('/api/v1/channels/:channelId/schedule', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const params = z.object({ channelId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid channel id' });
    const result = await getChannelSchedule(options.db, options.config, authenticatedApp, params.data.channelId);
    if (!result.ok) return reply.code(result.statusCode).send(gatewayErrorBody(result));
    return { schedule: result.schedule };
  });

  app.get('/api/v1/webhook-deliveries', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const query = z.object({ status: z.string().optional(), limit: z.coerce.number().int().positive().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query', issues: query.error.issues });
    return { deliveries: await listWebhookDeliveries(options.db, { ...query.data, appId: authenticatedApp.id }) };
  });

  app.get('/api/v1/webhook-deliveries/:deliveryId', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const params = z.object({ deliveryId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid delivery id' });
    const result = await getWebhookDeliveryWithAttempts(options.db, params.data.deliveryId);
    if (!result || result.delivery.appId !== authenticatedApp.id) return reply.code(404).send({ error: 'Delivery not found' });
    return result;
  });

  app.post('/api/v1/webhook-deliveries/:deliveryId/retry', { preHandler: appAuthenticationMiddleware(options) }, async (request, reply) => {
    if (!options.db) return reply.code(503).send({ error: 'Database is not configured' });
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;
    const params = z.object({ deliveryId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid delivery id' });
    const result = await getWebhookDeliveryWithAttempts(options.db, params.data.deliveryId);
    if (!result || result.delivery.appId !== authenticatedApp.id) return reply.code(404).send({ error: 'Delivery not found' });
    const delivery = await deliverWebhookNow(options.db, params.data.deliveryId, true);
    if (!delivery) return reply.code(404).send({ error: 'Delivery not found' });
    return { delivery };
  });

}
