import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config/env.js';
import type { HealthResponse } from '@erwin-gateway/shared';

interface HealthRouteOptions {
  config: AppConfig;
  pool?: Pool;
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

export async function registerHealthRoutes(app: FastifyInstance, options: HealthRouteOptions) {
  app.get('/api/v1/health/live', async () => baseHealth(options.config, 'healthy'));

  app.get('/api/v1/health/ready', async (request, reply) => {
    if (!options.pool) {
      return reply.code(503).send({
        ...baseHealth(options.config, 'degraded'),
        checks: {
          database: 'not_configured'
        }
      });
    }

    try {
      await options.pool.query('select 1');
      return {
        ...baseHealth(options.config, 'ready'),
        checks: {
          database: 'reachable',
          migrations: 'pending_phase_2',
          workers: 'pending_phase_2'
        }
      };
    } catch (error) {
      request.log.warn({ error }, 'readiness database check failed');
      return reply.code(503).send({
        ...baseHealth(options.config, 'degraded'),
        checks: {
          database: 'unreachable'
        }
      });
    }
  });
}
