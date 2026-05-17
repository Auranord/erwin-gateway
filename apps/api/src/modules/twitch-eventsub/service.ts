import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { AppConfig } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { diagnosticEvents, events, twitchEventsubMessages, twitchEventsubSubscriptions } from '../../db/schema.js';
import { getAppAccessToken } from '../twitch/service.js';
import { desiredKey, eventSubCallbackUrl, getDesiredEventSubSubscriptions, sortCondition, type DesiredEventSubSubscription } from './desired.js';

export type EventSubMessageType = 'notification' | 'webhook_callback_verification' | 'revocation';

type TwitchSubscription = {
  id: string;
  status: string;
  type: string;
  version: string;
  condition: Record<string, string>;
  transport: { method: string; callback?: string };
  cost?: number;
  created_at?: string;
};

async function twitchRequest(config: AppConfig, path: string, init: RequestInit = {}) {
  const token = await getAppAccessToken(config);
  const response = await fetch(`https://api.twitch.tv/helix${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token.accessToken}`,
      'Client-Id': config.TWITCH_CLIENT_ID!,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Twitch ${path} failed with ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function listTwitchEventSubSubscriptions(config: AppConfig): Promise<TwitchSubscription[]> {
  const rows: TwitchSubscription[] = [];
  let cursor: string | undefined;
  do {
    const query = cursor ? `?after=${encodeURIComponent(cursor)}` : '';
    const payload = await twitchRequest(config, `/eventsub/subscriptions${query}`) as { data?: TwitchSubscription[]; pagination?: { cursor?: string } };
    rows.push(...(payload.data ?? []));
    cursor = payload.pagination?.cursor;
  } while (cursor);
  return rows;
}

async function createSubscription(config: AppConfig, callback: string, desired: DesiredEventSubSubscription) {
  const payload = await twitchRequest(config, '/eventsub/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      type: desired.type,
      version: desired.version,
      condition: desired.condition,
      transport: { method: 'webhook', callback, secret: config.TWITCH_EVENTSUB_SECRET }
    })
  }) as { data?: TwitchSubscription[] };
  return payload.data?.[0];
}

