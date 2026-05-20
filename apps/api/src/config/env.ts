import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const optionalUrl = z.string().url().optional();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('UTC'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  DATABASE_URL: z.string().url().optional(),
  PUBLIC_APP_URL: optionalUrl,
  PUBLIC_API_URL: optionalUrl,
  TWITCH_EVENTSUB_CALLBACK_URL: optionalUrl,
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(32).optional(),
  TOKEN_ENCRYPTION_KEY: z.string().min(32).optional(),
  API_KEY_PEPPER: z.string().min(16).optional(),
  INTERNAL_ADMIN_API_KEY: z.string().min(16).optional(),
  TWITCH_CLIENT_ID: z.string().optional(),
  TWITCH_CLIENT_SECRET: z.string().optional(),
  TWITCH_EVENTSUB_SECRET: z.string().optional(),
  TWITCH_BOT_LOGIN: z.string().optional(),
  TWITCH_BOT_USER_ID: z.string().optional(),
  TWITCH_BROADCASTER_ID: z.string().optional(),
  TWITCH_CHANNEL_LOGIN: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_HEALTHCHECK_REQUESTS: booleanString.default('false'),
  DEBUG_EVENTSUB_INGRESS: booleanString.default('false'),
  BUILD_SHA: z.string().default('local'),
  BUILD_BRANCH: z.string().default('local'),
  IMAGE_TAG: z.string().default('local')
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid erwin-gateway configuration: ${message}`);
  }

  return parsed.data;
}
