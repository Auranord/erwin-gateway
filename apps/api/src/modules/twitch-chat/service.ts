import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { apps, idempotencyKeys, outgoingChatAttempts, outgoingChatMessages, rateLimitBuckets, twitchAccounts, twitchChannels } from '../../db/schema.js';
import { getAppAccessToken } from '../twitch/service.js';

export const outgoingChatStatuses = ['queued', 'sending', 'sent', 'dropped', 'failed', 'retrying', 'dead_lettered'] as const;
export type OutgoingChatStatus = (typeof outgoingChatStatuses)[number];

const maxAttempts = 5;
const maxMessageLength = 500;
const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const globalSpacingMs = 500;
const perChannelSpacingMs = 1200;
const perAppSpacingMs = 1000;
const twitchSendUrl = 'https://api.twitch.tv/helix/chat/messages';

type AppIdentity = { id: string; permissions: string[] };

type CreateOutgoingChatMessageInput = {
  channel_id?: string;
  channel_login?: string;
  broadcaster_user_id?: string;
  message: string;
  reply_parent_message_id?: string | null;
  for_source_only?: boolean;
  idempotency_key: string;
  priority?: number;
};

function requestHash(input: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function excerpt(value: string) {
  return value.slice(0, 2000);
}

function backoff(attempt: number) {
  const baseMs = Math.min(5 * 60_000, 1000 * 2 ** Math.max(0, attempt - 1));
  return baseMs + crypto.randomInt(0, Math.max(100, Math.floor(baseMs * 0.2)));
}

function parseRateLimitHeaders(headers: Headers) {
  return {
    limit: headers.get('ratelimit-limit'),
    remaining: headers.get('ratelimit-remaining'),
    reset: headers.get('ratelimit-reset'),
    twitchTraceId: headers.get('twitch-trace-id')
  };
}

function resetAtFromHeader(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
}

async function findChannel(db: Database, input: CreateOutgoingChatMessageInput) {
  if (input.channel_id) {
    const [channel] = await db.select().from(twitchChannels).where(eq(twitchChannels.id, input.channel_id)).limit(1);
    return channel ?? null;
  }
  if (input.broadcaster_user_id) {
    const [channel] = await db.select().from(twitchChannels).where(eq(twitchChannels.broadcasterUserId, input.broadcaster_user_id)).limit(1);
    return channel ?? null;
  }
  if (input.channel_login) {
    const [channel] = await db.select().from(twitchChannels).where(sql`lower(${twitchChannels.login}) = ${input.channel_login.toLowerCase()}`).limit(1);
    return channel ?? null;
  }
  const [primary] = await db.select().from(twitchChannels).where(eq(twitchChannels.primaryChannel, true)).limit(1);
  return primary ?? null;
}

export function validateOutgoingChatInput(app: AppIdentity, input: CreateOutgoingChatMessageInput) {
  const issues: string[] = [];
  if (!app.permissions.includes('chat:messages:send')) issues.push('App is missing chat:messages:send permission');
  if (!input.message || !input.message.trim()) issues.push('message is required');
  if (input.message && input.message.length > maxMessageLength) issues.push(`message must be ${maxMessageLength} characters or fewer`);
  if (!input.idempotency_key || input.idempotency_key.length < 8 || input.idempotency_key.length > 200) issues.push('idempotency_key must be 8-200 characters');
  if (input.reply_parent_message_id && input.reply_parent_message_id.length > 128) issues.push('reply_parent_message_id is too long');
  if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < -100 || input.priority > 100)) issues.push('priority must be an integer from -100 to 100');
  return issues;
}

