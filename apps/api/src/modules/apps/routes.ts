import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { appApiKeys, apps } from '../../db/schema.js';
import { extractKeyPrefix, hashAppApiKey, safeCompareHashes } from './api-keys.js';

interface AppRouteOptions {
  config: AppConfig;
  db?: Database;
}

interface AuthenticatedApp {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  permissions: string[];
  apiKey: {
    id: string;
    name: string;
    keyPrefix: string;
  };
}

interface AuthenticatedAppRequest extends FastifyRequest {
  authenticatedApp?: AuthenticatedApp;
}

async function authenticateAppApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
  options: AppRouteOptions
): Promise<AuthenticatedApp | null> {
  if (!options.db) {
    reply.code(503).send({ error: 'Database is not configured' });
    return null;
  }

  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'App API key is required' });
    return null;
  }

  const rawKey = authorization.slice('Bearer '.length).trim();
  const keyPrefix = extractKeyPrefix(rawKey);
  if (!keyPrefix) {
    reply.code(401).send({ error: 'Invalid app API key' });
    return null;
  }

  const [keyRecord] = await options.db
    .select()
    .from(appApiKeys)
    .where(and(eq(appApiKeys.keyPrefix, keyPrefix), isNull(appApiKeys.revokedAt)))
    .limit(1);

  if (!keyRecord) {
    reply.code(401).send({ error: 'Invalid app API key' });
    return null;
  }

  const candidateHash = hashAppApiKey(rawKey, options.config);
  if (!safeCompareHashes(candidateHash, keyRecord.keyHash)) {
    reply.code(401).send({ error: 'Invalid app API key' });
    return null;
  }

  const [appRecord] = await options.db.select().from(apps).where(eq(apps.id, keyRecord.appId)).limit(1);
  if (!appRecord || !appRecord.enabled) {
    reply.code(403).send({ error: 'App is disabled' });
    return null;
  }

  await options.db
    .update(appApiKeys)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(appApiKeys.id, keyRecord.id));

  return {
    id: appRecord.id,
    name: appRecord.name,
    slug: appRecord.slug,
    enabled: appRecord.enabled,
    permissions: appRecord.permissions,
    apiKey: {
      id: keyRecord.id,
      name: keyRecord.name,
      keyPrefix: keyRecord.keyPrefix
    }
  };
}

function appAuthenticationMiddleware(options: AppRouteOptions) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authenticatedApp = await authenticateAppApiKey(request, reply, options);
    if (!authenticatedApp) return;
    (request as AuthenticatedAppRequest).authenticatedApp = authenticatedApp;
  };
}

export async function registerAppApiRoutes(app: FastifyInstance, options: AppRouteOptions) {
  app.get('/api/v1/me', { preHandler: appAuthenticationMiddleware(options) }, async (request) => {
    const authenticatedApp = (request as AuthenticatedAppRequest).authenticatedApp!;

    return {
      app: {
        id: authenticatedApp.id,
        name: authenticatedApp.name,
        slug: authenticatedApp.slug,
        enabled: authenticatedApp.enabled,
        permissions: authenticatedApp.permissions
      },
      apiKey: authenticatedApp.apiKey
    };
  });
}
