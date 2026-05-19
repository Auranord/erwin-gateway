import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Pool } from 'pg';
import type { Database } from './db/client.js';
import type { AppConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { registerAdminApiRoutes } from './modules/admin/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { registerAppApiRoutes } from './modules/apps/routes.js';
import { startTwitchTokenWorker } from './modules/twitch/worker.js';
import { startOutgoingChatWorker } from './modules/twitch-chat/worker.js';
import { registerTwitchEventSubRoutes } from './modules/twitch-eventsub/routes.js';
import { registerDocsRoutes } from './modules/docs/routes.js';
import { startEventSubReconciliationWorker } from './modules/twitch-eventsub/worker.js';
import { startWebhookDeliveryWorker } from './modules/webhooks/service.js';

interface BuildAppOptions {
  config: AppConfig;
  pool?: Pool;
  db?: Database;
}

export interface StartupReadiness {
  databaseReachable: boolean;
  schemaReady: boolean;
  migrationsStatus: 'ready' | 'missing' | 'unknown';
  workersStarted: boolean;
  workerStartReason: 'started' | 'schema_missing' | 'database_unreachable' | 'not_configured';
}

const dirname = path.dirname(fileURLToPath(import.meta.url));

function isSpaRoute(url: string) {
  return url === '/' || url === '/admin' || url.startsWith('/admin/');
}

export async function buildApp(options: BuildAppOptions) {
  const { config, pool } = options;
  const logger = createLogger(config);
  const app = fastify({
    loggerInstance: logger,
    disableRequestLogging: !config.LOG_HEALTHCHECK_REQUESTS
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN,
    credentials: true
  });

  app.addContentTypeParser(/^application\/json(?:\s*;.*)?$/i, { parseAs: 'buffer' }, (request, body, done) => {
    (request.raw as any).rawBody = body;
    try {
      done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
    } catch (error) {
      done(error as Error);
    }
  });

  const startupReadiness: StartupReadiness = {
    databaseReachable: false,
    schemaReady: false,
    migrationsStatus: options.db ? 'unknown' : 'missing',
    workersStarted: false,
    workerStartReason: options.db ? 'database_unreachable' : 'not_configured'
  };

  if (pool && options.db) {
    try {
      await pool.query('select 1');
      startupReadiness.databaseReachable = true;
      const requiredTables = ['outgoing_chat_messages', 'webhook_deliveries', 'twitch_accounts', 'twitch_channels'];
      const { rows } = await pool.query(
        `select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])`,
        [requiredTables]
      );
      const present = new Set(rows.map((row: { table_name: string }) => row.table_name));
      startupReadiness.schemaReady = requiredTables.every((table) => present.has(table));
      startupReadiness.migrationsStatus = startupReadiness.schemaReady ? 'ready' : 'missing';
      startupReadiness.workerStartReason = startupReadiness.schemaReady ? 'started' : 'schema_missing';
    } catch (error) {
      app.log.warn({ err: error }, 'database startup readiness check failed');
      startupReadiness.migrationsStatus = 'unknown';
      startupReadiness.workerStartReason = 'database_unreachable';
    }
  }

  app.decorate('startupReadiness', startupReadiness);

  await registerHealthRoutes(app as any, { config, pool, db: options.db, startupReadiness });
  await registerAppApiRoutes(app as any, { config, db: options.db });
  await registerAdminApiRoutes(app as any, { config, db: options.db });
  await registerTwitchEventSubRoutes(app as any, { config, db: options.db });
  await registerDocsRoutes(app as any);
  if (startupReadiness.schemaReady) {
    startTwitchTokenWorker(app as any, config, options.db);
    startEventSubReconciliationWorker(app as any, config, options.db);
    startWebhookDeliveryWorker(app as any, options.db);
    startOutgoingChatWorker(app as any, config, options.db);
    startupReadiness.workersStarted = true;
    startupReadiness.workerStartReason = 'started';
  } else {
    app.log.warn({ startupReadiness }, 'workers not started because startup readiness checks failed');
  }

  const webDist = path.resolve(dirname, '../../web/dist');
  const hasWebDist = fs.existsSync(webDist);
  if (hasWebDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/'
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (hasWebDist && request.raw.method === 'GET' && isSpaRoute(request.url)) {
      return reply.sendFile('index.html');
    }

    return reply.code(404).send({
      error: 'Not Found',
      service: 'erwin-gateway'
    });
  });

  return app;
}
