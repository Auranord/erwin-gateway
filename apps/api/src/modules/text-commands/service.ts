import crypto from 'node:crypto';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { apps, textCommandInvocations, textCommands, twitchChatMessages, twitchChannels } from '../../db/schema.js';
import { createOutgoingChatMessage } from '../twitch-chat/service.js';

export const textCommandRoles = ['everyone', 'subscriber', 'vip', 'moderator', 'broadcaster'] as const;
export const textCommandReplyModes = ['message', 'reply'] as const;
export const textCommandInvocationStatuses = ['sent', 'skipped_cooldown', 'skipped_role', 'disabled', 'failed'] as const;

type TextCommandRole = (typeof textCommandRoles)[number];
type TextCommandReplyMode = (typeof textCommandReplyModes)[number];
type TextCommand = typeof textCommands.$inferSelect;

type ChatActor = {
  userId?: string | null;
  userLogin?: string | null;
  displayName?: string | null;
  isBroadcaster?: boolean;
  isMod?: boolean;
  isVip?: boolean;
  isSubscriber?: boolean;
};

type ExecuteInput = {
  channelId: string | null;
  twitchMessageId?: string | null;
  text: string;
  replyParentMessageId?: string | null;
  actor: ChatActor;
  channelLogin?: string | null;
  channelDisplayName?: string | null;
  bypassCooldown?: boolean;
};

type UpsertInput = {
  channelId?: string | null;
  command: string;
  aliases?: string[];
  responseText: string;
  enabled?: boolean;
  requiredRole?: TextCommandRole;
  cooldownSeconds?: number;
  userCooldownSeconds?: number;
  replyMode?: TextCommandReplyMode;
};

function normalizeName(value: string, commandPrefix = '!') {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith(commandPrefix) ? trimmed.slice(commandPrefix.length).trim() : trimmed;
}

function normalizeCommandPrefix(value?: string | null) {
  const prefix = (value ?? '!').trim();
  return prefix || '!';
}

function normalizeAliases(aliases: string[] | undefined, commandPrefix: string, command: string) {
  return [...new Set((aliases ?? []).map((alias) => normalizeName(alias, commandPrefix)).filter((alias) => alias && alias !== command))];
}

export function validateTextCommandInput(input: { command?: string; aliases?: string[]; commandPrefix?: string | null; responseText?: string; requiredRole?: string; replyMode?: string; cooldownSeconds?: number; userCooldownSeconds?: number }) {
  const commandPrefix = normalizeCommandPrefix(input.commandPrefix);
  const command = input.command ? normalizeName(input.command, commandPrefix) : '';
  const issues: string[] = [];
  if (!command || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(command)) issues.push('command must be 1-64 characters and contain only letters, numbers, underscores, or dashes');
  if (input.responseText === undefined || !input.responseText.trim()) issues.push('responseText is required');
  if (input.responseText && input.responseText.length > 500) issues.push('responseText must be 500 characters or fewer');
  if (input.requiredRole && !(textCommandRoles as readonly string[]).includes(input.requiredRole)) issues.push('requiredRole is invalid');
  if (input.replyMode && !(textCommandReplyModes as readonly string[]).includes(input.replyMode)) issues.push('replyMode is invalid');
  for (const field of ['cooldownSeconds', 'userCooldownSeconds'] as const) {
    const value = input[field];
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 86_400)) issues.push(`${field} must be an integer from 0 to 86400`);
  }
  const aliases = normalizeAliases(input.aliases, commandPrefix, command);
  if (aliases.some((alias) => !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(alias))) issues.push('aliases must contain only letters, numbers, underscores, or dashes');
  return { issues, normalized: { command, aliases } };
}

function serializeCommand(row: TextCommand) {
  return {
    id: row.id,
    channelId: row.channelId,
    command: row.command,
    aliases: row.aliases,
    responseText: row.responseText,
    enabled: row.enabled,
    requiredRole: row.requiredRole,
    cooldownSeconds: row.cooldownSeconds,
    userCooldownSeconds: row.userCooldownSeconds,
    replyMode: row.replyMode,
    usageCount: row.usageCount,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null
  };
}

