import { and, desc, eq, inArray } from 'drizzle-orm';
import type { AppConfig } from '../config/env.js';
import type { Database } from '../db/client.js';
import { bitsBackfillRuns, bitsLeaderboardEntries, diagnosticEvents, events, subscriptionBackfillRuns, twitchChannels, twitchEventsubMessages, twitchSubscriptions } from '../db/schema.js';
import { getAppAccessToken, getUserAccessToken } from './twitch/service.js';
import { enqueueWebhookDeliveriesForEvent } from './webhooks/service.js';

export type AppIdentity = { id: string; slug?: string; permissions: string[] } | null;
const helix = 'https://api.twitch.tv/helix';
const subscriptionEventTypes = ['channel.subscribe', 'channel.subscription.end', 'channel.subscription.message', 'channel.subscription.gift'] as const;
const eventTypeMap = new Map<string, string>([
  ['channel.subscribe', 'twitch.channel.subscribe'],
  ['channel.subscription.end', 'twitch.channel.subscription.end'],
  ['channel.subscription.message', 'twitch.channel.subscription.message'],
  ['channel.subscription.gift', 'twitch.channel.subscription.gift'],
  ['channel.cheer', 'twitch.channel.cheer'],
  ['stream.online', 'twitch.stream.online'],
  ['stream.offline', 'twitch.stream.offline'],
  ['channel.update', 'twitch.channel.update']
]);

function has(app: AppIdentity, permission: string) { return Boolean(app?.permissions.includes(permission)); }
function requirePermission(app: AppIdentity, permission: string) { if (!has(app, permission)) return { ok: false as const, statusCode: 403, error: `App is missing ${permission} permission` }; return null; }
function asDate(value: unknown) { if (typeof value === 'string') { const date = new Date(value); if (!Number.isNaN(date.getTime())) return date; } return new Date(); }

