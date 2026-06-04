import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { adminAuditLog, appChannelPointRewardBindings, events, rewardSyncRuns, twitchChannelPointRedemptions, twitchChannelPointRewards, twitchChannels, twitchEventsubMessages } from '../../db/schema.js';
import { getUserAccessToken } from '../twitch/service.js';
import { enqueueWebhookDeliveriesForEvent } from '../webhooks/service.js';

export type AppIdentity = { id: string; slug: string; permissions: string[] };
export const redemptionStatuses = ['UNFULFILLED', 'FULFILLED', 'CANCELED'] as const;
const helix = 'https://api.twitch.tv/helix';

function has(app: AppIdentity, permission: string) { return app.permissions.includes(permission); }
function requirePermission(app: AppIdentity, permission: string) { if (!has(app, permission)) return { ok: false as const, statusCode: 403, error: `App is missing ${permission} permission` }; return null; }
function isoDate(value: unknown) { const date = typeof value === 'string' ? new Date(value) : new Date(); return Number.isNaN(date.getTime()) ? new Date() : date; }
function rewardLimits(raw: any) { return { max_per_stream: raw.max_per_stream_setting ?? null, max_per_user_per_stream: raw.max_per_user_per_stream_setting ?? null, global_cooldown: raw.global_cooldown_setting ?? null }; }
function normalizeReward(raw: any, channelId: string, ownerAppId?: string | null) {
  return {
    twitchRewardId: String(raw.id), channelId, owningAppId: ownerAppId ?? null, title: String(raw.title ?? ''), cost: Number(raw.cost ?? 0), prompt: raw.prompt ?? null,
    enabled: Boolean(raw.is_enabled ?? raw.enabled ?? true), manageable: Boolean(raw.should_redemptions_skip_request_queue !== undefined ? true : raw.is_manageable ?? false),
    backgroundColor: raw.background_color ?? null, isUserInputRequired: Boolean(raw.is_user_input_required ?? false), limits: rewardLimits(raw), rawPayload: raw, lastSyncedAt: new Date(), deletedAt: null
  };
}
function normalizeRedemptionPayload(redemption: typeof twitchChannelPointRedemptions.$inferSelect, reward: typeof twitchChannelPointRewards.$inferSelect | null, eventType: string) {
  return {
    channel: { id: redemption.channelId },
    reward: { id: reward?.id ?? redemption.rewardId, twitch_reward_id: redemption.twitchRewardId, title: reward?.title ?? (redemption.rawPayload as any)?.reward?.title ?? null, cost: reward?.cost ?? (redemption.rawPayload as any)?.reward?.cost ?? null, owning_app_id: reward?.owningAppId ?? null },
    redemption: { id: redemption.id, twitch_redemption_id: redemption.twitchRedemptionId, status: redemption.status, user_input: redemption.userInput, redeemed_at: redemption.redeemedAt.toISOString(), fulfilled_at: redemption.fulfilledAt?.toISOString() ?? null, canceled_at: redemption.canceledAt?.toISOString() ?? null },
    user: { id: redemption.userId, login: redemption.userLogin, display_name: redemption.userDisplayName },
    twitch: { event_type: eventType, raw_event_id: redemption.rawEventId },
    idempotency: { twitch_redemption_id: redemption.twitchRedemptionId }
  };
}
async function primaryChannel(db: Database) { const [channel] = await db.select().from(twitchChannels).where(eq(twitchChannels.enabled, true)).limit(1); if (!channel) throw new Error('No Twitch channel is configured'); return channel; }
async function twitchFetch(db: Database, config: AppConfig, url: URL, init: RequestInit = {}) {
  const token = await getUserAccessToken(db, config, 'broadcaster');
  if (!token.scopes.includes('channel:manage:redemptions')) throw new Error('Broadcaster token is missing channel:manage:redemptions');
  const response = await fetch(url, { ...init, headers: { 'Client-Id': config.TWITCH_CLIENT_ID ?? '', Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Twitch API ${url.pathname} failed with ${response.status}: ${text.slice(0, 500)}`);
  return body;
}
async function upsertReward(db: Database, raw: any, channelId: string, ownerAppId?: string | null) {
  const values = normalizeReward(raw, channelId, ownerAppId);
  const [existing] = await db.select().from(twitchChannelPointRewards).where(eq(twitchChannelPointRewards.twitchRewardId, values.twitchRewardId)).limit(1);
  const [reward] = existing
    ? await db.update(twitchChannelPointRewards).set({ ...values, owningAppId: existing.owningAppId ?? values.owningAppId, updatedAt: new Date() }).where(eq(twitchChannelPointRewards.id, existing.id)).returning()
    : await db.insert(twitchChannelPointRewards).values(values).returning();
  if (reward?.owningAppId) await db.insert(appChannelPointRewardBindings).values({ appId: reward.owningAppId, rewardId: reward.id, permission: 'owner' }).onConflictDoNothing();
  return { reward: reward!, created: !existing };
}
export async function listRewards(db: Database, app: AppIdentity, query: { includeDeleted?: boolean }) {
  const denied = requirePermission(app, 'channel_points:rewards:read'); if (denied) return denied;
  return { ok: true as const, rewards: await db.select().from(twitchChannelPointRewards).where(query.includeDeleted ? undefined : isNull(twitchChannelPointRewards.deletedAt)).orderBy(twitchChannelPointRewards.title) };
}
export async function createReward(db: Database, config: AppConfig, app: AppIdentity, input: any) {
  const denied = requirePermission(app, 'channel_points:rewards:create'); if (denied) return denied;
  const channel = await primaryChannel(db); const url = new URL(`${helix}/channel_points/custom_rewards`); url.searchParams.set('broadcaster_id', channel.broadcasterUserId);
  const body = { title: input.title, cost: input.cost, prompt: input.prompt, is_enabled: input.is_enabled ?? true, background_color: input.background_color, is_user_input_required: input.is_user_input_required, is_max_per_stream_enabled: input.is_max_per_stream_enabled, max_per_stream: input.max_per_stream, is_max_per_user_per_stream_enabled: input.is_max_per_user_per_stream_enabled, max_per_user_per_stream: input.max_per_user_per_stream, is_global_cooldown_enabled: input.is_global_cooldown_enabled, global_cooldown_seconds: input.global_cooldown_seconds, should_redemptions_skip_request_queue: input.should_redemptions_skip_request_queue };
  const cleaned = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
  const response = await twitchFetch(db, config, url, { method: 'POST', body: JSON.stringify(cleaned) });
  const raw = response.data?.[0]; if (!raw) throw new Error('Twitch did not return created reward');
  const { reward } = await upsertReward(db, raw, channel.id, app.id);
  return { ok: true as const, statusCode: 201, reward };
}
export async function getReward(db: Database, app: AppIdentity, rewardId: string) {
  const denied = requirePermission(app, 'channel_points:rewards:read'); if (denied) return denied;
  const [reward] = await db.select().from(twitchChannelPointRewards).where(eq(twitchChannelPointRewards.id, rewardId)).limit(1);
  if (!reward) return { ok: false as const, statusCode: 404, error: 'Reward not found' };
  return { ok: true as const, reward };
}
async function mutableReward(db: Database, app: AppIdentity, rewardId: string, permission: string) {
  const denied = requirePermission(app, permission); if (denied) return denied;
  const [reward] = await db.select().from(twitchChannelPointRewards).where(eq(twitchChannelPointRewards.id, rewardId)).limit(1);
  if (!reward || reward.deletedAt) return { ok: false as const, statusCode: 404, error: 'Reward not found' };
  if (app.slug !== 'admin' && reward.owningAppId !== app.id) return { ok: false as const, statusCode: 403, error: 'Only the owning app can mutate this reward' };
  return { ok: true as const, reward };
}
export async function updateReward(db: Database, config: AppConfig, app: AppIdentity, rewardId: string, patch: any) {
  const loaded = await mutableReward(db, app, rewardId, 'channel_points:rewards:update'); if (!loaded.ok) return loaded;
  const url = new URL(`${helix}/channel_points/custom_rewards`); url.searchParams.set('broadcaster_id', (await primaryChannel(db)).broadcasterUserId); url.searchParams.set('id', loaded.reward.twitchRewardId);
  const response = await twitchFetch(db, config, url, { method: 'PATCH', body: JSON.stringify(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))) });
  const raw = response.data?.[0]; const { reward } = await upsertReward(db, raw ?? { ...loaded.reward.rawPayload as any, ...patch, id: loaded.reward.twitchRewardId }, loaded.reward.channelId, app.id);
  return { ok: true as const, reward };
}
export async function deleteReward(db: Database, config: AppConfig, app: AppIdentity, rewardId: string) {
  const loaded = await mutableReward(db, app, rewardId, 'channel_points:rewards:delete'); if (!loaded.ok) return loaded;
  const channel = await primaryChannel(db); const url = new URL(`${helix}/channel_points/custom_rewards`); url.searchParams.set('broadcaster_id', channel.broadcasterUserId); url.searchParams.set('id', loaded.reward.twitchRewardId);
  await twitchFetch(db, config, url, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
  const [reward] = await db.update(twitchChannelPointRewards).set({ enabled: false, deletedAt: new Date(), updatedAt: new Date() }).where(eq(twitchChannelPointRewards.id, rewardId)).returning();
  return { ok: true as const, reward };
}
export async function syncRewards(db: Database, config: AppConfig, app: AppIdentity | null) {
  if (app) { const denied = requirePermission(app, 'channel_points:rewards:read'); if (denied) return denied; }
  const channel = await primaryChannel(db); const [insertedRun] = await db.insert(rewardSyncRuns).values({ channelId: channel.id, requestedByAppId: app?.id ?? null }).returning();
  if (!insertedRun) throw new Error('Unable to create reward sync run');
  const run = insertedRun;
  try {
    const url = new URL(`${helix}/channel_points/custom_rewards`); url.searchParams.set('broadcaster_id', channel.broadcasterUserId); url.searchParams.set('only_manageable_rewards', 'false');
    const response = await twitchFetch(db, config, url); const rewards = Array.isArray(response.data) ? response.data : [];
    const twitchRewardIds = new Set(rewards.map((reward: any) => String(reward.id)));
    const activeLocalRewards = await db.select().from(twitchChannelPointRewards).where(and(eq(twitchChannelPointRewards.channelId, channel.id), isNull(twitchChannelPointRewards.deletedAt)));
    const missingOnTwitch = activeLocalRewards.filter((reward) => !twitchRewardIds.has(reward.twitchRewardId));
    const deletedAt = new Date();
    for (const reward of missingOnTwitch) await db.update(twitchChannelPointRewards).set({ enabled: false, deletedAt, updatedAt: deletedAt }).where(eq(twitchChannelPointRewards.id, reward.id));
    let created = 0, updated = 0, missing = 0;
    for (const raw of rewards) { const result = await upsertReward(db, raw, channel.id, null); result.created ? created++ : updated++; if (!result.reward.owningAppId) missing++; }
    const [updatedRun] = await db.update(rewardSyncRuns).set({ status: 'completed', rewardsSeen: rewards.length, rewardsCreated: created, rewardsUpdated: updated, rewardsMissingOwnership: missing, rewardsMissingOnTwitch: missingOnTwitch.length, completedAt: new Date() }).where(eq(rewardSyncRuns.id, run.id)).returning();
    return { ok: true as const, run: updatedRun ?? run, rewards: await db.select().from(twitchChannelPointRewards).where(isNull(twitchChannelPointRewards.deletedAt)).orderBy(twitchChannelPointRewards.title) };
  } catch (error) { const message = error instanceof Error ? error.message : String(error); await db.update(rewardSyncRuns).set({ status: 'failed', error: message, completedAt: new Date() }).where(eq(rewardSyncRuns.id, run.id)); throw error; }
}
export async function listRedemptions(db: Database, app: AppIdentity, query: { rewardId?: string; status?: string; limit?: number }) {
  const denied = requirePermission(app, 'channel_points:redemptions:read'); if (denied) return denied;
  const clauses = []; if (query.rewardId) clauses.push(eq(twitchChannelPointRedemptions.rewardId, query.rewardId)); if (query.status) clauses.push(eq(twitchChannelPointRedemptions.status, query.status));
  return { ok: true as const, redemptions: await db.select().from(twitchChannelPointRedemptions).where(clauses.length ? and(...clauses) : undefined).orderBy(desc(twitchChannelPointRedemptions.redeemedAt)).limit(Math.min(query.limit ?? 100, 500)) };
}
export async function fetchRedemptionsFromTwitch(db: Database, config: AppConfig, app: AppIdentity, rewardId: string, status?: string) {
  const loaded = await getReward(db, app, rewardId); if (!loaded.ok) return loaded;
  const channel = await primaryChannel(db); const url = new URL(`${helix}/channel_points/custom_rewards/redemptions`); url.searchParams.set('broadcaster_id', channel.broadcasterUserId); url.searchParams.set('reward_id', loaded.reward.twitchRewardId); if (status) url.searchParams.set('status', status);
  const response = await twitchFetch(db, config, url); for (const raw of response.data ?? []) await persistRedemptionFromRaw(db, raw, loaded.reward, null, 'twitch.channel_points.custom_reward_redemption.update', false);
  return listRedemptions(db, app, { rewardId });
}
// Gateway never auto-fulfills or auto-cancels redemptions; downstream apps must call this explicit status endpoint.
export async function updateRedemptionStatus(db: Database, config: AppConfig, app: AppIdentity, rewardId: string, redemptionId: string, status: 'FULFILLED' | 'CANCELED', reason?: string) {
  const loaded = await mutableReward(db, app, rewardId, 'channel_points:redemptions:manage'); if (!loaded.ok) return loaded;
  const channel = await primaryChannel(db); const [redemption] = await db.select().from(twitchChannelPointRedemptions).where(eq(twitchChannelPointRedemptions.id, redemptionId)).limit(1); if (!redemption) return { ok: false as const, statusCode: 404, error: 'Redemption not found' };
  const url = new URL(`${helix}/channel_points/custom_rewards/redemptions`); url.searchParams.set('broadcaster_id', channel.broadcasterUserId); url.searchParams.set('reward_id', loaded.reward.twitchRewardId); url.searchParams.set('id', redemption.twitchRedemptionId);
  await twitchFetch(db, config, url, { method: 'PATCH', body: JSON.stringify({ status }) });
  const now = new Date(); const [updated] = await db.update(twitchChannelPointRedemptions).set({ status, fulfilledAt: status === 'FULFILLED' ? now : redemption.fulfilledAt, canceledAt: status === 'CANCELED' ? now : redemption.canceledAt, updatedAt: now }).where(eq(twitchChannelPointRedemptions.id, redemptionId)).returning();
  await db.insert(adminAuditLog).values({ action: 'channel_points.redemption_status.update', targetType: 'channel_point_redemption', targetId: updated!.id, metadata: { appId: app.id, rewardId, status, reason: reason ?? null } });
  return { ok: true as const, redemption: updated! };
}
export async function persistRedemptionFromRaw(db: Database, raw: any, reward: typeof twitchChannelPointRewards.$inferSelect | null, rawEventId: string | null, eventType: string, deliver = true) {
  const selectedChannel = reward ? (await db.select().from(twitchChannels).where(eq(twitchChannels.id, reward.channelId)).limit(1))[0] : await primaryChannel(db);
  const channel = selectedChannel ?? await primaryChannel(db);
  const twitchRewardId = raw.reward?.id ?? raw.reward_id ?? reward?.twitchRewardId;
  const [localReward] = reward ? [reward] : await db.select().from(twitchChannelPointRewards).where(eq(twitchChannelPointRewards.twitchRewardId, twitchRewardId)).limit(1);
  const status = String(raw.status ?? 'UNFULFILLED'); const redeemedAt = isoDate(raw.redeemed_at);
  const values = { twitchRedemptionId: String(raw.id), channelId: localReward?.channelId ?? channel.id, rewardId: localReward?.id ?? null, twitchRewardId: String(twitchRewardId), userId: raw.user_id ?? null, userLogin: raw.user_login ?? null, userDisplayName: raw.user_name ?? raw.user_display_name ?? null, status, userInput: raw.user_input ?? null, redeemedAt, fulfilledAt: status === 'FULFILLED' ? new Date() : null, canceledAt: status === 'CANCELED' ? new Date() : null, rawPayload: raw, rawEventId };
  const [row] = await db.insert(twitchChannelPointRedemptions).values(values).onConflictDoUpdate({ target: twitchChannelPointRedemptions.twitchRedemptionId, set: { ...values, updatedAt: new Date() } }).returning();
  if (!row) throw new Error('Unable to persist channel point redemption');
  const payload = normalizeRedemptionPayload(row, localReward ?? null, eventType);
  const [eventRow] = await db.insert(events).values({ source: 'twitch_eventsub', type: eventType, externalId: `${eventType}:${row.twitchRedemptionId}`, channelId: row.channelId, payload, status: 'processed', occurredAt: redeemedAt, processedAt: new Date() }).onConflictDoUpdate({ target: [events.source, events.externalId], set: { payload, status: 'processed', processedAt: new Date(), updatedAt: new Date() } }).returning();
  if (!eventRow) throw new Error('Unable to persist channel point redemption event');
  await db.update(twitchChannelPointRedemptions).set({ eventId: eventRow.id, updatedAt: new Date() }).where(eq(twitchChannelPointRedemptions.id, row.id));
  if (deliver) await enqueueWebhookDeliveriesForEvent(db, eventRow.id);
  return row;
}
export async function normalizeChannelPointRedemptionEvent(db: Database, params: { rawMessageId: string; rawEventsubMessageId?: string | null; payload: any }) {
  const type = params.payload?.subscription?.type; if (!['channel.channel_points_custom_reward_redemption.add', 'channel.channel_points_custom_reward_redemption.update'].includes(type)) return null;
  const eventType = type.endsWith('.add') ? 'twitch.channel_points.custom_reward_redemption.add' : 'twitch.channel_points.custom_reward_redemption.update';
  const [rawRow] = params.rawEventsubMessageId ? await db.select().from(twitchEventsubMessages).where(eq(twitchEventsubMessages.id, params.rawEventsubMessageId)).limit(1) : [];
  return persistRedemptionFromRaw(db, params.payload.event, null, rawRow?.id ?? null, eventType, true);
}
export async function channelPointDiagnostics(db: Database) {
  const [lastSync] = await db.select().from(rewardSyncRuns).orderBy(desc(rewardSyncRuns.startedAt)).limit(1);
  const [lastRedemption] = await db.select().from(twitchChannelPointRedemptions).orderBy(desc(twitchChannelPointRedemptions.updatedAt)).limit(1);
  const [missingOwnership] = await db.select({ value: sql<number>`count(*)` }).from(twitchChannelPointRewards).where(and(isNull(twitchChannelPointRewards.owningAppId), isNull(twitchChannelPointRewards.deletedAt)));
  return { lastRewardSync: lastSync ?? null, lastRedemptionEvent: lastRedemption ?? null, twitchRewardsMissingOwnershipMapping: Number(missingOwnership?.value ?? 0), rewardsMissingOnTwitch: lastSync?.rewardsMissingOnTwitch ?? 0, notes: ['rewardsMissingOnTwitch is populated from the latest reward sync reconciliation'] };
}