export async function listTextCommands(db: Database) {
  const rows = await db.select().from(textCommands).where(isNull(textCommands.archivedAt)).orderBy(textCommands.command);
  return rows.map(serializeCommand);
}

export async function getTextCommand(db: Database, id: string) {
  const [row] = await db.select().from(textCommands).where(and(eq(textCommands.id, id), isNull(textCommands.archivedAt))).limit(1);
  return row ? serializeCommand(row) : null;
}

export async function createTextCommand(db: Database, input: UpsertInput) {
  const { issues, normalized } = validateTextCommandInput(input);
  if (issues.length) return { ok: false as const, statusCode: 400, error: 'Invalid text command', issues };
  const [row] = await db.insert(textCommands).values({
    channelId: input.channelId ?? null,
    command: normalized.command,
    aliases: normalized.aliases,
    responseText: input.responseText.trim(),
    enabled: input.enabled ?? true,
    requiredRole: input.requiredRole ?? 'everyone',
    cooldownSeconds: input.cooldownSeconds ?? 0,
    userCooldownSeconds: input.userCooldownSeconds ?? 0,
    replyMode: input.replyMode ?? 'message'
  }).returning();
  return { ok: true as const, command: serializeCommand(row!) };
}

export async function updateTextCommand(db: Database, id: string, input: Partial<UpsertInput>) {
  const [existing] = await db.select().from(textCommands).where(and(eq(textCommands.id, id), isNull(textCommands.archivedAt))).limit(1);
  if (!existing) return { ok: false as const, statusCode: 404, error: 'Text command not found' };
  const merged = { ...existing, ...input, responseText: input.responseText ?? existing.responseText, command: input.command ?? existing.command, aliases: input.aliases ?? existing.aliases };
  const { issues, normalized } = validateTextCommandInput(merged);
  if (issues.length) return { ok: false as const, statusCode: 400, error: 'Invalid text command', issues };
  const [row] = await db.update(textCommands).set({
    channelId: input.channelId === undefined ? existing.channelId : input.channelId,
    command: normalized.command,
    aliases: normalized.aliases,
    responseText: (input.responseText ?? existing.responseText).trim(),
    enabled: input.enabled ?? existing.enabled,
    requiredRole: input.requiredRole ?? existing.requiredRole,
    cooldownSeconds: input.cooldownSeconds ?? existing.cooldownSeconds,
    userCooldownSeconds: input.userCooldownSeconds ?? existing.userCooldownSeconds,
    replyMode: input.replyMode ?? existing.replyMode,
    updatedAt: new Date()
  }).where(eq(textCommands.id, id)).returning();
  return { ok: true as const, command: serializeCommand(row!) };
}

export async function archiveTextCommand(db: Database, id: string) {
  const [row] = await db.update(textCommands).set({ archivedAt: new Date(), updatedAt: new Date(), enabled: false }).where(and(eq(textCommands.id, id), isNull(textCommands.archivedAt))).returning();
  return row ? serializeCommand(row) : null;
}

async function gatewayApp(db: Database) {
  const [existing] = await db.select().from(apps).where(eq(apps.slug, 'erwin-gateway')).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(apps).values({ name: 'erwin-gateway', slug: 'erwin-gateway', enabled: true, description: 'Internal source for gateway-owned text command replies', permissions: ['chat:messages:send'] }).onConflictDoUpdate({ target: apps.slug, set: { enabled: true, updatedAt: new Date() } }).returning();
  return created!;
}

async function commandPrefixForChannel(db: Database, channelId: string | null) {
  const [channel] = channelId
    ? await db.select({ commandPrefix: twitchChannels.commandPrefix }).from(twitchChannels).where(eq(twitchChannels.id, channelId)).limit(1)
    : await db.select({ commandPrefix: twitchChannels.commandPrefix }).from(twitchChannels).where(eq(twitchChannels.primaryChannel, true)).limit(1);
  return normalizeCommandPrefix(channel?.commandPrefix);
}

