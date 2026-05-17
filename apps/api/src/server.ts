import { loadConfig } from './config/env.js';
import { createDatabase } from './db/client.js';
import { buildApp } from './app.js';

const config = loadConfig();
const database = createDatabase(config);
const app = await buildApp({ config, pool: database?.pool });

const shutdown = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, 'shutting down erwin-gateway');
  await app.close();
  await database?.pool.end();
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
