import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { enqueueEventFromNotification, getEventSubDiagnostics, persistEventSubMessage, reconcileEventSubSubscriptions, recordRevocation } from './service.js';
import { verifyEventSubSignature } from './signature.js';
import { normalizeChatMessageEvent } from '../webhooks/service.js';
import { normalizeChannelPointRedemptionEvent } from '../channel-points/service.js';
import { normalizeTwitchDataEvent } from '../twitch-data.js';

interface EventSubRouteOptions {
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

function stringHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function selectedHeaders(headers: Record<string, string | string[] | undefined>) {
  return {
    'twitch-eventsub-message-id': stringHeader(headers['twitch-eventsub-message-id']),
    'twitch-eventsub-message-type': stringHeader(headers['twitch-eventsub-message-type']),
    'twitch-eventsub-message-timestamp': stringHeader(headers['twitch-eventsub-message-timestamp']),
    'twitch-eventsub-message-retry': stringHeader(headers['twitch-eventsub-message-retry']),
    'twitch-eventsub-subscription-type': stringHeader(headers['twitch-eventsub-subscription-type']),
    'twitch-eventsub-subscription-version': stringHeader(headers['twitch-eventsub-subscription-version'])
  };
}

export async function registerTwitchEventSubRoutes(app: FastifyInstance, options: EventSubRouteOptions) {
  app.post('/webhooks/twitch/eventsub', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    if (!options.config.TWITCH_EVENTSUB_SECRET) return reply.code(503).send({ error: 'EventSub secret is not configured' });

    const messageId = stringHeader(request.headers['twitch-eventsub-message-id']);
    const timestamp = stringHeader(request.headers['twitch-eventsub-message-timestamp']);
    const signature = stringHeader(request.headers['twitch-eventsub-message-signature']);
    const messageType = stringHeader(request.headers['twitch-eventsub-message-type']);
    const rawBody = (request.raw as any).rawBody as Buffer | undefined;

    if (!messageId || !timestamp || !signature || !messageType || !rawBody) {
      return reply.code(400).send({ error: 'Missing required EventSub headers or raw body' });
    }

    if (!verifyEventSubSignature({ secret: options.config.TWITCH_EVENTSUB_SECRET, messageId, timestamp, rawBody, signature })) {
      request.log.warn({ messageId, messageType }, 'Rejected Twitch EventSub request with invalid signature');
      return reply.code(403).send({ error: 'Invalid Twitch EventSub signature' });
    }

    const payload = request.body as any;
    const persisted = await persistEventSubMessage(options.db, {
      messageId,
      messageType,
      headers: selectedHeaders(request.headers),
      payload
    });

    if (persisted.duplicate) {
      return reply.code(204).send();
    }

    if (messageType === 'webhook_callback_verification') {
      if (typeof payload?.challenge !== 'string') return reply.code(400).send({ error: 'Missing challenge' });
      return reply.header('Content-Type', 'text/plain').code(200).send(payload.challenge);
    }

    if (messageType === 'notification') {
      await enqueueEventFromNotification(options.db, messageId, payload);
      await normalizeChatMessageEvent(options.db, { rawMessageId: messageId, rawEventsubMessageId: persisted.row?.id ?? null, payload });
      await normalizeChannelPointRedemptionEvent(options.db, { rawMessageId: messageId, rawEventsubMessageId: persisted.row?.id ?? null, payload });
      await normalizeTwitchDataEvent(options.db, { rawMessageId: messageId, rawEventsubMessageId: persisted.row?.id ?? null, payload });
      return reply.code(204).send();
    }

    if (messageType === 'revocation') {
      await recordRevocation(options.db, payload);
      return reply.code(204).send();
    }

    return reply.code(400).send({ error: `Unsupported EventSub message type: ${messageType}` });
  });

  app.post('/api/admin/twitch/eventsub/sync', async (_request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    return { result: await reconcileEventSubSubscriptions(options.db, options.config) };
  });

  app.get('/api/admin/twitch/eventsub/status', async (_request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    return getEventSubDiagnostics(options.db, options.config);
  });
}
