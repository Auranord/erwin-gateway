import crypto from 'node:crypto';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { appWebhookEndpoints, apps, diagnosticEvents, events, twitchChannels, twitchChatMessages, twitchEventsubMessages, webhookDeliveries, webhookDeliveryAttempts } from '../../db/schema.js';
import { executeTextCommandForStoredChatMessage } from '../text-commands/service.js';

const webhookSchema = 'erwin.gateway.webhook.v1';
const maxAttempts = 5;

export function generateWebhookSecret() {
  return `ewhs_${crypto.randomBytes(32).toString('base64url')}`;
}

function asDate(value: unknown) {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function textFromMessage(message: any) {
  if (typeof message?.text === 'string') return message.text;
  if (Array.isArray(message?.fragments)) return message.fragments.map((fragment: any) => fragment?.text ?? '').join('');
  return '';
}

function parseCommand(text: string, prefix = '!') {
  if (!prefix || !text.startsWith(prefix) || text.length <= prefix.length) {
    return { isCommand: false, commandSymbol: null, commandName: null, commandArgsText: null, commandArgs: [] as string[] };
  }
  const rest = text.slice(prefix.length).trim();
  if (!rest) return { isCommand: false, commandSymbol: null, commandName: null, commandArgsText: null, commandArgs: [] as string[] };
  const [name = '', ...args] = rest.split(/\s+/);
  return { isCommand: Boolean(name), commandSymbol: prefix, commandName: name.toLowerCase(), commandArgsText: rest.slice(name.length).trim(), commandArgs: args };
}

function badgeSet(badges: any[]) {
  return new Set(badges.map((badge) => String(badge?.set_id ?? badge?.setId ?? badge?.set ?? '').toLowerCase()).filter(Boolean));
}

async function findOrCreateChannel(db: Database, event: any) {
  const broadcasterId = event.broadcaster_user_id as string | undefined;
  if (!broadcasterId) return null;
  const [existing] = await db.select().from(twitchChannels).where(eq(twitchChannels.broadcasterUserId, broadcasterId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(twitchChannels).values({ broadcasterUserId: broadcasterId, login: event.broadcaster_user_login ?? broadcasterId, displayName: event.broadcaster_user_name ?? event.broadcaster_user_login ?? broadcasterId }).returning();
  return created ?? null;
}

export async function normalizeChatMessageEvent(db: Database, params: { rawMessageId: string; rawEventsubMessageId?: string | null; payload: any }) {
  const subscription = params.payload?.subscription;
  const event = params.payload?.event;
  if (subscription?.type !== 'channel.chat.message' || !event) return null;
  const [rawRow] = params.rawEventsubMessageId
    ? await db.select().from(twitchEventsubMessages).where(eq(twitchEventsubMessages.id, params.rawEventsubMessageId)).limit(1)
    : await db.select().from(twitchEventsubMessages).where(eq(twitchEventsubMessages.messageId, params.rawMessageId)).limit(1);
  const channel = await findOrCreateChannel(db, event);
  const text = textFromMessage(event.message);
  const command = parseCommand(text, channel?.commandPrefix ?? '!');
  const badges = Array.isArray(event.badges) ? event.badges : [];
  const badgeNames = badgeSet(badges);
  const roles = {
    isBroadcaster: event.chatter_user_id === event.broadcaster_user_id || badgeNames.has('broadcaster'),
    isMod: Boolean(event.is_mod ?? event.moderator) || badgeNames.has('moderator'),
    isVip: badgeNames.has('vip'),
    isSubscriber: badgeNames.has('subscriber') || badgeNames.has('founder')
  };
  const occurredAt = asDate(event.message?.sent_at ?? event.sent_at ?? params.payload?.metadata?.message_timestamp);
  const normalized = {
    channel: { id: event.broadcaster_user_id ?? null, login: event.broadcaster_user_login ?? null, display_name: event.broadcaster_user_name ?? null },
    actor: { id: event.chatter_user_id ?? null, login: event.chatter_user_login ?? null, display_name: event.chatter_user_name ?? null, badges, color: event.color ?? null, is_broadcaster: roles.isBroadcaster, is_mod: roles.isMod, is_vip: roles.isVip, is_subscriber: roles.isSubscriber },
    chat: { message_id: event.message_id ?? params.rawMessageId, text, fragments: event.message?.fragments ?? [], is_command: command.isCommand, command_symbol: command.commandSymbol, command_name: command.commandName, command_args_text: command.commandArgsText, command_args: command.commandArgs, reply_parent_message_id: event.reply?.parent_message_id ?? null },
    twitch: { eventsub_message_id: params.rawMessageId, subscription_id: subscription?.id ?? null, subscription_type: subscription?.type ?? null, subscription_version: subscription?.version ?? null },
    raw_ref: { table: 'twitch_eventsub_messages', id: rawRow?.id ?? null }
  };
  const [eventRow] = await db.insert(events).values({ source: 'twitch_eventsub', type: 'twitch.chat.message', externalId: event.message_id ?? params.rawMessageId, channelId: channel?.id ?? null, twitchMessageId: params.rawMessageId, twitchSubscriptionId: subscription?.id ?? null, payload: normalized, status: 'processed', occurredAt, processedAt: new Date() }).onConflictDoUpdate({ target: [events.source, events.externalId], set: { payload: normalized, status: 'processed', processedAt: new Date(), updatedAt: new Date() } }).returning();
  if (!eventRow) return null;
  const [chatRow] = await db.insert(twitchChatMessages).values({ twitchMessageId: event.message_id ?? params.rawMessageId, channelId: channel?.id ?? null, chatterUserId: event.chatter_user_id ?? null, chatterLogin: event.chatter_user_login ?? null, chatterDisplayName: event.chatter_user_name ?? null, text, fragments: event.message?.fragments ?? [], badges, color: event.color ?? null, ...roles, isCommand: command.isCommand, commandSymbol: command.commandSymbol, commandName: command.commandName, commandArgsText: command.commandArgsText, commandArgs: command.commandArgs, replyParentMessageId: event.reply?.parent_message_id ?? null, rawEventId: rawRow?.id ?? null, eventId: eventRow.id }).onConflictDoNothing().returning();
  await enqueueWebhookDeliveriesForEvent(db, eventRow.id);
  if (chatRow) {
    void executeTextCommandForStoredChatMessage(db, chatRow.id).catch((error) => {
      void db.insert(diagnosticEvents).values({ severity: 'error', module: 'text-commands', message: 'Text command handling failed', details: { chatMessageId: chatRow.id, error: error instanceof Error ? error.message : String(error) } });
    });
  }
  return eventRow;
}

function matchesFilters(filters: string[], type: string) { return filters.length === 0 || filters.includes(type) || filters.includes('twitch.*') || filters.includes('*'); }
function appCanReceive(app: typeof apps.$inferSelect, type: string, payload: any) {
  if (type === 'twitch.chat.message') return payload?.chat?.is_command ? app.permissions.includes('chat:commands:receive') : app.permissions.includes('chat:messages:receive');
  if (type === 'twitch.channel_points.custom_reward_redemption.add' || type === 'twitch.channel_points.custom_reward_redemption.update') return app.permissions.includes('channel_points:events:receive') || app.permissions.includes('events:receive_twitch_events');
  if (type.startsWith('twitch.channel.subscription') || type === 'twitch.channel.subscribe') return app.permissions.includes('subscriptions:read') || app.permissions.includes('events:receive_twitch_events');
  if (type === 'twitch.channel.cheer') return app.permissions.includes('bits:read') || app.permissions.includes('events:receive_twitch_events');
  if (type === 'twitch.stream.online' || type === 'twitch.stream.offline' || type === 'twitch.channel.update') return app.permissions.includes('streams:read') || app.permissions.includes('events:receive_twitch_events');
  return app.permissions.includes('events:receive_twitch_events');
}

export async function enqueueWebhookDeliveriesForEvent(db: Database, eventId: string) {
  const [eventRow] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!eventRow) return [];
  const endpoints = await db.select({ endpoint: appWebhookEndpoints, app: apps }).from(appWebhookEndpoints).innerJoin(apps, eq(appWebhookEndpoints.appId, apps.id)).where(and(eq(appWebhookEndpoints.enabled, true), eq(apps.enabled, true)));
  const created = [];
  for (const row of endpoints) {
    if (!row.endpoint.url || !matchesFilters(row.endpoint.eventFilters, eventRow.type) || !appCanReceive(row.app, eventRow.type, eventRow.payload)) continue;
    const payload = { schema: webhookSchema, event_id: eventRow.id, type: eventRow.type, occurred_at: eventRow.occurredAt.toISOString(), received_at: eventRow.createdAt.toISOString(), ...(eventRow.payload as Record<string, unknown>) };
    const [delivery] = await db.insert(webhookDeliveries).values({ appId: row.app.id, endpointId: row.endpoint.id, eventId: eventRow.id, status: 'queued', payload }).onConflictDoNothing().returning();
    if (delivery) created.push(delivery);
  }
  await processDueWebhookDeliveries(db);
  return created;
}

function signingSecret(endpoint: typeof appWebhookEndpoints.$inferSelect) { return endpoint.signingSecret || endpoint.secretHash || 'development-unsigned-webhook-secret'; }
function signBody(secret: string, deliveryId: string, timestamp: string, body: string) { return `sha256=${crypto.createHmac('sha256', secret).update(deliveryId).update(timestamp).update(body).digest('hex')}`; }
function backoff(attempt: number) { const baseMs = Math.min(60_000, 1000 * 2 ** Math.max(0, attempt - 1)); return baseMs + crypto.randomInt(0, Math.max(100, Math.floor(baseMs * 0.25))); }

export async function deliverWebhookNow(db: Database, deliveryId: string, force = false) {
  const [row] = await db.select({ delivery: webhookDeliveries, endpoint: appWebhookEndpoints }).from(webhookDeliveries).innerJoin(appWebhookEndpoints, eq(webhookDeliveries.endpointId, appWebhookEndpoints.id)).where(eq(webhookDeliveries.id, deliveryId)).limit(1);
  if (!row) return null;
  if (!row.endpoint.url) throw new Error('Webhook endpoint URL is not configured');
  if (!force && row.delivery.status === 'delivered') return row.delivery;
  const attemptNumber = row.delivery.attempts + 1;
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({ ...(row.delivery.payload as object), delivery_id: row.delivery.id });
  const signature = signBody(signingSecret(row.endpoint), row.delivery.id, timestamp, body);
  const started = Date.now();
  let statusCode: number | null = null;
  let responseExcerpt: string | null = null;
  let error: string | null = null;
  await db.update(webhookDeliveries).set({ status: 'sending' }).where(eq(webhookDeliveries.id, row.delivery.id));
  try {
    const response = await fetch(row.endpoint.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'erwin-gateway/0.1.0', 'X-Erwin-Gateway-Delivery-Id': row.delivery.id, 'X-Erwin-Gateway-Event-Id': row.delivery.eventId, 'X-Erwin-Gateway-Timestamp': timestamp, 'X-Erwin-Gateway-Signature': signature, 'X-Erwin-Gateway-App-Id': row.delivery.appId }, body });
    statusCode = response.status;
    responseExcerpt = (await response.text()).slice(0, 1000);
    if (!response.ok) error = `HTTP ${response.status}`;
  } catch (caught) { error = caught instanceof Error ? caught.message : 'unknown webhook delivery error'; }
  const durationMs = Date.now() - started;
  await db.insert(webhookDeliveryAttempts).values({ deliveryId: row.delivery.id, attemptNumber, statusCode, durationMs, responseExcerpt, error });
  const now = new Date();
  if (!error) {
    const [updated] = await db.update(webhookDeliveries).set({ status: 'delivered', attempts: attemptNumber, deliveredAt: now, lastError: null }).where(eq(webhookDeliveries.id, row.delivery.id)).returning();
    await db.update(appWebhookEndpoints).set({ lastDeliveryAt: now, updatedAt: now }).where(eq(appWebhookEndpoints.id, row.endpoint.id));
    return updated ?? null;
  }
  const terminal = attemptNumber >= maxAttempts;
  const [updated] = await db.update(webhookDeliveries).set({ status: terminal ? 'dead_lettered' : 'retrying', attempts: attemptNumber, nextAttemptAt: new Date(now.getTime() + backoff(attemptNumber)), lastError: error }).where(eq(webhookDeliveries.id, row.delivery.id)).returning();
  return updated ?? null;
}

