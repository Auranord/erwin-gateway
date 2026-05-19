import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import type { HealthResponse } from '@erwin-gateway/shared';
import { getTwitchSetupStatus } from '../twitch/service.js';
import { getEventSubDiagnostics } from '../twitch-eventsub/service.js';
import { optionalEventSubTypes, requiredEventSubTypes } from '../twitch-eventsub/desired.js';
import { getOutgoingChatHealth } from '../twitch-chat/service.js';
import { channelPointDiagnostics } from '../channel-points/service.js';
import { twitchDataDiagnostics } from '../twitch-data.js';
import type { StartupReadiness } from '../../app.js';

interface HealthRouteOptions {
  config: AppConfig;
  pool?: Pool;
  db?: Database;
  startupReadiness?: StartupReadiness;
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

      const schemaReady = options.startupReadiness?.migrationsStatus === 'ready';
      const twitch = options.db && schemaReady ? await getTwitchSetupStatus(options.db, options.config) : null;
      const ready = schemaReady && twitch?.status !== 'degraded';
      return reply.code(ready ? 200 : 503).send({
        ...baseHealth(options.config, ready ? 'ready' : 'degraded'),
        checks: {
          database,
          migrations: options.startupReadiness?.migrationsStatus ?? 'unknown',
          workers: options.startupReadiness?.workersStarted ? 'started' : `not_started:${options.startupReadiness?.workerStartReason ?? 'unknown'}`,
          twitchAuth: schemaReady ? twitch?.status ?? 'not_configured' : 'not_checked_schema_missing'
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
      migrations: options.startupReadiness?.migrationsStatus ?? 'unknown',
      workers: {
        started: options.startupReadiness?.workersStarted ?? false,
        reason: options.startupReadiness?.workerStartReason ?? 'unknown'
      },
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

    if (checks.database !== 'reachable' || checks.migrations !== 'ready' || !options.startupReadiness?.workersStarted) {
      status = 'degraded';
    }

    if (options.db && options.startupReadiness?.migrationsStatus === 'ready') {
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
          lastRawEventSubReceivedAt: eventSub.lastDelivery?.receivedAt ?? null,
          lastChannelChatMessageReceivedAt: eventSub.lastChannelChatMessageDelivery?.receivedAt ?? null,
          subscriptionCount: eventSub.subscriptions.length,
          missingSubscriptions: eventSub.missingSubscriptions,
          missingRequiredSubscriptions: eventSub.missingSubscriptions.filter((sub) => requiredEventSubTypes.includes(sub.type)),
          missingOptionalSubscriptions: eventSub.missingSubscriptions.filter((sub) => optionalEventSubTypes.includes(sub.type)),
          chatMessageSubscriptionHealthy: !eventSub.missingSubscriptions.some((sub) => sub.type === 'channel.chat.message'),
          desiredChecks: eventSub.desiredVsLive,
          localSubscriptionExists: eventSub.desiredVsLive.every((sub) => sub.localStatus !== null),
          liveSubscriptionExists: eventSub.desiredVsLive.every((sub) => sub.liveFound),
          liveSubscriptionEnabled: eventSub.desiredVsLive.every((sub) => sub.liveStatus === 'enabled' || sub.liveStatus === 'webhook_callback_verification_pending'),
          callbackMatchesConfigured: eventSub.desiredVsLive.every((sub) => sub.callbackMatches),
          revokedSubscriptions: eventSub.revokedSubscriptions,
          duplicateCount: eventSub.duplicateCount,
          desiredError: eventSub.desiredError,
          liveError: eventSub.liveError
        };
        const missingRequired = eventSub.missingSubscriptions.some((sub) => requiredEventSubTypes.includes(sub.type));
        if (eventSub.desiredError || eventSub.liveError || missingRequired || eventSub.revokedSubscriptions.length > 0 || !eventSub.desiredVsLive.every((sub) => sub.liveFound && sub.callbackMatches && (sub.liveStatus === 'enabled' || sub.liveStatus === 'webhook_callback_verification_pending'))) status = 'degraded';

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

        const channelPoints = await channelPointDiagnostics(options.db);
        checks.channelPoints = {
          missingChannelManageRedemptions: (twitch.broadcaster.missingScopes as string[]).includes('channel:manage:redemptions'),
          lastRewardSync: channelPoints.lastRewardSync,
          lastRedemptionEvent: channelPoints.lastRedemptionEvent,
          rewardsMissingOnTwitch: channelPoints.rewardsMissingOnTwitch,
          twitchRewardsMissingOwnershipMapping: channelPoints.twitchRewardsMissingOwnershipMapping,
          notes: channelPoints.notes
        };
        const twitchData = await twitchDataDiagnostics(options.db);
        checks.twitchData = {
          missingChannelReadSubscriptions: (twitch.broadcaster.missingScopes as string[]).includes('channel:read:subscriptions'),
          missingBitsRead: (twitch.broadcaster.missingScopes as string[]).includes('bits:read'),
          lastSubscriptionEvent: twitchData.lastSubscriptionEvent,
          lastBitsEvent: twitchData.lastBitsEvent,
          lastStreamStatusCheck: twitchData.lastStreamStatusCheck,
          lastBackfillRuns: twitchData.lastBackfillRuns,
          backfillFailures: twitchData.backfillFailures
        };
        if ((twitch.broadcaster.missingScopes as string[]).includes('channel:read:subscriptions') || (twitch.broadcaster.missingScopes as string[]).includes('bits:read')) status = 'degraded';
        if (outgoingChat.deadLetterCount > 0 || (outgoingChat.oldestQueuedAgeSeconds !== null && outgoingChat.oldestQueuedAgeSeconds > 300)) status = 'degraded';
      } catch (error) {
        checks.twitch = { status: 'degraded', error: error instanceof Error ? error.message : 'unknown Twitch health error' };
        status = 'degraded';
      }
    } else {
      checks.twitch = options.db
        ? { status: 'not_checked', reason: 'schema_missing' }
        : { status: 'not_configured' };
      status = 'degraded';
    }

    return reply.code(status === 'healthy' ? 200 : 503).send({ ...baseHealth(options.config, status), checks });
  });
}