async function findOrCreateChannel(db: Database, event: any) {
  const broadcasterId = String(event?.broadcaster_user_id ?? '');
  if (!broadcasterId) return primaryChannel(db);
  const [existing] = await db.select().from(twitchChannels).where(eq(twitchChannels.broadcasterUserId, broadcasterId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(twitchChannels).values({ broadcasterUserId: broadcasterId, login: event.broadcaster_user_login ?? broadcasterId, displayName: event.broadcaster_user_name ?? event.broadcaster_user_login ?? broadcasterId }).returning();
  return created!;
}
async function primaryChannel(db: Database) { const [channel] = await db.select().from(twitchChannels).where(eq(twitchChannels.enabled, true)).limit(1); if (!channel) throw new Error('No Twitch channel is configured'); return channel; }

async function twitchUserFetch(db: Database, config: AppConfig, path: string, scope: string, params: Record<string, string | number | undefined> = {}) {
  const token = await getUserAccessToken(db, config, 'broadcaster');
  if (!token.scopes.includes(scope)) throw new Error(`Broadcaster token is missing ${scope}`);
  const url = new URL(`${helix}${path}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { 'Client-Id': config.TWITCH_CLIENT_ID ?? '', Authorization: `Bearer ${token.accessToken}` } });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Twitch API ${path} failed with ${response.status}: ${text.slice(0, 500)}`);
  return body;
}

async function twitchAppFetch(config: AppConfig, path: string, params: Record<string, string | number | undefined> = {}) {
  const token = await getAppAccessToken(config);
  const url = new URL(`${helix}${path}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { 'Client-Id': config.TWITCH_CLIENT_ID ?? '', Authorization: `Bearer ${token.accessToken}` } });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Twitch API ${path} failed with ${response.status}: ${text.slice(0, 500)}`);
  return body;
}

function normalizedBase(event: any, params: { rawMessageId?: string | null; subscription?: any; rawRowId?: string | null }) {
  return {
    channel: { id: event.broadcaster_user_id ?? null, login: event.broadcaster_user_login ?? null, display_name: event.broadcaster_user_name ?? null },
    twitch: { eventsub_message_id: params.rawMessageId ?? null, subscription_id: params.subscription?.id ?? null, subscription_type: params.subscription?.type ?? null, subscription_version: params.subscription?.version ?? null },
    raw_ref: { table: 'twitch_eventsub_messages', id: params.rawRowId ?? null }
  };
}

async function storeNormalizedEvent(db: Database, input: { type: string; externalId: string; channelId?: string | null; payload: Record<string, unknown>; occurredAt?: Date; twitchMessageId?: string | null; twitchSubscriptionId?: string | null }) {
  const [eventRow] = await db.insert(events).values({ source: 'twitch_eventsub', type: input.type, externalId: input.externalId, channelId: input.channelId ?? null, payload: input.payload, status: 'processed', occurredAt: input.occurredAt ?? new Date(), processedAt: new Date(), twitchMessageId: input.twitchMessageId ?? null, twitchSubscriptionId: input.twitchSubscriptionId ?? null }).onConflictDoUpdate({ target: [events.source, events.externalId], set: { payload: input.payload, status: 'processed', processedAt: new Date(), updatedAt: new Date() } }).returning();
  if (eventRow) await enqueueWebhookDeliveriesForEvent(db, eventRow.id);
  return eventRow;
}

export async function normalizeTwitchDataEvent(db: Database, params: { rawMessageId: string; rawEventsubMessageId?: string | null; payload: any }) {
  const subscription = params.payload?.subscription;
  const rawType = subscription?.type;
  const type = eventTypeMap.get(rawType);
  const event = params.payload?.event;
  if (!type || !event) return null;
  const [rawRow] = params.rawEventsubMessageId ? await db.select().from(twitchEventsubMessages).where(eq(twitchEventsubMessages.id, params.rawEventsubMessageId)).limit(1) : [];
  const channel = await findOrCreateChannel(db, event);
  const occurredAt = asDate(event.started_at ?? event.ended_at ?? event.created_at ?? event.message?.sent_at ?? params.payload?.metadata?.message_timestamp);
  const base = normalizedBase(event, { rawMessageId: params.rawMessageId, subscription, rawRowId: rawRow?.id ?? null });

  if (subscriptionEventTypes.includes(rawType)) {
    const actor = { id: event.user_id ?? null, login: event.user_login ?? null, display_name: event.user_name ?? null };
    const normalized = { ...base, actor, subscription: { tier: event.tier ?? null, is_gift: Boolean(event.is_gift ?? rawType === 'channel.subscription.gift'), cumulative_months: event.cumulative_months ?? null, streak_months: event.streak_months ?? null, duration_months: event.duration_months ?? null, gift_total: event.total ?? event.cumulative_total ?? null, gifter: event.gifter_user_id ? { id: event.gifter_user_id, login: event.gifter_user_login ?? null, display_name: event.gifter_user_name ?? null, is_anonymous: Boolean(event.is_anonymous) } : null, message: event.message?.text ?? event.message ?? null } };
    const eventRow = await storeNormalizedEvent(db, { type, externalId: `${type}:${event.user_id ?? params.rawMessageId}:${params.rawMessageId}`, channelId: channel.id, payload: normalized, occurredAt, twitchMessageId: params.rawMessageId, twitchSubscriptionId: subscription.id });
    if (event.user_id) {
      const ended = rawType === 'channel.subscription.end';
      const values = { twitchUserId: String(event.user_id), channelId: channel.id, userLogin: event.user_login ?? null, userDisplayName: event.user_name ?? null, tier: event.tier ?? null, isGift: Boolean(event.is_gift), gifterUserId: event.gifter_user_id ?? null, gifterLogin: event.gifter_user_login ?? null, gifterDisplayName: event.gifter_user_name ?? null, status: ended ? 'ended' : 'active', lastEventType: type, rawPayload: event, rawEventId: rawRow?.id ?? null, eventId: eventRow?.id ?? null, lastSyncedAt: new Date(), subscribedAt: ended ? null : occurredAt, endedAt: ended ? occurredAt : null };
      await db.insert(twitchSubscriptions).values(values).onConflictDoUpdate({ target: [twitchSubscriptions.channelId, twitchSubscriptions.twitchUserId], set: { ...values, updatedAt: new Date() } });
    }
    return eventRow;
  }

  if (rawType === 'channel.cheer') {
    const normalized = { ...base, actor: { id: event.user_id ?? null, login: event.user_login ?? null, display_name: event.user_name ?? null, is_anonymous: Boolean(event.is_anonymous) }, cheer: { bits: Number(event.bits ?? 0), message: event.message ?? null } };
    return storeNormalizedEvent(db, { type, externalId: `${type}:${event.user_id ?? 'anonymous'}:${event.bits ?? 0}:${params.rawMessageId}`, channelId: channel.id, payload: normalized, occurredAt, twitchMessageId: params.rawMessageId, twitchSubscriptionId: subscription.id });
  }

  const stream = rawType.startsWith('stream.') ? { id: event.id ?? null, type: event.type ?? (rawType === 'stream.online' ? 'live' : 'offline'), started_at: event.started_at ?? null } : undefined;
  const update = rawType === 'channel.update' ? { title: event.title ?? null, language: event.language ?? null, category_id: event.category_id ?? null, category_name: event.category_name ?? null, content_classification_labels: event.content_classification_labels ?? [] } : undefined;
  return storeNormalizedEvent(db, { type, externalId: `${type}:${event.id ?? params.rawMessageId}`, channelId: channel.id, payload: { ...base, ...(stream ? { stream } : {}), ...(update ? { update } : {}) }, occurredAt, twitchMessageId: params.rawMessageId, twitchSubscriptionId: subscription.id });
}

export async function runSubscriptionBackfill(db: Database, config: AppConfig, app: AppIdentity) {
  const denied = requirePermission(app, 'subscriptions:backfill'); if (denied) return denied;
  const channel = await primaryChannel(db);
  const [run] = await db.insert(subscriptionBackfillRuns).values({ channelId: channel.id, requestedByAppId: app?.id ?? null }).returning();
  try {
    let cursor: string | undefined;
    let seen = 0;
    do {
      const body = await twitchUserFetch(db, config, '/subscriptions', 'channel:read:subscriptions', { broadcaster_id: channel.broadcasterUserId, first: 100, after: cursor });
      for (const raw of body.data ?? []) {
        seen++;
        const userId = String(raw.user_id);
        await db.insert(twitchSubscriptions).values({ twitchUserId: userId, channelId: channel.id, userLogin: raw.user_login ?? null, userDisplayName: raw.user_name ?? null, tier: raw.tier ?? null, isGift: Boolean(raw.is_gift), gifterUserId: raw.gifter_id ?? null, gifterLogin: raw.gifter_login ?? null, gifterDisplayName: raw.gifter_name ?? null, status: 'active', lastEventType: 'backfill', rawPayload: raw, lastSyncedAt: new Date() }).onConflictDoUpdate({ target: [twitchSubscriptions.channelId, twitchSubscriptions.twitchUserId], set: { userLogin: raw.user_login ?? null, userDisplayName: raw.user_name ?? null, tier: raw.tier ?? null, isGift: Boolean(raw.is_gift), status: 'active', lastEventType: 'backfill', rawPayload: raw, lastSyncedAt: new Date(), updatedAt: new Date() } });
      }
      cursor = body.pagination?.cursor;
    } while (cursor);
    const [updated] = await db.update(subscriptionBackfillRuns).set({ status: 'completed', subscriptionsSeen: seen, completedAt: new Date(), cursor: cursor ?? null }).where(eq(subscriptionBackfillRuns.id, run!.id)).returning();
    return { ok: true as const, run: updated!, subscriptions: await listSubscriptions(db, app, {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown subscription backfill error';
    const [updated] = await db.update(subscriptionBackfillRuns).set({ status: 'failed', error: message, completedAt: new Date() }).where(eq(subscriptionBackfillRuns.id, run!.id)).returning();
    await db.insert(diagnosticEvents).values({ severity: 'error', module: 'twitch-data', message: 'Subscription backfill failed', details: { runId: run!.id, error: message } });
    return { ok: false as const, statusCode: 502, error: message, run: updated };
  }
}

export async function listSubscriptions(db: Database, app: AppIdentity, query: { status?: string; limit?: number }) {
  const denied = requirePermission(app, 'subscriptions:read'); if (denied) return denied;
  const channel = await primaryChannel(db);
  const rows = await db.select().from(twitchSubscriptions).where(and(eq(twitchSubscriptions.channelId, channel.id), query.status ? eq(twitchSubscriptions.status, query.status) : undefined)).orderBy(desc(twitchSubscriptions.updatedAt)).limit(Math.min(query.limit ?? 100, 500));
  return { ok: true as const, subscriptions: rows };
}

export async function runBitsBackfill(db: Database, config: AppConfig, app: AppIdentity, input: { period?: string; count?: number }) {
  const denied = requirePermission(app, 'bits:backfill'); if (denied) return denied;
  const channel = await primaryChannel(db);
  const period = input.period ?? 'all';
  const [run] = await db.insert(bitsBackfillRuns).values({ channelId: channel.id, requestedByAppId: app?.id ?? null, period }).returning();
  try {
    const body = await twitchUserFetch(db, config, '/bits/leaderboard', 'bits:read', { count: Math.min(input.count ?? 100, 100), period });
    let seen = 0;
    for (const raw of body.data ?? []) {
      seen++;
      await db.insert(bitsLeaderboardEntries).values({ channelId: channel.id, userId: String(raw.user_id), userLogin: raw.user_login ?? null, userDisplayName: raw.user_name ?? null, rank: raw.rank ?? null, score: Number(raw.score ?? 0), period, startedAt: body.date_range?.started_at ? new Date(body.date_range.started_at) : null, endedAt: body.date_range?.ended_at ? new Date(body.date_range.ended_at) : null, rawPayload: raw, lastSyncedAt: new Date() }).onConflictDoUpdate({ target: [bitsLeaderboardEntries.channelId, bitsLeaderboardEntries.userId, bitsLeaderboardEntries.period], set: { userLogin: raw.user_login ?? null, userDisplayName: raw.user_name ?? null, rank: raw.rank ?? null, score: Number(raw.score ?? 0), rawPayload: raw, lastSyncedAt: new Date(), updatedAt: new Date() } });
    }
    const [updated] = await db.update(bitsBackfillRuns).set({ status: 'completed', entriesSeen: seen, completedAt: new Date() }).where(eq(bitsBackfillRuns.id, run!.id)).returning();
    return { ok: true as const, run: updated!, leaderboard: await listBitsLeaderboard(db, app, { period }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown bits backfill error';
    const [updated] = await db.update(bitsBackfillRuns).set({ status: 'failed', error: message, completedAt: new Date() }).where(eq(bitsBackfillRuns.id, run!.id)).returning();
    await db.insert(diagnosticEvents).values({ severity: 'error', module: 'twitch-data', message: 'Bits backfill failed', details: { runId: run!.id, error: message } });
    return { ok: false as const, statusCode: 502, error: message, run: updated };
  }
}

export async function listBitsLeaderboard(db: Database, app: AppIdentity, query: { period?: string; limit?: number }) {
  const denied = requirePermission(app, 'bits:read'); if (denied) return denied;
  const channel = await primaryChannel(db);
  const rows = await db.select().from(bitsLeaderboardEntries).where(and(eq(bitsLeaderboardEntries.channelId, channel.id), query.period ? eq(bitsLeaderboardEntries.period, query.period) : undefined)).orderBy(desc(bitsLeaderboardEntries.score)).limit(Math.min(query.limit ?? 100, 500));
  return { ok: true as const, leaderboard: rows };
}

export async function getCurrentStream(db: Database, config: AppConfig, app: AppIdentity) {
  const denied = requirePermission(app, 'streams:read'); if (denied) return denied;
  const channel = await primaryChannel(db);
  const body = await twitchAppFetch(config, '/streams', { user_id: channel.broadcasterUserId, first: 1 });
  const stream = body.data?.[0] ?? null;
  await db.insert(diagnosticEvents).values({ severity: 'info', module: 'twitch-data', message: 'Stream status checked', details: { broadcasterUserId: channel.broadcasterUserId, live: Boolean(stream), viewerCount: stream?.viewer_count ?? 0 } });
  return { ok: true as const, stream, status: { channel_id: channel.id, broadcaster_user_id: channel.broadcasterUserId, is_live: Boolean(stream), viewer_count: stream?.viewer_count ?? 0, title: stream?.title ?? null, game_id: stream?.game_id ?? null, game_name: stream?.game_name ?? null, started_at: stream?.started_at ?? null, checked_at: new Date().toISOString() } };
}

export async function listChannels(db: Database, app: AppIdentity) {
  const denied = requirePermission(app, 'streams:read'); if (denied) return denied;
  return { ok: true as const, channels: await db.select().from(twitchChannels).where(eq(twitchChannels.enabled, true)).orderBy(desc(twitchChannels.primaryChannel)) };
}

async function channelById(db: Database, channelId: string) { const [channel] = await db.select().from(twitchChannels).where(eq(twitchChannels.id, channelId)).limit(1); return channel ?? null; }
export async function getChannelProfile(db: Database, config: AppConfig, app: AppIdentity, channelId: string) {
  const denied = requirePermission(app, 'streams:read'); if (denied) return denied;
  const channel = await channelById(db, channelId);
  if (!channel) return { ok: false as const, statusCode: 404, error: 'Channel not found' };
  const body = await twitchAppFetch(config, '/users', { id: channel.broadcasterUserId });
  return { ok: true as const, profile: body.data?.[0] ?? null };
}
export async function getChannelSchedule(db: Database, config: AppConfig, app: AppIdentity, channelId: string) {
  const denied = requirePermission(app, 'streams:read'); if (denied) return denied;
  const channel = await channelById(db, channelId);
  if (!channel) return { ok: false as const, statusCode: 404, error: 'Channel not found' };
  const body = await twitchAppFetch(config, '/schedule', { broadcaster_id: channel.broadcasterUserId });
  return { ok: true as const, schedule: body.data ?? null };
}

export async function twitchDataDiagnostics(db: Database) {
  const [lastSubscriptionEvent] = await db.select().from(events).where(inArray(events.type, ['twitch.channel.subscribe', 'twitch.channel.subscription.end', 'twitch.channel.subscription.message', 'twitch.channel.subscription.gift'])).orderBy(desc(events.occurredAt)).limit(1);
  const [lastBitsEvent] = await db.select().from(events).where(eq(events.type, 'twitch.channel.cheer')).orderBy(desc(events.occurredAt)).limit(1);
  const [lastStreamStatusCheck] = await db.select().from(diagnosticEvents).where(eq(diagnosticEvents.message, 'Stream status checked')).orderBy(desc(diagnosticEvents.createdAt)).limit(1);
  const lastSubscriptionBackfillRuns = await db.select().from(subscriptionBackfillRuns).orderBy(desc(subscriptionBackfillRuns.startedAt)).limit(5);
  const lastBitsBackfillRuns = await db.select().from(bitsBackfillRuns).orderBy(desc(bitsBackfillRuns.startedAt)).limit(5);
  return { lastSubscriptionEvent, lastBitsEvent, lastStreamStatusCheck, lastBackfillRuns: { subscriptions: lastSubscriptionBackfillRuns, bits: lastBitsBackfillRuns }, backfillFailures: { subscriptions: lastSubscriptionBackfillRuns.filter((run) => run.status === 'failed'), bits: lastBitsBackfillRuns.filter((run) => run.status === 'failed') } };
}
