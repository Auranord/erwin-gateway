import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { reconcileEventSubSubscriptions } from './service.js';

const EVENTSUB_RECONCILE_INTERVAL_MS = 15 * 60_000;

export function startEventSubReconciliationWorker(app: FastifyInstance, config: AppConfig, db?: Database) {
  if (!db) return;
  const database = db;

  async function run(reason: 'startup' | 'periodic') {
    try {
      const result = await reconcileEventSubSubscriptions(database, config);
      app.log.info({ reason, desiredCount: result.desiredCount, actions: result.actions.length }, 'EventSub reconciliation completed');
    } catch (error) {
      app.log.warn({ reason, error: error instanceof Error ? error.message : 'unknown EventSub reconciliation error' }, 'EventSub reconciliation failed');
    }
  }

  setTimeout(() => void run('startup'), 1_000).unref();
  const interval = setInterval(() => void run('periodic'), EVENTSUB_RECONCILE_INTERVAL_MS);
  interval.unref();

  app.addHook('onClose', async () => clearInterval(interval));
}
