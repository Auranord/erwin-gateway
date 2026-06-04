import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { buildApp } from '../dist/app.js';
import { generateAppApiKey, hashAppApiKey, safeCompareHashes } from '../dist/modules/apps/api-keys.js';
import { verifyEventSubSignature } from '../dist/modules/twitch-eventsub/signature.js';
import { buildOpenApiDocument } from '../dist/modules/docs/openapi.js';
import { secretRedactionPaths } from '../dist/config/redaction.js';

const config = {
  NODE_ENV: 'test', TZ: 'UTC', HOST: '127.0.0.1', PORT: 0, CORS_ORIGIN: 'http://localhost:5173', LOG_LEVEL: 'silent', LOG_HEALTHCHECK_REQUESTS: false,
  BUILD_SHA: 'test', BUILD_BRANCH: 'test', IMAGE_TAG: 'test', INTERNAL_ADMIN_API_KEY: 'test-admin-key-with-length', API_KEY_PEPPER: 'test-api-key-pepper-with-length', SESSION_SECRET: 'test-session-secret-with-enough-length'
};

function readSource(path) { return fs.readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'); }
function signEventSub({ secret, messageId, timestamp, rawBody }) {
  return `sha256=${crypto.createHmac('sha256', secret).update(messageId).update(timestamp).update(rawBody).digest('hex')}`;
}

function createEventSubDbMock() {
  const state = { messageIds: new Set(), persistedEvents: [] };
  return {
    state,
    db: {
      insert(table) {
        return {
          values(values) {
            if (values && typeof values === 'object' && 'messageId' in values && 'messageType' in values && 'headers' in values) {
              const messageId = values.messageId;
              if (state.messageIds.has(messageId)) {
                const error = new Error('duplicate');
                error.code = '23505';
                throw error;
              }
              state.messageIds.add(messageId);
              return { returning: async () => [{ id: state.messageIds.size, ...values }] };
            }
            if (values && typeof values === 'object' && 'source' in values && values.source === 'twitch_eventsub') state.persistedEvents.push(values);
            return {
              returning: async () => [],
              onConflictDoNothing() { return Promise.resolve(); }
            };
          }
        };
      },
      update() { return { set: () => ({ where: async () => {} }) }; },
      select() { return { from: () => ({ where: () => ({ limit: async () => [] }), orderBy: () => ({ limit: async () => [] }) }) }; }
    }
  };
}

test('generated API docs expose /openapi.json and /docs', async () => {
  const app = await buildApp({ config });
  const openapi = await app.inject({ method: 'GET', url: '/openapi.json' });
  assert.equal(openapi.statusCode, 200);
  const doc = openapi.json();
  assert.equal(doc.info.title, 'erwin-gateway API');
  assert.ok(doc.paths['/api/v1/me']);
  assert.ok(doc.paths['/webhooks/twitch/eventsub']);
  const docs = await app.inject({ method: 'GET', url: '/docs' });
  assert.equal(docs.statusCode, 200);
  assert.match(docs.body, /SwaggerUIBundle/);
  await app.close();
});

test('serves admin SPA routes while preserving API/docs behavior', async () => {
  const app = await buildApp({ config });

  const root = await app.inject({ method: 'GET', url: '/' });
  assert.equal(root.statusCode, 200);
  assert.match(root.headers['content-type'] ?? '', /text\/html/);

  const admin = await app.inject({ method: 'GET', url: '/admin' });
  assert.equal(admin.statusCode, 200);
  assert.match(admin.headers['content-type'] ?? '', /text\/html/);

  const adminNested = await app.inject({ method: 'GET', url: '/admin/some/page' });
  assert.equal(adminNested.statusCode, 200);
  assert.match(adminNested.headers['content-type'] ?? '', /text\/html/);

  const docs = await app.inject({ method: 'GET', url: '/docs' });
  assert.equal(docs.statusCode, 200);
  assert.match(docs.body, /SwaggerUIBundle/);

  const live = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
  assert.equal(live.statusCode, 200);
  assert.equal(live.json().status, 'healthy');

  const unknownApi = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
  assert.equal(unknownApi.statusCode, 404);
  assert.deepEqual(unknownApi.json(), { error: 'Not Found', service: 'erwin-gateway' });

  const webhookUnknown = await app.inject({ method: 'GET', url: '/webhooks/not-found' });
  assert.equal(webhookUnknown.statusCode, 404);
  assert.deepEqual(webhookUnknown.json(), { error: 'Not Found', service: 'erwin-gateway' });

  await app.close();
});

test('app API keys are hashed and comparable without raw key storage', () => {
  const generated = generateAppApiKey(config);
  assert.match(generated.rawKey, /^egw_dev_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);
  assert.notEqual(generated.keyHash, generated.rawKey);
  assert.equal(hashAppApiKey(generated.rawKey, config), generated.keyHash);
  assert.equal(safeCompareHashes(generated.keyHash, hashAppApiKey(generated.rawKey, config)), true);
  assert.equal(safeCompareHashes(generated.keyHash, hashAppApiKey(`${generated.rawKey}x`, config)), false);
});

test('app API key authentication rejects revoked keys by query shape', () => {
  const source = readSource('modules/apps/routes.ts');
  assert.match(source, /isNull\(appApiKeys\.revokedAt\)/, 'auth lookup must exclude revoked keys');
  assert.match(source, /safeCompareHashes\(candidateHash, keyRecord\.keyHash\)/, 'auth must timing-safely compare stored hash');
  assert.doesNotMatch(source, /rawKey\s*:/, 'app auth route must not persist raw API keys');
});

test('admin app list excludes archived downstream apps from UI payloads', () => {
  const source = readSource('modules/admin/routes.ts');
  assert.match(source, /app\.get\('\/api\/admin\/apps'/, 'admin app list route must exist');
  assert.match(source, /select\(\)\.from\(apps\)\.where\(isNull\(apps\.archivedAt\)\)\.orderBy\(apps\.slug\)/, 'admin app list must exclude archived downstream apps');
});

test('admin app archive route frees app slugs and preserves auditability', () => {
  const source = readSource('modules/admin/routes.ts');
  assert.match(source, /app\.delete\('\/api\/admin\/apps\/:id'/, 'admin app archive route must exist');
  assert.match(source, /archivedAt/, 'archive route must set explicit archivedAt semantics');
  assert.match(source, /buildArchivedSlug\(record\.slug, record\.id\)/, 'archive route must rename archived app slugs so originals are reusable');
  assert.match(source, /enabled: false/, 'archive route must soft-disable the app rather than hard-delete it');
  assert.match(source, /isNull\(appApiKeys\.revokedAt\)/, 'archive route must revoke active app API keys');
  assert.match(source, /options\.db\.update\(appWebhookEndpoints\)\.set\(\{[\s\S]*enabled: false/, 'archive route must disable app webhook endpoints');
  assert.match(source, /archived: true/, 'archive route response must report actual archive behavior');
  assert.match(source, /app\.archive/, 'archive route must audit the action');
  assert.doesNotMatch(source, /delete\(apps\)/, 'archive route must not hard-delete app rows');
});

test('Twitch EventSub signature verification uses raw request body HMAC', () => {
  const secret = 'eventsub-secret';
  const messageId = 'msg-1';
  const timestamp = '2026-05-18T00:00:00Z';
  const rawBody = Buffer.from(JSON.stringify({ challenge: 'abc' }));
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(messageId).update(timestamp).update(rawBody).digest('hex')}`;
  assert.equal(verifyEventSubSignature({ secret, messageId, timestamp, rawBody, signature }), true);
  assert.equal(verifyEventSubSignature({ secret, messageId, timestamp, rawBody: Buffer.from('{}'), signature }), false);
});

test('EventSub duplicate detection records duplicate message IDs', () => {
  const source = readSource('modules/twitch-eventsub/service.ts');
  assert.match(source, /error\?\.code === '23505'/, 'unique violation must be treated as duplicate');
  assert.match(source, /Duplicate EventSub message ignored/, 'duplicate must emit diagnostic event');
  assert.match(source, /return \{ duplicate: true/, 'duplicate must be surfaced to caller');
});

test('webhook signing and retry/dead-letter behavior are implemented', () => {
  const source = readSource('modules/webhooks/service.ts');
  assert.match(source, /X-Erwin-Gateway-Signature/, 'deliveries must include signature header');
  assert.match(source, /createHmac\('sha256'/, 'deliveries must use HMAC-SHA256');
  assert.match(source, /status: terminal \? 'dead_lettered' : 'retrying'/, 'failed deliveries must retry then dead-letter');
  assert.match(source, /const maxAttempts = 5/, 'retry limit must be explicit');
  assert.doesNotMatch(source, /delivery_id: null/, 'stored delivery payloads must not contain a null delivery_id placeholder');
  assert.match(source, /delivery_id: row\.delivery\.id/, 'outbound webhook body must include the real delivery_id');
});

test('app-facing webhook delivery routes are scoped to the authenticated app', () => {
  const appRoutesSource = readSource('modules/apps/routes.ts');
  const webhookServiceSource = readSource('modules/webhooks/service.ts');

  assert.match(appRoutesSource, /listWebhookDeliveries\(options\.db, \{ \.\.\.query\.data, appId: authenticatedApp\.id \}\)/, 'app delivery list must filter by authenticated app id');
  assert.match(appRoutesSource, /!result \|\| result\.delivery\.appId !== authenticatedApp\.id\) return reply\.code\(404\)/, 'app delivery details must hide non-owned deliveries behind 404');
  assert.match(appRoutesSource, /getWebhookDeliveryWithAttempts\(options\.db, params\.data\.deliveryId\);[\s\S]*if \(!result \|\| result\.delivery\.appId !== authenticatedApp\.id\) return reply\.code\(404\)[\s\S]*const delivery = await deliverWebhookNow/, 'app delivery retry must verify ownership before dispatching');
  assert.match(webhookServiceSource, /appId\?: string/, 'delivery listing helper must accept an optional app id scope');
  assert.match(webhookServiceSource, /eq\(webhookDeliveries\.appId, query\.appId\)/, 'delivery listing helper must apply the app id scope when provided');
});

test('outgoing chat idempotency prevents duplicate sends', () => {
  const source = readSource('modules/twitch-chat/service.ts');
  assert.match(source, /scope, 'outgoing_chat_message'/, 'idempotency scope must be outgoing chat');
  assert.match(source, /idempotencyConflict: existingKey\.requestHash !== hash/, 'same key with different body must conflict');
  assert.match(source, /onConflictDoNothing\(\)\.returning\(\)/, 'duplicate insert race must not enqueue a second row');
});

test('Channel Point reward mutations enforce ownership', () => {
  const source = readSource('modules/channel-points/service.ts');
  assert.match(source, /owningAppId !== app\.id/, 'non-owning app must be rejected for reward mutation');
  assert.match(source, /!reward\.manageable/, 'non-manageable rewards must be rejected before Twitch reward mutations');
  assert.match(source, /Reward is not manageable by this Twitch client/, 'non-manageable reward mutation errors must be clear');
  assert.match(source, /channel_points:redemptions:manage/, 'redemption management permission must be checked');
  assert.match(source, /Gateway never auto-fulfills/, 'service must document explicit fulfillment behavior');
});

test('simple text command cooldown is enforced', () => {
  const source = readSource('modules/text-commands/service.ts');
  assert.match(source, /cooldownSeconds/, 'global cooldown must be modeled');
  assert.match(source, /userCooldownSeconds/, 'per-user cooldown must be modeled');
  assert.match(source, /skipped_cooldown/, 'cooldown-active invocation must be recorded');
});

test('health degrades when required Twitch scopes are missing', () => {
  const source = readSource('modules/health/routes.ts');
  assert.match(source, /missingScopes/, 'deep health must report missing scopes');
  assert.match(source, /missingRequiredSubscriptions/, 'deep health must report required EventSub gaps separately');
  assert.match(source, /missingOptionalSubscriptions/, 'deep health must report optional EventSub gaps separately');
  assert.match(source, /chatMessageSubscriptionHealthy/, 'deep health must explicitly report chat message subscription health');
  assert.match(source, /channel:read:subscriptions/, 'subscription scope must affect health');
  assert.match(source, /bits:read/, 'bits scope must affect health');
  assert.match(source, /status = 'degraded'/, 'missing scopes must be able to degrade health');
});

test('desired EventSub subscriptions use Twitch chat settings type name', () => {
  const source = readSource('modules/twitch-eventsub/desired.ts');
  assert.match(source, /channel\.chat_settings\.update/, 'desired EventSub types must use official chat settings type');
  assert.doesNotMatch(source, /channel\.chat\.settings\.update/, 'legacy typo must not be present');
});

test('final security checks cover token logging, raw API key storage, redaction, and admin route protection', () => {
  const loggerSource = readSource('config/redaction.ts');
  for (const required of ['authorization', 'cookie', 'TWITCH_CLIENT_SECRET', 'TWITCH_EVENTSUB_SECRET', 'access_token', 'refresh_token', 'rawKey', 'API_KEY_PEPPER']) {
    assert.match(loggerSource, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${required} must be redacted`);
  }
  assert.ok(secretRedactionPaths.length >= 20);
  const adminSource = readSource('modules/admin/routes.ts');
  assert.match(adminSource, /Admin authentication is not configured/, 'admin routes must fail closed if no admin key is configured');
  assert.match(adminSource, /request\.url\.startsWith\('\/api\/admin\/'\)/, 'admin routes must be protected by hook');
});

test('OpenAPI includes final health acceptance endpoints', () => {
  const paths = buildOpenApiDocument().paths;
  assert.ok(paths['/api/v1/health/live']);
  assert.ok(paths['/api/v1/health/ready']);
  assert.ok(paths['/api/v1/health/deep']);
});

test('EventSub ingress route covers rawBody diagnostics, challenge retry behavior, and safe error logging', () => {
  const source = readSource('modules/twitch-eventsub/routes.ts');
  assert.match(source, /EventSub ingress missing required metadata/);
  for (const field of ['missingMessageId', 'missingTimestamp', 'missingSignature', 'missingMessageType', 'missingRawBody', 'contentType', 'hasParsedBody', 'parsedBodyType', 'contentLength']) {
    assert.match(source, new RegExp(field), `missing field ${field} in diagnostic log`);
  }
  assert.match(source, /if \(messageType === 'webhook_callback_verification'\)/);
  assert.match(source, /reply\.header\('Content-Type', 'text\/plain'\)\.code\(200\)\.send\(payload\.challenge\)/);
  assert.match(source, /persistEventSubMessage\(options\.db, \{ messageId, messageType, headers: selectedHeaders\(request\.headers\), payload \}\)/);
  assert.match(source, /EventSub ingress persistence failed after challenge response/);
  assert.match(source, /EventSub ingress unexpected error/);
  assert.match(source, /EventSub ingress signature invalid/);
});

test('Fastify JSON parser captures raw body bytes for EventSub signature verification with charset variants', () => {
  const source = readSource('app.ts');
  assert.match(source, /removeContentTypeParser\('application\/json'\)/);
  assert.match(source, /addContentTypeParser\(\/\^application\\\/json\(\?:\\s\*;\.\*\)\?\$\/i, \{ parseAs: 'buffer' \}/);
  assert.match(source, /\(request as any\)\.rawBody = body/);
  assert.match(source, /\(request\.raw as any\)\.rawBody = body/);
});

test('EventSub ingress challenge/notification behaviors and raw-body validations', async () => {
  const eventsubSecret = 'eventsub-secret-very-long';
  const { db, state } = createEventSubDbMock();
  const app = await buildApp({ config: { ...config, TWITCH_EVENTSUB_SECRET: eventsubSecret }, db });
  const baseHeaders = {
    'content-type': 'application/json',
    'twitch-eventsub-message-id': 'msg-1',
    'twitch-eventsub-message-timestamp': '2026-05-20T00:00:00Z'
  };

  const challengeBody = JSON.stringify({ challenge: 'abc', subscription: { type: 'channel.chat.message', version: '1' } });
  const challengeSig = signEventSub({ secret: eventsubSecret, messageId: 'msg-1', timestamp: baseHeaders['twitch-eventsub-message-timestamp'], rawBody: Buffer.from(challengeBody) });
  for (const contentType of ['application/json', 'application/json; charset=utf-8']) {
    const response = await app.inject({ method: 'POST', url: '/webhooks/twitch/eventsub', headers: { ...baseHeaders, 'content-type': contentType, 'twitch-eventsub-message-type': 'webhook_callback_verification', 'twitch-eventsub-message-signature': challengeSig }, payload: challengeBody });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/plain');
    assert.equal(response.body, 'abc');
  }

  const notifBody = JSON.stringify({ subscription: { type: 'unknown.type', version: '1' }, event: { id: 'evt-1' } });
  const notifSig = signEventSub({ secret: eventsubSecret, messageId: 'msg-2', timestamp: baseHeaders['twitch-eventsub-message-timestamp'], rawBody: Buffer.from(notifBody) });
  for (const contentType of ['application/json', 'application/json;charset=utf-8']) {
    const response = await app.inject({ method: 'POST', url: '/webhooks/twitch/eventsub', headers: { ...baseHeaders, 'content-type': contentType, 'twitch-eventsub-message-id': contentType.includes('charset') ? 'msg-3' : 'msg-2', 'twitch-eventsub-message-type': 'notification', 'twitch-eventsub-message-signature': signEventSub({ secret: eventsubSecret, messageId: contentType.includes('charset') ? 'msg-3' : 'msg-2', timestamp: baseHeaders['twitch-eventsub-message-timestamp'], rawBody: Buffer.from(notifBody) }) }, payload: notifBody });
    assert.equal(response.statusCode, 204);
  }
  assert.ok(state.persistedEvents.length >= 2);

  const duplicateNotif = await app.inject({ method: 'POST', url: '/webhooks/twitch/eventsub', headers: { ...baseHeaders, 'twitch-eventsub-message-id': 'msg-2', 'twitch-eventsub-message-type': 'notification', 'twitch-eventsub-message-signature': notifSig }, payload: notifBody });
  assert.equal(duplicateNotif.statusCode, 204);

  const duplicateChallenge = await app.inject({ method: 'POST', url: '/webhooks/twitch/eventsub', headers: { ...baseHeaders, 'twitch-eventsub-message-type': 'webhook_callback_verification', 'twitch-eventsub-message-signature': challengeSig }, payload: challengeBody });
  assert.equal(duplicateChallenge.statusCode, 200);
  assert.equal(duplicateChallenge.body, 'abc');

  const appWithoutRawBody = await buildApp({ config: { ...config, TWITCH_EVENTSUB_SECRET: eventsubSecret }, db });
  appWithoutRawBody.addHook('preHandler', async (request) => {
    if (request.url === '/webhooks/twitch/eventsub') {
      delete request.rawBody;
      delete request.raw.rawBody;
    }
  });
  const missingRawBody = await appWithoutRawBody.inject({ method: 'POST', url: '/webhooks/twitch/eventsub', headers: { ...baseHeaders, 'twitch-eventsub-message-id': 'msg-missing-raw', 'twitch-eventsub-message-type': 'notification', 'twitch-eventsub-message-signature': 'sha256=fake' }, payload: notifBody });
  assert.equal(missingRawBody.statusCode, 400);
  await appWithoutRawBody.close();

  const invalidSignature = await app.inject({ method: 'POST', url: '/webhooks/twitch/eventsub', headers: { ...baseHeaders, 'twitch-eventsub-message-id': 'msg-invalid', 'twitch-eventsub-message-type': 'notification', 'twitch-eventsub-message-signature': 'sha256=bad' }, payload: notifBody });
  assert.equal(invalidSignature.statusCode, 403);
  await app.close();
});
