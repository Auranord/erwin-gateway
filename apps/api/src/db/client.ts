import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { AppConfig } from '../config/env.js';

export function createDatabase(config: AppConfig) {
  if (!config.DATABASE_URL) {
    return null;
  }

  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  return {
    pool,
    db: drizzle(pool)
  };
}