async function findMatchingCommand(db: Database, input: ExecuteInput) {
  const rows = await db.select().from(textCommands).where(and(isNull(textCommands.archivedAt), input.channelId ? or(eq(textCommands.channelId, input.channelId), isNull(textCommands.channelId)) : isNull(textCommands.channelId)));
  const text = input.text.trim();
  const commandPrefix = await commandPrefixForChannel(db, input.channelId);
  if (!text.startsWith(commandPrefix) || text.length <= commandPrefix.length) return null;
  const [name = ''] = text.slice(commandPrefix.length).trim().split(/\s+/);
  const normalized = name.toLowerCase();
  const ordered = rows.sort((left, right) => Number(right.channelId === input.channelId) - Number(left.channelId === input.channelId));
  return ordered.find((row) => normalized === row.command || row.aliases.map((alias) => alias.toLowerCase()).includes(normalized)) ?? null;
}

function hasRole(command: TextCommand, actor: ChatActor) {
  const role = command.requiredRole as TextCommandRole;
  if (role === 'everyone') return true;
  if (actor.isBroadcaster) return true;
  if (role === 'broadcaster') return Boolean(actor.isBroadcaster);
  if (role === 'moderator') return Boolean(actor.isMod);
  if (role === 'vip') return Boolean(actor.isVip);
  if (role === 'subscriber') return Boolean(actor.isSubscriber);
  return false;
}

async function cooldownDropReason(db: Database, command: TextCommand, input: ExecuteInput, now: Date) {
  if (command.cooldownSeconds > 0) {
    const [lastGlobal] = await db.select().from(textCommandInvocations).where(and(eq(textCommandInvocations.textCommandId, command.id), eq(textCommandInvocations.status, 'sent'))).orderBy(desc(textCommandInvocations.createdAt)).limit(1);
    if (lastGlobal && now.getTime() - lastGlobal.createdAt.getTime() < command.cooldownSeconds * 1000) return 'global_cooldown';
  }
  if (command.userCooldownSeconds > 0 && input.actor.userId) {
    const [lastUser] = await db.select().from(textCommandInvocations).where(and(eq(textCommandInvocations.textCommandId, command.id), eq(textCommandInvocations.userId, input.actor.userId), eq(textCommandInvocations.status, 'sent'))).orderBy(desc(textCommandInvocations.createdAt)).limit(1);
    if (lastUser && now.getTime() - lastUser.createdAt.getTime() < command.userCooldownSeconds * 1000) return 'user_cooldown';
  }
  return null;
}

function applyPlaceholders(responseText: string, input: ExecuteInput) {
  const replacements: Record<string, string> = {
    user: input.actor.userLogin ?? input.actor.displayName ?? 'viewer',
    displayName: input.actor.displayName ?? input.actor.userLogin ?? 'viewer',
    channel: input.channelDisplayName ?? input.channelLogin ?? 'channel'
  };
  return responseText.replace(/\{(user|displayName|channel)\}/g, (_match, key: string) => replacements[key] ?? '');
}

async function recordInvocation(db: Database, command: TextCommand, input: ExecuteInput, status: string, dropReason?: string | null, queuedChatMessageId?: string | null) {
  const [invocation] = await db.insert(textCommandInvocations).values({
    textCommandId: command.id,
    twitchMessageId: input.twitchMessageId ?? null,
    channelId: input.channelId,
    userId: input.actor.userId ?? null,
    userLogin: input.actor.userLogin ?? null,
    status,
    dropReason: dropReason ?? null,
    queuedChatMessageId: queuedChatMessageId ?? null
  }).returning();
  return invocation;
}

