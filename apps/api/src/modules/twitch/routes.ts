import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { completeOAuthCallback, createOAuthStart, getTwitchSetupStatus, refreshAllUserTokens, refreshUserToken } from './service.js';
import type { TwitchAccountRole } from './constants.js';

interface TwitchRouteOptions {
  config: AppConfig;
  db?: Database;
}

const startSchema = z.object({
  returnTo: z.string().url().optional().nullable()
}).default({});

const callbackSchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional()
});

const refreshSchema = z.object({
  role: z.enum(['bot', 'broadcaster']).optional()
}).default({});

function requireDatabase(db: Database | undefined, reply: FastifyReply): db is Database {
  if (!db) {
    reply.code(503).send({ error: 'Database is not configured' });
    return false;
  }
  return true;
}

function oauthErrorRedirect(error: string) {
  return `/admin#twitch-setup?error=${encodeURIComponent(error)}`;
}

export async function registerTwitchAdminRoutes(app: FastifyInstance, options: TwitchRouteOptions) {
  async function start(role: TwitchAccountRole, body: unknown, reply: FastifyReply) {
    if (!requireDatabase(options.db, reply)) return reply;
    const parsed = startSchema.safeParse(body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid OAuth start payload', issues: parsed.error.issues });
    try {
      return await createOAuthStart(options.db, options.config, role, parsed.data.returnTo ?? null);
    } catch (error) {
      return reply.code(503).send({ error: error instanceof Error ? error.message : 'Unable to start Twitch OAuth' });
    }
  }

  async function callback(role: TwitchAccountRole, query: unknown, reply: FastifyReply) {
    if (!requireDatabase(options.db, reply)) return reply;
    const parsed = callbackSchema.safeParse(query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid OAuth callback' });
    if (parsed.data.error) return reply.redirect(oauthErrorRedirect(parsed.data.error_description ?? parsed.data.error));
    if (!parsed.data.code || !parsed.data.state) return reply.code(400).send({ error: 'Missing OAuth code or state' });

    try {
      const result = await completeOAuthCallback(options.db, options.config, role, parsed.data.code, parsed.data.state);
      const redirectTarget = result.returnTo ?? `/admin#twitch-setup?connected=${role}`;
      return reply.redirect(redirectTarget);
    } catch (error) {
      return reply.redirect(oauthErrorRedirect(error instanceof Error ? error.message : 'Twitch OAuth callback failed'));
    }
  }

  app.post('/api/admin/twitch/bot/login/start', async (request, reply) => start('bot', request.body, reply));
  app.get('/api/admin/twitch/bot/callback', async (request, reply) => callback('bot', request.query, reply));
  app.post('/api/admin/twitch/broadcaster/login/start', async (request, reply) => start('broadcaster', request.body, reply));
  app.get('/api/admin/twitch/broadcaster/callback', async (request, reply) => callback('broadcaster', request.query, reply));

  // Public callback aliases for OAuth providers that redirect without admin auth headers.
  app.get('/api/v1/twitch/oauth/bot/callback', async (request, reply) => callback('bot', request.query, reply));
  app.get('/api/v1/twitch/oauth/broadcaster/callback', async (request, reply) => callback('broadcaster', request.query, reply));

  app.get('/api/admin/twitch/setup/status', async (_request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    return getTwitchSetupStatus(options.db, options.config);
  });

  app.post('/api/admin/twitch/tokens/refresh', async (request, reply) => {
    if (!requireDatabase(options.db, reply)) return reply;
    const parsed = refreshSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid refresh payload', issues: parsed.error.issues });
    if (parsed.data.role) return { results: [await refreshUserToken(options.db, options.config, parsed.data.role)] };
    return { results: await refreshAllUserTokens(options.db, options.config) };
  });
}