export async function createOutgoingChatMessage(db: Database, app: AppIdentity, input: CreateOutgoingChatMessageInput) {
  const issues = validateOutgoingChatInput(app, input);
  if (issues.length) return { ok: false as const, statusCode: issues.some((issue) => issue.includes('permission')) ? 403 : 400, error: 'Invalid outgoing chat message', issues };

  const channel = await findChannel(db, input);
  if (!channel || !channel.enabled) return { ok: false as const, statusCode: 400, error: 'Channel is not configured or disabled', issues: ['channel'] };

  const normalized = {
    channel_id: channel.id,
    message: input.message,
    reply_parent_message_id: input.reply_parent_message_id ?? null,
    for_source_only: input.for_source_only ?? true,
    priority: input.priority ?? 0
  };
  const hash = requestHash(normalized);

  const [existingKey] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.sourceAppId, app.id), eq(idempotencyKeys.scope, 'outgoing_chat_message'), eq(idempotencyKeys.idempotencyKey, input.idempotency_key))).limit(1);
  if (existingKey) {
    const [message] = await db.select().from(outgoingChatMessages).where(eq(outgoingChatMessages.id, existingKey.resourceId)).limit(1);
    return { ok: true as const, message: message ?? null, duplicate: true, idempotencyConflict: existingKey.requestHash !== hash };
  }

  const [message] = await db.insert(outgoingChatMessages).values({
    sourceAppId: app.id,
    channelId: channel.id,
    message: input.message,
    replyParentMessageId: input.reply_parent_message_id ?? null,
    forSourceOnly: input.for_source_only ?? true,
    priority: input.priority ?? 0,
    idempotencyKey: input.idempotency_key,
    status: 'queued'
  }).onConflictDoNothing().returning();

  if (!message) {
    const [duplicate] = await db.select().from(outgoingChatMessages).where(and(eq(outgoingChatMessages.sourceAppId, app.id), eq(outgoingChatMessages.idempotencyKey, input.idempotency_key))).limit(1);
    return { ok: true as const, message: duplicate ?? null, duplicate: true, idempotencyConflict: false };
  }

  await db.insert(idempotencyKeys).values({
    sourceAppId: app.id,
    scope: 'outgoing_chat_message',
    idempotencyKey: input.idempotency_key,
    requestHash: hash,
    resourceType: 'outgoing_chat_message',
    resourceId: message.id,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000)
  }).onConflictDoNothing();

  return { ok: true as const, message, duplicate: false, idempotencyConflict: false };
}

export async function getOutgoingChatMessage(db: Database, id: string) {
  const [message] = await db.select().from(outgoingChatMessages).where(eq(outgoingChatMessages.id, id)).limit(1);
  if (!message) return null;
  const attempts = await db.select().from(outgoingChatAttempts).where(eq(outgoingChatAttempts.outgoingChatMessageId, id)).orderBy(desc(outgoingChatAttempts.createdAt));
  return { message, attempts };
}

export async function listOutgoingChatMessages(db: Database, query: { status?: string; from?: Date; to?: Date; limit?: number }) {
  const clauses = [];
  if (query.status) clauses.push(eq(outgoingChatMessages.status, query.status));
  if (query.from) clauses.push(sql`${outgoingChatMessages.createdAt} >= ${query.from}`);
  if (query.to) clauses.push(sql`${outgoingChatMessages.createdAt} <= ${query.to}`);
  return db.select().from(outgoingChatMessages).where(clauses.length ? and(...clauses) : undefined).orderBy(desc(outgoingChatMessages.createdAt)).limit(Math.min(query.limit ?? 100, 500));
}

async function upsertBucket(db: Database, bucketType: string, bucketKey: string, values: Partial<typeof rateLimitBuckets.$inferInsert>) {
  await db.insert(rateLimitBuckets).values({ bucketType, bucketKey, ...values }).onConflictDoUpdate({
    target: [rateLimitBuckets.bucketType, rateLimitBuckets.bucketKey],
    set: { ...values, updatedAt: new Date() }
  });
}

async function getLocalThrottleDelay(db: Database, message: typeof outgoingChatMessages.$inferSelect) {
  const keys = [
    { type: 'twitch_chat_global', key: 'send' },
    { type: 'twitch_chat_channel', key: message.channelId },
    { type: 'twitch_chat_app', key: message.sourceAppId }
  ];
  const rows = await db.select().from(rateLimitBuckets).where(sql`(${rateLimitBuckets.bucketType}, ${rateLimitBuckets.bucketKey}) in (('twitch_chat_global','send'), ('twitch_chat_channel', ${message.channelId}), ('twitch_chat_app', ${message.sourceAppId}))`);
  const now = Date.now();
  let delay = 0;
  for (const row of rows) {
    if (row.resetAt && row.remaining !== null && row.remaining <= 0) delay = Math.max(delay, row.resetAt.getTime() - now);
    if (!row.lastSentAt) continue;
    const spacing = row.bucketType === 'twitch_chat_channel' ? perChannelSpacingMs : row.bucketType === 'twitch_chat_app' ? perAppSpacingMs : globalSpacingMs;
    delay = Math.max(delay, row.lastSentAt.getTime() + spacing - now);
  }
  void keys;
  return Math.max(0, delay);
}

