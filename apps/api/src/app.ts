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

interface BuildAppOptions {
  config: AppConfig;
  pool?: Pool;
  db?: Database;
}

const dirname = path.dirname(fileURLToPath(import.meta.url));

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

  await registerHealthRoutes(app, { config, pool, db: options.db });
  await registerAppApiRoutes(app, { config, db: options.db });
  await registerAdminApiRoutes(app, { config, db: options.db });
  startTwitchTokenWorker(app, config, options.db);

  const webDist = path.resolve(dirname, '../../../web/dist');
  const hasWebDist = fs.existsSync(webDist);
  if (hasWebDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      decorateReply: false
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (hasWebDist && request.raw.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }

    return reply.code(404).send({
      error: 'Not Found',
      service: 'erwin-gateway'
    });
  });

  return app;
}