async function deleteSubscription(config: AppConfig, id: string) {
  await twitchRequest(config, `/eventsub/subscriptions?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}

async function upsertLocalSubscription(db: Database, callback: string, remote: TwitchSubscription, desired?: DesiredEventSubSubscription, error?: string | null) {
  const condition = sortCondition(desired?.condition ?? remote.condition ?? {});
  const now = new Date();
  const [existing] = await db.select().from(twitchEventsubSubscriptions)
    .where(and(eq(twitchEventsubSubscriptions.type, remote.type), eq(twitchEventsubSubscriptions.version, remote.version), eq(twitchEventsubSubscriptions.condition, condition)))
    .limit(1);
  const values = {
    twitchSubscriptionId: remote.id,
    type: remote.type,
    version: remote.version,
    condition,
    callbackUrl: remote.transport.callback ?? callback,
    status: remote.status,
    transportMethod: remote.transport.method,
    cost: remote.cost ?? null,
    lastSyncedAt: now,
    lastVerifiedAt: remote.status === 'enabled' ? now : null,
    revokedAt: remote.status === 'enabled' ? null : (remote.status.includes('revoked') ? now : null),
    revokeReason: remote.status === 'enabled' ? null : null,
    lastError: error ?? null,
    updatedAt: now
  };
  if (existing) {
    await db.update(twitchEventsubSubscriptions).set(values).where(eq(twitchEventsubSubscriptions.id, existing.id));
  } else {
    await db.insert(twitchEventsubSubscriptions).values(values);
  }
}

export async function reconcileEventSubSubscriptions(db: Database, config: AppConfig) {
  if (!config.TWITCH_EVENTSUB_SECRET || config.TWITCH_EVENTSUB_SECRET.length < 10) {
    throw new Error('TWITCH_EVENTSUB_SECRET must be configured for EventSub webhooks');
  }
  const callback = eventSubCallbackUrl(config);
  const desired = await getDesiredEventSubSubscriptions(db, config);
  const desiredByKey = new Map(desired.map((item) => [desiredKey(item), item]));
  const remote = await listTwitchEventSubSubscriptions(config);
  const actions: Array<Record<string, unknown>> = [];

  for (const remoteSub of remote) {
    if (remoteSub.transport.method !== 'webhook') continue;
    const key = desiredKey({ type: remoteSub.type, version: remoteSub.version, condition: remoteSub.condition });
    const desiredSub = desiredByKey.get(key);
    const callbackMismatch = desiredSub && remoteSub.transport.callback !== callback;
    const unhealthy = !['enabled', 'webhook_callback_verification_pending'].includes(remoteSub.status);
    if (desiredSub && (callbackMismatch || unhealthy)) {
      await deleteSubscription(config, remoteSub.id);
      actions.push({ action: 'delete_mismatched', type: remoteSub.type, id: remoteSub.id, status: remoteSub.status, callbackMismatch });
      continue;
    }
    if (desiredSub) await upsertLocalSubscription(db, callback, remoteSub, desiredSub);
  }

  const refreshed = await listTwitchEventSubSubscriptions(config);
  const refreshedByKey = new Map(refreshed.filter((sub) => sub.transport.method === 'webhook').map((sub) => [desiredKey(sub), sub]));
  for (const desiredSub of desired) {
    const existing = refreshedByKey.get(desiredKey(desiredSub));
    if (existing && existing.transport.callback === callback && ['enabled', 'webhook_callback_verification_pending'].includes(existing.status)) {
      await upsertLocalSubscription(db, callback, existing, desiredSub);
      continue;
    }
    try {
      const created = await createSubscription(config, callback, desiredSub);
      if (created) await upsertLocalSubscription(db, callback, created, desiredSub);
      actions.push({ action: 'create_missing', type: desiredSub.type, id: created?.id ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown create error';
      await db.insert(diagnosticEvents).values({ severity: 'error', module: 'twitch-eventsub', message: 'EventSub subscription create failed', details: { type: desiredSub.type, version: desiredSub.version, condition: desiredSub.condition, error: message } });
      actions.push({ action: 'create_failed', type: desiredSub.type, error: message });
    }
  }

  return { callback, desiredCount: desired.length, remoteCount: remote.length, actions };
}

export async function persistEventSubMessage(db: Database, params: { messageId: string; messageType: EventSubMessageType | string; headers: Record<string, string | undefined>; payload: any }) {
  const subscription = params.payload?.subscription;
  try {
    const [row] = await db.insert(twitchEventsubMessages).values({
      messageId: params.messageId,
      messageType: params.messageType,
      subscriptionType: subscription?.type ?? params.headers['twitch-eventsub-subscription-type'] ?? null,
      subscriptionVersion: subscription?.version ?? params.headers['twitch-eventsub-subscription-version'] ?? null,
      twitchSubscriptionId: subscription?.id ?? null,
      eventType: subscription?.type ?? null,
      payload: params.payload,
      headers: params.headers
    }).returning();
    return { duplicate: false, row };
  } catch (error: any) {
    if (error?.code === '23505') {
      await db.insert(diagnosticEvents).values({ severity: 'info', module: 'twitch-eventsub', message: 'Duplicate EventSub message ignored', details: { messageId: params.messageId, messageType: params.messageType } });
      return { duplicate: true, row: null };
    }
    throw error;
  }
}

export async function enqueueEventFromNotification(db: Database, messageId: string, payload: any) {
  const subscription = payload.subscription;
  const externalId = payload.event?.id ?? messageId;
  await db.insert(events).values({
    source: 'twitch_eventsub',
    type: subscription?.type ?? 'unknown',
    externalId,
    twitchMessageId: messageId,
    twitchSubscriptionId: subscription?.id ?? null,
    payload,
    status: 'queued'
  }).onConflictDoNothing();
}

export async function recordRevocation(db: Database, payload: any) {
  const subscription = payload.subscription;
  const now = new Date();
  if (subscription?.id) {
    await db.update(twitchEventsubSubscriptions).set({
      status: subscription.status ?? 'revoked',
      revokedAt: now,
      revokeReason: subscription.status ?? 'revoked',
      updatedAt: now
    }).where(eq(twitchEventsubSubscriptions.twitchSubscriptionId, subscription.id));
  }
  await db.insert(diagnosticEvents).values({ severity: 'warn', module: 'twitch-eventsub', message: 'EventSub subscription revoked', details: { subscription } });
}

export async function getEventSubDiagnostics(db: Database, config: AppConfig) {
  const [lastDelivery] = await db.select().from(twitchEventsubMessages).orderBy(desc(twitchEventsubMessages.receivedAt)).limit(1);
  const [duplicateRow] = await db.select({ value: count() }).from(diagnosticEvents).where(eq(diagnosticEvents.message, 'Duplicate EventSub message ignored'));
  const rows = await db.select().from(twitchEventsubSubscriptions).orderBy(twitchEventsubSubscriptions.type);
  let desired: DesiredEventSubSubscription[] = [];
  let desiredError: string | null = null;
  try { desired = await getDesiredEventSubSubscriptions(db, config); } catch (error) { desiredError = error instanceof Error ? error.message : 'unknown desired-state error'; }
  const localKeys = new Set(rows.filter((row) => row.status === 'enabled' || row.status === 'webhook_callback_verification_pending').map((row) => desiredKey(row)));
  const missing = desired.filter((item) => !localKeys.has(desiredKey(item)));
  const revoked = rows.filter((row) => row.revokedAt || !['enabled', 'webhook_callback_verification_pending', 'desired'].includes(row.status));
  return {
    callbackUrl: (() => { try { return eventSubCallbackUrl(config); } catch { return null; } })(),
    lastDelivery: lastDelivery ? { messageId: lastDelivery.messageId, messageType: lastDelivery.messageType, eventType: lastDelivery.eventType, receivedAt: lastDelivery.receivedAt.toISOString(), duplicate: lastDelivery.duplicate } : null,
    subscriptions: rows.map((row) => ({ id: row.id, twitchSubscriptionId: row.twitchSubscriptionId, type: row.type, version: row.version, condition: row.condition, callbackUrl: row.callbackUrl, status: row.status, revokedAt: row.revokedAt?.toISOString() ?? null, revokeReason: row.revokeReason, lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null, lastError: row.lastError })),
    missingSubscriptions: missing,
    revokedSubscriptions: revoked.map((row) => ({ type: row.type, status: row.status, revokeReason: row.revokeReason, twitchSubscriptionId: row.twitchSubscriptionId })),
    duplicateCount: Number(duplicateRow?.value ?? 0),
    desiredError,
    healthy: !desiredError && missing.length === 0 && revoked.length === 0
  };
}