async function recordSuccessfulPacing(db: Database, message: typeof outgoingChatMessages.$inferSelect) {
  const now = new Date();
  await upsertBucket(db, 'twitch_chat_global', 'send', { lastSentAt: now });
  await upsertBucket(db, 'twitch_chat_channel', message.channelId, { lastSentAt: now });
  await upsertBucket(db, 'twitch_chat_app', message.sourceAppId, { lastSentAt: now });
}

async function recordTwitchRateLimit(db: Database, rateLimit: Record<string, string | null>) {
  await upsertBucket(db, 'twitch_api', 'helix_chat_messages', {
    limit: rateLimit.limit ? Number(rateLimit.limit) : null,
    remaining: rateLimit.remaining ? Number(rateLimit.remaining) : null,
    resetAt: resetAtFromHeader(rateLimit.reset ?? null),
    metadata: rateLimit
  });
}

function twitchResponsePayload(value: unknown) {
  if (!value || typeof value !== 'object') return { messageId: null as string | null, isSent: null as boolean | null, dropReason: null as unknown };
  const data = (value as { data?: unknown }).data;
  const first = Array.isArray(data) ? data[0] : null;
  if (!first || typeof first !== 'object') return { messageId: null, isSent: null, dropReason: null };
  const row = first as { message_id?: unknown; is_sent?: unknown; drop_reason?: unknown };
  return {
    messageId: typeof row.message_id === 'string' ? row.message_id : null,
    isSent: typeof row.is_sent === 'boolean' ? row.is_sent : null,
    dropReason: row.drop_reason ?? null
  };
}

