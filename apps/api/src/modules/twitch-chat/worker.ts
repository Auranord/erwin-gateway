import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { processDueOutgoingChatMessages } from './service.js';

export function startOutgoingChatWorker(app: FastifyInstance, config: AppConfig, db?: Database) {
  if (!db) return;
  const run = () => processDueOutgoingChatMessages(db, config).catch((error) => app.log.error({ error }, 'Outgoing chat worker failed'));
  const timer = setInterval(run, 5_000);
  timer.unref?.();
  app.addHook('onClose', async () => clearInterval(timer));
  void run();
}
