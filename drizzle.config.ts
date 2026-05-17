import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './apps/api/src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://erwin_gateway:erwin_gateway@localhost:5432/erwin_gateway'
  },
  strict: true,
  verbose: true
});