export async function sendOutgoingChatNow(db: Database, config: AppConfig, id: string, force = false) {
  const [record] = await db.select({ message: outgoingChatMessages, channel: twitchChannels, sourceApp: apps })
    .from(outgoingChatMessages)
    .innerJoin(twitchChannels, eq(outgoingChatMessages.channelId, twitchChannels.id))
    .innerJoin(apps, eq(outgoingChatMessages.sourceAppId, apps.id))
    .where(eq(outgoingChatMessages.id, id))
    .limit(1);
  if (!record) return null;
  const message = record.message;
  if (!force && ['sent', 'dropped'].includes(message.status)) return message;
  if (message.status === 'sending' && !force) return message;

  const delay = await getLocalThrottleDelay(db, message);
  if (!force && delay > 0) {
    const [updated] = await db.update(outgoingChatMessages).set({ status: message.attempts > 0 ? 'retrying' : 'queued', nextAttemptAt: new Date(Date.now() + delay), updatedAt: new Date() }).where(eq(outgoingChatMessages.id, message.id)).returning();
    return updated ?? message;
  }

  const [bot] = await db.select().from(twitchAccounts).where(eq(twitchAccounts.role, 'bot')).limit(1);
  if (!bot) throw new Error('Twitch bot account is not connected');
  if (!config.TWITCH_CLIENT_ID) throw new Error('TWITCH_CLIENT_ID is required to send chat');

  const attemptNumber = message.attempts + 1;
  const requestBody = {
    broadcaster_id: record.channel.broadcasterUserId,
    sender_id: bot.twitchUserId,
    message: message.message,
    ...(message.replyParentMessageId ? { reply_parent_message_id: message.replyParentMessageId } : {}),
    for_source_only: message.forSourceOnly
  };

  await db.update(outgoingChatMessages).set({ status: 'sending', updatedAt: new Date() }).where(eq(outgoingChatMessages.id, message.id));

  let responseCode: number | null = null;
  let responseJson: unknown = null;
  let bodyExcerpt: string | null = null;
  let error: string | null = null;
  let rateLimit: Record<string, string | null> = {};

  try {
    const token = await getAppAccessToken(config);
    const response = await fetch(twitchSendUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Client-Id': config.TWITCH_CLIENT_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    responseCode = response.status;
    rateLimit = parseRateLimitHeaders(response.headers);
    const text = await response.text();
    bodyExcerpt = excerpt(text);
    responseJson = text ? JSON.parse(text) : null;
    if (!response.ok) error = `HTTP ${response.status}`;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'unknown Twitch chat send error';
  }

  await recordTwitchRateLimit(db, rateLimit);
  await db.insert(outgoingChatAttempts).values({ outgoingChatMessageId: message.id, attemptNumber, request: requestBody, responseCode, responseJson, responseBodyExcerpt: bodyExcerpt, error, rateLimit }).onConflictDoNothing();

  const parsed = twitchResponsePayload(responseJson);
  const now = new Date();
  const terminal = attemptNumber >= maxAttempts;

  if (!error && parsed.dropReason) {
    const [updated] = await db.update(outgoingChatMessages).set({ status: 'dropped', attempts: attemptNumber, twitchMessageId: parsed.messageId, twitchIsSent: parsed.isSent, twitchDropReason: parsed.dropReason, responseCode, responseBodyExcerpt: bodyExcerpt, rateLimit, lastError: null, failedAt: now, updatedAt: now }).where(eq(outgoingChatMessages.id, message.id)).returning();
    await recordSuccessfulPacing(db, message);
    return updated ?? null;
  }

  if (!error && parsed.isSent !== false) {
    const [updated] = await db.update(outgoingChatMessages).set({ status: 'sent', attempts: attemptNumber, twitchMessageId: parsed.messageId, twitchIsSent: parsed.isSent ?? true, twitchDropReason: parsed.dropReason, responseCode, responseBodyExcerpt: bodyExcerpt, rateLimit, lastError: null, sentAt: now, updatedAt: now }).where(eq(outgoingChatMessages.id, message.id)).returning();
    await recordSuccessfulPacing(db, message);
    return updated ?? null;
  }

  const retryable = responseCode === null || transientStatuses.has(responseCode);
  const [updated] = await db.update(outgoingChatMessages).set({
    status: retryable && !terminal ? 'retrying' : terminal ? 'dead_lettered' : 'failed',
    attempts: attemptNumber,
    twitchMessageId: parsed.messageId,
    twitchIsSent: parsed.isSent,
    twitchDropReason: parsed.dropReason,
    responseCode,
    responseBodyExcerpt: bodyExcerpt,
    rateLimit,
    lastError: error ?? 'Twitch did not send the message',
    nextAttemptAt: new Date(now.getTime() + (retryable && !terminal ? backoff(attemptNumber) : 0)),
    failedAt: retryable && !terminal ? null : now,
    updatedAt: now
  }).where(eq(outgoingChatMessages.id, message.id)).returning();
  return updated ?? null;
}

export async function processDueOutgoingChatMessages(db: Database, config: AppConfig, limit = 5) {
  const due = await db.select().from(outgoingChatMessages)
    .where(and(inArray(outgoingChatMessages.status, ['queued', 'retrying', 'failed']), lte(outgoingChatMessages.nextAttemptAt, new Date())))
    .orderBy(desc(outgoingChatMessages.priority), asc(outgoingChatMessages.createdAt))
    .limit(limit);
  for (const message of due) await sendOutgoingChatNow(db, config, message.id);
  return due.length;
}

export async function retryOutgoingChatMessage(db: Database, _config: AppConfig, id: string) {
  const [message] = await db.select().from(outgoingChatMessages).where(eq(outgoingChatMessages.id, id)).limit(1);
  if (!message) return null;
  if (message.status === 'sent' || message.status === 'dropped') return message;
  const [updated] = await db.update(outgoingChatMessages).set({ status: 'queued', nextAttemptAt: new Date(), failedAt: null, lastError: null, updatedAt: new Date() }).where(eq(outgoingChatMessages.id, id)).returning();
  return updated ?? null;
}

export async function getOutgoingChatHealth(db: Database) {
  const [depthRow] = await db.select({ count: sql<number>`count(*)::int` }).from(outgoingChatMessages).where(inArray(outgoingChatMessages.status, ['queued', 'retrying']));
  const [oldestRow] = await db.select({ createdAt: outgoingChatMessages.createdAt }).from(outgoingChatMessages).where(inArray(outgoingChatMessages.status, ['queued', 'retrying'])).orderBy(asc(outgoingChatMessages.createdAt)).limit(1);
  const [lastSuccess] = await db.select({ sentAt: outgoingChatMessages.sentAt }).from(outgoingChatMessages).where(eq(outgoingChatMessages.status, 'sent')).orderBy(desc(outgoingChatMessages.sentAt)).limit(1);
  const [deadRow] = await db.select({ count: sql<number>`count(*)::int` }).from(outgoingChatMessages).where(eq(outgoingChatMessages.status, 'dead_lettered'));
  const buckets = await db.select().from(rateLimitBuckets).orderBy(desc(rateLimitBuckets.updatedAt)).limit(20);
  return {
    queueDepth: depthRow?.count ?? 0,
    oldestQueuedAgeSeconds: oldestRow?.createdAt ? Math.max(0, Math.floor((Date.now() - oldestRow.createdAt.getTime()) / 1000)) : null,
    lastSuccessfulSend: lastSuccess?.sentAt?.toISOString() ?? null,
    deadLetterCount: deadRow?.count ?? 0,
    rateLimits: buckets
  };
}
