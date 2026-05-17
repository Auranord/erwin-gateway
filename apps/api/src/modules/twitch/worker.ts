import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { getAppAccessToken, refreshExpiringTokens } from './service.js';

export function startTwitchTokenWorker(app: FastifyInstance, config: AppConfig, db?: Database) {
  if (!db) return;

  const run = async () => {
    try {
      await refreshExpiringTokens(db, config);
      if (config.TWITCH_CLIENT_ID && config.TWITCH_CLIENT_SECRET) {
        await getAppAccessToken(config);
      }
    } catch (error) {
      app.log.warn({ err: error }, 'Twitch proactive token refresh failed');
    }
  };

  const interval = setInterval(() => void run(), 5 * 60_000);
  app.addHook('onClose', async () => clearInterval(interval));
  void run();
}
