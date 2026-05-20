import type { Database } from '../../db/client.js';
import { twitchAccounts, twitchChannels } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { AppConfig } from '../../config/env.js';

export type DesiredEventSubSubscription = {
  type: string;
  version: string;
  condition: Record<string, string>;
};

const broadcasterOnlyTypes = [
  'channel.channel_points_custom_reward_redemption.add',
  'channel.channel_points_custom_reward_redemption.update',
  'channel.subscribe',
  'channel.subscription.end',
  'channel.subscription.message',
  'channel.subscription.gift',
  'channel.cheer',
  'stream.online',
  'stream.offline',
  'channel.update'
];

const chatTypes = [
  'channel.chat.message',
  'channel.chat.notification',
  'channel.chat.message_delete',
  'channel.chat.clear',
  'channel.chat.clear_user_messages',
  'channel.chat_settings.update'
];

export const supportedEventSubTypes = [...chatTypes, ...broadcasterOnlyTypes];
export const requiredEventSubTypes = ['channel.chat.message'];
export const optionalEventSubTypes = ['channel.chat_settings.update'];

export function eventSubCallbackUrl(config: AppConfig) {
  const base = config.TWITCH_EVENTSUB_CALLBACK_URL ?? config.PUBLIC_API_URL ?? config.PUBLIC_APP_URL;
  if (!base) throw new Error('TWITCH_EVENTSUB_CALLBACK_URL, PUBLIC_API_URL, or PUBLIC_APP_URL must be configured for EventSub webhooks');
  if (base.endsWith('/webhooks/twitch/eventsub')) return base;
  return `${base.replace(/\/$/, '')}/webhooks/twitch/eventsub`;
}

export async function getDesiredEventSubSubscriptions(db: Database, config: AppConfig): Promise<DesiredEventSubSubscription[]> {
  const [channel] = await db.select().from(twitchChannels).where(eq(twitchChannels.enabled, true)).limit(1);
  const broadcasterId = config.TWITCH_BROADCASTER_ID ?? channel?.broadcasterUserId;
  const [botAccount] = await db.select().from(twitchAccounts).where(eq(twitchAccounts.role, 'bot')).limit(1);
  const botId = config.TWITCH_BOT_USER_ID ?? botAccount?.twitchUserId;

  if (!broadcasterId) throw new Error('No broadcaster user id is configured or connected');
  const desired: DesiredEventSubSubscription[] = broadcasterOnlyTypes.map((type) => ({ type, version: '1', condition: { broadcaster_user_id: broadcasterId } }));
  if (!botId) throw new Error('No bot user id is configured or connected for chat EventSub subscriptions');
  desired.push(...chatTypes.map((type) => ({ type, version: '1', condition: { broadcaster_user_id: broadcasterId, user_id: botId } })));
  return desired;
}

export function desiredKey(subscription: Pick<DesiredEventSubSubscription, 'type' | 'version' | 'condition'>) {
  return `${subscription.type}:${subscription.version}:${JSON.stringify(sortCondition(subscription.condition))}`;
}

export function sortCondition(condition: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(condition)
      .filter(([, value]) => typeof value === 'string' && value.length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
  );
}