export async function executeTextCommandForChat(db: Database, input: ExecuteInput) {
  const command = await findMatchingCommand(db, input);
  if (!command) return { matched: false as const };
  if (!command.enabled) {
    await recordInvocation(db, command, input, 'disabled', 'command_disabled');
    return { matched: true as const, status: 'disabled' };
  }
  if (!hasRole(command, input.actor)) {
    await recordInvocation(db, command, input, 'skipped_role', `required_${command.requiredRole}`);
    return { matched: true as const, status: 'skipped_role' };
  }
  const now = new Date();
  const dropReason = input.bypassCooldown ? null : await cooldownDropReason(db, command, input, now);
  if (dropReason) {
    await recordInvocation(db, command, input, 'skipped_cooldown', dropReason);
    return { matched: true as const, status: 'skipped_cooldown', dropReason };
  }

  try {
    const app = await gatewayApp(db);
    const result = await createOutgoingChatMessage(db, { id: app.id, permissions: app.permissions }, {
      channel_id: input.channelId ?? undefined,
      message: applyPlaceholders(command.responseText, input),
      reply_parent_message_id: command.replyMode === 'reply' ? (input.twitchMessageId ?? input.replyParentMessageId ?? null) : null,
      for_source_only: false,
      priority: 10,
      idempotency_key: `text-command:${command.id}:${input.twitchMessageId ?? crypto.randomUUID()}`
    });
    if (!result.ok || !result.message) {
      await recordInvocation(db, command, input, 'failed', result.ok ? 'queue_failed' : result.error);
      return { matched: true as const, status: 'failed', error: result.ok ? 'queue_failed' : result.error };
    }
    await db.update(textCommands).set({ usageCount: sql`${textCommands.usageCount} + 1`, lastUsedAt: now, updatedAt: now }).where(eq(textCommands.id, command.id));
    const invocation = await recordInvocation(db, command, input, 'sent', null, result.message.id);
    return { matched: true as const, status: 'sent', command: serializeCommand(command), invocation, queuedMessage: result.message };
  } catch (error) {
    await recordInvocation(db, command, input, 'failed', error instanceof Error ? error.message : 'unknown error');
    return { matched: true as const, status: 'failed', error: error instanceof Error ? error.message : 'unknown error' };
  }
}

export async function executeTextCommandForStoredChatMessage(db: Database, chatMessageId: string) {
  const [row] = await db.select({ message: twitchChatMessages, channel: twitchChannels }).from(twitchChatMessages).leftJoin(twitchChannels, eq(twitchChatMessages.channelId, twitchChannels.id)).where(eq(twitchChatMessages.id, chatMessageId)).limit(1);
  if (!row) return null;
  return executeTextCommandForChat(db, {
    channelId: row.message.channelId,
    twitchMessageId: row.message.twitchMessageId,
    text: row.message.text,
    replyParentMessageId: row.message.replyParentMessageId,
    actor: { userId: row.message.chatterUserId, userLogin: row.message.chatterLogin, displayName: row.message.chatterDisplayName, isBroadcaster: row.message.isBroadcaster, isMod: row.message.isMod, isVip: row.message.isVip, isSubscriber: row.message.isSubscriber },
    channelLogin: row.channel?.login,
    channelDisplayName: row.channel?.displayName
  });
}

export async function testTextCommand(db: Database, id: string, input: { user?: string; displayName?: string; channel?: string } = {}) {
  const [command] = await db.select().from(textCommands).where(and(eq(textCommands.id, id), isNull(textCommands.archivedAt))).limit(1);
  if (!command) return { ok: false as const, statusCode: 404, error: 'Text command not found' };
  const [channel] = command.channelId
    ? await db.select().from(twitchChannels).where(eq(twitchChannels.id, command.channelId)).limit(1)
    : await db.select().from(twitchChannels).where(eq(twitchChannels.primaryChannel, true)).limit(1);
  if (!channel) return { ok: false as const, statusCode: 400, error: 'No Twitch channel is configured for test send' };
  const result = await executeTextCommandForChat(db, {
    channelId: channel.id,
    twitchMessageId: `admin-test-${crypto.randomUUID()}`,
    text: `${channel.commandPrefix}${command.command}`,
    actor: { userId: 'admin-test', userLogin: input.user ?? 'admin', displayName: input.displayName ?? 'Admin', isBroadcaster: true, isMod: true, isVip: true, isSubscriber: true },
    channelLogin: input.channel ?? channel.login,
    channelDisplayName: input.channel ?? channel.displayName ?? channel.login,
    bypassCooldown: true
  });
  return { ok: true as const, result };
}

export async function listTextCommandInvocations(db: Database, textCommandId: string, limit = 25) {
  return db.select().from(textCommandInvocations).where(eq(textCommandInvocations.textCommandId, textCommandId)).orderBy(desc(textCommandInvocations.createdAt)).limit(Math.min(limit, 100));
}
