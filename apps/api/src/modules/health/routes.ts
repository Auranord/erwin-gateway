import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import type { HealthResponse } from '@erwin-gateway/shared';
import { getTwitchSetupStatus } from '../twitch/service.js';
import { getEventSubDiagnostics } from '../twitch-eventsub/service.js';
import { getOutgoingChatHealth } from '../twitch-chat/service.js';

interface HealthRouteOptions {
  config: AppConfig;
  pool?: Pool;
  db?: Database;
}

function baseHealth(config: AppConfig, status: HealthResponse['status']): HealthResponse & {
  build: Record<string, string>;
} {
  return {
    status,
    service: 'erwin-gateway',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.1.0',
    build: {
      sha: config.BUILD_SHA,
      branch: config.BUILD_BRANCH,
      imageTag: config.IMAGE_TAG
    }
  };
}

async function databaseReachable(pool?: Pool) {
  if (!pool) return 'not_configured';
  await pool.query('select 1');
  return 'reachable';
}

export async function registerHealthRoutes(app: FastifyInstance, options: HealthRouteOptions) {
  app.get('/api/v1/health/live', async () => baseHealth(options.config, 'healthy'));

  app.get('/api/v1/health/ready', async (request, reply) => {
    try {
      const database = await databaseReachable(options.pool);
      if (database !== 'reachable') {
        return reply.code(503).send({ ...baseHealth(options.config, 'degraded'), checks: { database } });
      }

      const twitch = options.db ? await getTwitchSetupStatus(options.db, options.config) : null;
      const ready = twitch?.status !== 'degraded';
      return reply.code(ready ? 200 : 503).send({
        ...baseHealth(options.config, ready ? 'ready' : 'degraded'),
        checks: {
          database,
          migrations: 'phase_3_twitch_auth_expected',
          workers: 'twitch_token_worker_registered',
          twitchAuth: twitch?.status ?? 'not_configured'
        }
      });
    } catch (error) {
      request.log.warn({ error }, 'readiness check failed');
      return reply.code(503).send({ ...baseHealth(options.config, 'degraded'), checks: { database: 'unreachable' } });
    }
  });

  app.get('/api/v1/health/deep', async (request, reply) => {
    const checks: Record<string, unknown> = {
      database: 'not_configured',
      migrations: 'phase_3_twitch_auth_expected',
      workers: { twitchTokenRefresh: Boolean(options.db), outgoingChat: Boolean(options.db) },
      eventSub: 'not_checked',
      queues: 'not_checked'
    };

    let status: HealthResponse['status'] = 'healthy';
    try {
      checks.database = await databaseReachable(options.pool);
    } catch (error) {
      request.log.warn({ error }, 'deep health database check failed');
      checks.database = 'unreachable';
      status = 'degraded';
    }

    if (options.db) {
      try {
        const twitch = await getTwitchSetupStatus(options.db, options.config);
        checks.twitch = {
          appTokenValidity: twitch.appToken,
          botTokenValidity: twitch.bot,
          broadcasterTokenValidity: twitch.broadcaster,
          missingScopes: {
            bot: twitch.bot.missingScopes,
            broadcaster: twitch.broadcaster.missingScopes
          },
          tokenExpiry: {
            bot: twitch.bot.expiresAt,
            broadcaster: twitch.broadcaster.expiresAt
          },
          tokenRefreshErrors: {
            bot: twitch.bot.lastRefreshError,
            broadcaster: twitch.broadcaster.lastRefreshError
          },
          degradedReasons: twitch.degradedReasons
        };
        if (twitch.status === 'degraded') status = 'degraded';

        const eventSub = await getEventSubDiagnostics(options.db, options.config);
        checks.eventSub = {
          status: eventSub.healthy ? 'healthy' : 'degraded',
          callbackUrl: eventSub.callbackUrl,
          lastDelivery: eventSub.lastDelivery,
          subscriptionCount: eventSub.subscriptions.length,
          missingSubscriptions: eventSub.missingSubscriptions,
          revokedSubscriptions: eventSub.revokedSubscriptions,
          duplicateCount: eventSub.duplicateCount,
          desiredError: eventSub.desiredError
        };
        if (!eventSub.healthy) status = 'degraded';

        const outgoingChat = await getOutgoingChatHealth(options.db);
        checks.queues = {
          outgoingChat: {
            queueDepth: outgoingChat.queueDepth,
            oldestQueuedAgeSeconds: outgoingChat.oldestQueuedAgeSeconds,
            lastSuccessfulSend: outgoingChat.lastSuccessfulSend,
            deadLetterCount: outgoingChat.deadLetterCount
          }
        };
        checks.rateLimitState = outgoingChat.rateLimits;
        if (outgoingChat.deadLetterCount > 0 || (outgoingChat.oldestQueuedAgeSeconds !== null && outgoingChat.oldestQueuedAgeSeconds > 300)) status = 'degraded';
      } catch (error) {
        checks.twitch = { status: 'degraded', error: error instanceof Error ? error.message : 'unknown Twitch health error' };
        status = 'degraded';
      }
    } else {
      checks.twitch = { status: 'not_configured' };
      status = 'degraded';
    }

    return reply.code(status === 'healthy' ? 200 : 503).send({ ...baseHealth(options.config, status), checks });
  });
}