export async function processDueWebhookDeliveries(db: Database, limit = 10) {
  const due = await db.select().from(webhookDeliveries).where(and(inArray(webhookDeliveries.status, ['queued', 'retrying', 'failed']), lte(webhookDeliveries.nextAttemptAt, new Date()))).orderBy(webhookDeliveries.nextAttemptAt).limit(limit);
  for (const delivery of due) await deliverWebhookNow(db, delivery.id);
  return due.length;
}

export function startWebhookDeliveryWorker(app: { log: { error: (obj: unknown, msg?: string) => void } }, db?: Database) {
  if (!db) return;
  const timer = setInterval(() => { processDueWebhookDeliveries(db).catch((error) => app.log.error({ error }, 'Webhook delivery worker failed')); }, 15_000);
  timer.unref?.();
}

export async function listEvents(db: Database, query: { type?: string; limit?: number }) { return db.select().from(events).where(query.type ? eq(events.type, query.type) : undefined).orderBy(desc(events.occurredAt)).limit(Math.min(query.limit ?? 50, 200)); }
export async function getEvent(db: Database, id: string) { const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1); return row ?? null; }
export async function listChatLog(db: Database, query: { q?: string; command?: string; limit?: number }) {
  const clauses = [];
  if (query.q) clauses.push(sql`${twitchChatMessages.text} ILIKE ${`%${query.q}%`}`);
  if (query.command) clauses.push(eq(twitchChatMessages.commandName, query.command.toLowerCase()));
  return db.select().from(twitchChatMessages).where(clauses.length ? and(...clauses) : undefined).orderBy(desc(twitchChatMessages.createdAt)).limit(Math.min(query.limit ?? 100, 500));
}
export async function listWebhookDeliveries(db: Database, query: { status?: string; limit?: number; appId?: string }) {
  const clauses = [];
  if (query.status) clauses.push(eq(webhookDeliveries.status, query.status));
  if (query.appId) clauses.push(eq(webhookDeliveries.appId, query.appId));

  return db
    .select()
    .from(webhookDeliveries)
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(Math.min(query.limit ?? 100, 500));
}
export async function getWebhookDeliveryWithAttempts(db: Database, id: string) {
  const [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).limit(1);
  if (!delivery) return null;
  const attempts = await db.select().from(webhookDeliveryAttempts).where(eq(webhookDeliveryAttempts.deliveryId, id)).orderBy(desc(webhookDeliveryAttempts.createdAt));
  return { delivery, attempts };
}
