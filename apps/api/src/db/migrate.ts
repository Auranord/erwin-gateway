import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required to run migrations');
  process.exit(1);
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(dirname, '../../../../drizzle');

const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool);

async function runMigrations() {
  try {
    console.log('Running migrations...');
    await migrate(db, { migrationsFolder });
    console.log('Migrations completed successfully');
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed', error);
    await pool.end();
    process.exit(1);
  }
}

void runMigrations();
