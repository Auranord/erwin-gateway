import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { gatewayName } from '@erwin-gateway/shared';
import './styles.css';

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type Webhook = {
  url: string;
  enabled: boolean;
  eventFilters: string[];
  lastDeliveryAt: string | null;
  signingSecretConfigured: boolean;
};


type TwitchAccountStatus = {
  role: 'bot' | 'broadcaster';
  connected: boolean;
  login: string | null;
  twitchUserId: string | null;
  grantedScopes: string[];
  requiredScopes: string[];
  missingScopes: string[];
  expiresAt: string | null;
  tokenExpired: boolean;
  tokenValid: boolean;
  validationError: string | null;
  lastRefreshError: string | null;
};

type EventSubStatus = {
  callbackUrl: string | null;
  lastDelivery: { messageId: string; messageType: string; eventType: string | null; receivedAt: string; duplicate: boolean } | null;
  subscriptions: Array<{ id: string; twitchSubscriptionId: string | null; type: string; version: string; status: string; revokedAt: string | null; revokeReason: string | null; lastSyncedAt: string | null }>;
  missingSubscriptions: Array<{ type: string; version: string; condition: Record<string, string> }>;
  revokedSubscriptions: Array<{ type: string; status: string; revokeReason: string | null; twitchSubscriptionId: string | null }>;
  duplicateCount: number;
  desiredError: string | null;
  healthy: boolean;
};

type TwitchSetupStatus = {
  status: 'healthy' | 'degraded';
  appToken: { configured: boolean; valid: boolean; expiresAt: string | null; error: string | null };
  bot: TwitchAccountStatus;
  broadcaster: TwitchAccountStatus;
  degradedReasons: string[];
};

type ChatMessage = { id: string; chatterLogin: string | null; chatterDisplayName: string | null; text: string; isCommand: boolean; commandSymbol: string | null; commandName: string | null; isBroadcaster: boolean; isMod: boolean; isVip: boolean; isSubscriber: boolean; createdAt: string; };

type WebhookDelivery = { id: string; appId: string; endpointId: string; eventId: string; status: string; attempts: number; nextAttemptAt: string; lastError: string | null; deliveredAt: string | null; createdAt: string; };

type TextCommand = { id: string; channelId: string | null; command: string; aliases: string[]; responseText: string; enabled: boolean; requiredRole: string; cooldownSeconds: number; userCooldownSeconds: number; replyMode: string; usageCount: number; lastUsedAt: string | null; createdAt: string; updatedAt: string; archivedAt: string | null; };

type ChannelPointReward = { id: string; twitchRewardId: string; owningAppId: string | null; title: string; cost: number; enabled: boolean; manageable: boolean; deletedAt: string | null; lastSyncedAt: string | null; };
type ChannelPointRedemption = { id: string; twitchRedemptionId: string; rewardId: string | null; twitchRewardId: string; userLogin: string | null; userDisplayName: string | null; status: string; userInput: string | null; redeemedAt: string; eventId: string | null; };
type ChannelPointDiagnostics = { missingChannelManageRedemptions?: boolean; lastRewardSync?: unknown; lastRedemptionEvent?: unknown; rewardsMissingOnTwitch?: number; twitchRewardsMissingOwnershipMapping?: number; notes?: string[] };
type ChannelPointRewardSyncRun = { rewardsSeen: number; rewardsCreated: number; rewardsUpdated: number; rewardsMissingOnTwitch: number; completedAt: string | null; };

type OutgoingMessage = { id: string; sourceAppId: string; channelId: string; message: string; replyParentMessageId: string | null; priority: number; status: string; idempotencyKey: string; twitchMessageId: string | null; twitchIsSent: boolean | null; twitchDropReason: unknown; responseCode: number | null; responseBodyExcerpt: string | null; attempts: number; nextAttemptAt: string; lastError: string | null; createdAt: string; sentAt: string | null; failedAt: string | null; };

type RegisteredApp = {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  description: string | null;
  permissions: string[];
  archivedAt: string | null;
  apiKeys: ApiKey[];
  webhook: Webhook;
};

type AppEditForm = {
  name: string;
  slug: string;
  description: string;
  permissions: string[];
  webhookUrl: string;
  webhookEventFilters: string;
};

type AdminAuthStatus = 'unknown' | 'locked' | 'validating' | 'authenticated';

const pages = [
  'Dashboard',
  'Twitch Setup',
  'Apps',
  'Text Commands',
  'Chat Log',
  'Outgoing Messages',
  'Webhook Deliveries',
  'Channel Points',
  'Diagnostics',
  'Docs'
];

const fallbackPermissions = [
  'chat:messages:send',
  'chat:messages:receive',
  'chat:commands:receive',
  'events:receive_twitch_events',
  'events:read',
  'logs:read_own',
  'logs:read_all',
  'channel_points:rewards:read',
  'channel_points:rewards:create',
  'channel_points:rewards:update',
  'channel_points:rewards:delete',
  'channel_points:redemptions:read',
  'channel_points:redemptions:manage',
  'channel_points:events:receive',
  'subscriptions:read',
  'subscriptions:backfill',
  'bits:read',
  'bits:backfill',
  'streams:read',
  'admin:apps',
  'admin:twitch'
];

function splitCsv(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function appToEditForm(app: RegisteredApp): AppEditForm {
  return {
    name: app.name,
    slug: app.slug,
    description: app.description ?? '',
    permissions: app.permissions,
    webhookUrl: app.webhook.url,
    webhookEventFilters: app.webhook.eventFilters.join(',')
  };
}

function App() {
  const [apps, setApps] = useState<RegisteredApp[]>([]);
  const [permissions, setPermissions] = useState<string[]>(fallbackPermissions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [twitchStatus, setTwitchStatus] = useState<TwitchSetupStatus | null>(null);
  const [eventSubStatus, setEventSubStatus] = useState<EventSubStatus | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSearch, setChatSearch] = useState('');
  const [chatLimit, setChatLimit] = useState(50);
  const [chatLogLoaded, setChatLogLoaded] = useState(false);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>([]);
  const [outgoingMessages, setOutgoingMessages] = useState<OutgoingMessage[]>([]);
  const [outgoingStatus, setOutgoingStatus] = useState('');
  const [outgoingLimit, setOutgoingLimit] = useState(100);
  const [outgoingLoaded, setOutgoingLoaded] = useState(false);
  const [textCommands, setTextCommands] = useState<TextCommand[]>([]);
  const [configuredPrefix, setConfiguredPrefix] = useState('!');
  const [prefixForm, setPrefixForm] = useState('!');
  const [channelPointRewards, setChannelPointRewards] = useState<ChannelPointReward[]>([]);
  const [showDeletedChannelPointRewards, setShowDeletedChannelPointRewards] = useState(false);
  const [channelPointRedemptions, setChannelPointRedemptions] = useState<ChannelPointRedemption[]>([]);
  const [channelPointDiagnostics, setChannelPointDiagnostics] = useState<ChannelPointDiagnostics | null>(null);
  const [channelPointRewardSyncRun, setChannelPointRewardSyncRun] = useState<ChannelPointRewardSyncRun | null>(null);
  const [rewardForm, setRewardForm] = useState({ title: '', cost: '', prompt: '', owning_app_id: '', is_enabled: true });
  const [commandForm, setCommandForm] = useState({ command: '', aliases: '', responseText: '', enabled: true, requiredRole: 'everyone', cooldownSeconds: 30, userCooldownSeconds: 120, replyMode: 'message' });
  const [twitchLoading, setTwitchLoading] = useState(false);
  const [adminKey, setAdminKey] = useState(() => window.localStorage.getItem('erwinGatewayAdminKey') ?? '');
  const [adminAuthStatus, setAdminAuthStatus] = useState<AdminAuthStatus>('unknown');
  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    permissions: '',
    webhookUrl: '',
    webhookEventFilters: ''
  });
  const [appEditForms, setAppEditForms] = useState<Record<string, AppEditForm>>({});

  const activeApps = useMemo(() => apps.filter((app) => app.enabled).length, [apps]);

  function adminHeaders(extraHeaders: Record<string, string> = {}) {
    return adminKey ? { ...extraHeaders, 'X-Admin-API-Key': adminKey } : extraHeaders;
  }

  function saveAdminKey(value: string) {
    setAdminKey(value);
    setAdminAuthStatus('locked');
    if (value) {
      window.localStorage.setItem('erwinGatewayAdminKey', value);
    } else {
      window.localStorage.removeItem('erwinGatewayAdminKey');
    }
  }

  async function validateAdminKey() {
    if (!adminKey.trim()) {
      setAdminAuthStatus('locked');
      setError('Enter an Admin API key before loading operations.');
      setLoading(false);
      return;
    }

    setAdminAuthStatus('validating');
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/admin/shell', { headers: adminHeaders() });
      if (!response.ok) throw new Error(`Admin API key validation failed with ${response.status}`);
      setAdminAuthStatus('authenticated');
    } catch (validationError) {
      setAdminAuthStatus('locked');
      setError(validationError instanceof Error ? validationError.message : 'Admin API key validation failed');
      setLoading(false);
    }
  }

  async function loadTwitchStatus() {
    setTwitchLoading(true);
    try {
      const response = await fetch('/api/admin/twitch/setup/status', { headers: adminHeaders() });
      if (!response.ok) throw new Error(`Twitch status API returned ${response.status}`);
      setTwitchStatus(await response.json());
      const eventSubResponse = await fetch('/api/admin/twitch/eventsub/status', { headers: adminHeaders() });
      if (eventSubResponse.ok) setEventSubStatus(await eventSubResponse.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load Twitch setup');
    } finally {
      setTwitchLoading(false);
    }
  }

  async function loadApps() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/apps', { headers: adminHeaders() });
      if (!response.ok) throw new Error(`Admin apps API returned ${response.status}`);
      const payload = await response.json();
      setApps(payload.apps ?? []);
      setPermissions(payload.permissions ?? fallbackPermissions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load apps');
    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    if (adminKey) {
      void validateAdminKey();
    } else {
      setAdminAuthStatus('locked');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminAuthStatus !== 'authenticated') return;

    void loadApps();
    void loadTwitchStatus();
    void loadWebhookDeliveries().catch((loadError) => setError(String(loadError)));
    void loadTextCommands().catch((loadError) => setError(String(loadError)));
    void loadCommandPrefix().catch((loadError) => setError(String(loadError)));
    void loadChannelPoints().catch((loadError) => setError(String(loadError)));
  }, [adminAuthStatus]);

  async function loadChatLog(search = chatSearch, limit = chatLimit) {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 50;
    setChatLimit(normalizedLimit);
    const params = new URLSearchParams({ limit: String(normalizedLimit) });
    if (search) params.set('q', search);
    const response = await fetch(`/api/admin/chat/log?${params}`, { headers: adminHeaders() });
    if (!response.ok) throw new Error(`Chat log API returned ${response.status}`);
    const payload = await response.json();
    setChatMessages(payload.messages ?? []);
    setChatLogLoaded(true);
  }

  async function loadWebhookDeliveries() {
    const response = await fetch('/api/admin/webhook-deliveries?limit=100', { headers: adminHeaders() });
    if (!response.ok) throw new Error(`Webhook deliveries API returned ${response.status}`);
    const payload = await response.json();
    setWebhookDeliveries(payload.deliveries ?? []);
  }


  async function loadCommandPrefix() {
    const response = await fetch('/api/admin/twitch/primary-channel/command-prefix', { headers: adminHeaders() });
    if (response.status === 404) {
      setConfiguredPrefix('!');
      setPrefixForm('!');
      return;
    }
    if (!response.ok) throw new Error(`Command prefix API returned ${response.status}`);
    const payload = await response.json();
    const nextPrefix = payload.commandPrefix ?? '!';
    setConfiguredPrefix(nextPrefix);
    setPrefixForm(nextPrefix);
  }

  async function updateCommandPrefix() {
    const response = await fetch('/api/admin/twitch/primary-channel/command-prefix', {
      method: 'PATCH',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ commandPrefix: prefixForm })
    });
    if (!response.ok) throw new Error(`Update command prefix failed with ${response.status}`);
    await loadCommandPrefix();
    await loadTextCommands();
  }

  async function loadTextCommands() {
    const response = await fetch('/api/admin/text-commands', { headers: adminHeaders() });
    if (!response.ok) throw new Error(`Text commands API returned ${response.status}`);
    const payload = await response.json();
    setTextCommands(payload.commands ?? []);
  }

  async function loadChannelPoints(includeDeleted = showDeletedChannelPointRewards) {
    const params = new URLSearchParams();
    if (includeDeleted) params.set('includeDeleted', 'true');
    const queryString = params.toString();
    const response = await fetch(`/api/admin/channel-points${queryString ? `?${queryString}` : ''}`, { headers: adminHeaders() });
    if (!response.ok) throw new Error(`Channel Points API returned ${response.status}`);
    const payload = await response.json();
    setChannelPointRewards(payload.rewards ?? []);
    setChannelPointRedemptions(payload.redemptions ?? []);
    setChannelPointDiagnostics(payload.diagnostics ?? null);
  }

  async function syncChannelPoints() {
    const response = await fetch('/api/admin/channel-points/rewards/sync', { method: 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({}) });
    if (!response.ok) throw new Error(`Channel Points sync failed with ${response.status}`);
    const payload = await response.json();
    setChannelPointRewardSyncRun(payload.run ?? null);
    setShowDeletedChannelPointRewards(false);
    await loadChannelPoints(false);
  }

  async function createChannelPointReward() {
    const cost = Number(rewardForm.cost);
    if (!rewardForm.title.trim()) throw new Error('Reward title is required');
    if (!Number.isFinite(cost) || cost < 1) throw new Error('Reward cost must be at least 1');
    if (!rewardForm.owning_app_id) throw new Error('Reward owning app is required');

    const response = await fetch('/api/admin/channel-points/rewards', {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        title: rewardForm.title.trim(),
        cost,
        prompt: rewardForm.prompt.trim(),
        owning_app_id: rewardForm.owning_app_id,
        is_enabled: rewardForm.is_enabled
      })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(`Create reward failed with ${response.status}${payload?.error ? `: ${payload.error}` : ''}`);
    }
    await loadChannelPoints();
  }

  async function updateChannelPointReward(reward: ChannelPointReward, patch: Record<string, unknown>) {
    const response = await fetch(`/api/admin/channel-points/rewards/${reward.id}`, { method: 'PATCH', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(patch) });
    if (!response.ok) throw new Error(`Update reward failed with ${response.status}`);
    await loadChannelPoints();
  }

  async function deleteChannelPointReward(reward: ChannelPointReward) {
    const response = await fetch(`/api/admin/channel-points/rewards/${reward.id}`, { method: 'DELETE', headers: adminHeaders() });
    if (!response.ok) throw new Error(`Delete reward failed with ${response.status}`);
    await loadChannelPoints();
  }

  async function loadOutgoingMessages(status = outgoingStatus, limit = outgoingLimit) {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 100;
    setOutgoingLimit(normalizedLimit);
    const params = new URLSearchParams({ limit: String(normalizedLimit) });
    if (status) params.set('status', status);
    const response = await fetch(`/api/admin/outgoing-chat/messages?${params}`, { headers: adminHeaders() });
    if (!response.ok) throw new Error(`Outgoing messages API returned ${response.status}`);
    const payload = await response.json();
    setOutgoingMessages(payload.messages ?? []);
    setOutgoingLoaded(true);
  }

  async function retryWebhookDelivery(deliveryId: string) {
    const response = await fetch(`/api/admin/webhook-deliveries/${deliveryId}/retry`, { method: 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({}) });
    if (!response.ok) throw new Error(`Retry delivery failed with ${response.status}`);
    await loadWebhookDeliveries();
  }

  async function retryOutgoingMessage(messageId: string) {
    const response = await fetch(`/api/admin/outgoing-chat/messages/${messageId}/retry`, { method: 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({}) });
    if (!response.ok) throw new Error(`Retry outgoing message failed with ${response.status}`);
    if (outgoingLoaded) await loadOutgoingMessages();
  }

  async function createTextCommand() {
    if (!commandForm.command.trim()) throw new Error('Command name is required');
    if (!commandForm.responseText.trim()) throw new Error('Response text is required');

    const response = await fetch('/api/admin/text-commands', {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        command: commandForm.command.trim(),
        aliases: splitCsv(commandForm.aliases),
        responseText: commandForm.responseText.trim(),
        enabled: commandForm.enabled,
        requiredRole: commandForm.requiredRole,
        cooldownSeconds: Number(commandForm.cooldownSeconds),
        userCooldownSeconds: Number(commandForm.userCooldownSeconds),
        replyMode: commandForm.replyMode
      })
    });
    if (!response.ok) throw new Error(`Create text command failed with ${response.status}`);
    await loadTextCommands();
  }

  async function updateTextCommand(command: TextCommand, patch: Partial<TextCommand>) {
    const response = await fetch(`/api/admin/text-commands/${command.id}`, {
      method: 'PATCH',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(patch)
    });
    if (!response.ok) throw new Error(`Update text command failed with ${response.status}`);
    await loadTextCommands();
  }

  async function deleteTextCommand(command: TextCommand) {
    if (!window.confirm(`Delete text command ${configuredPrefix}${command.command}?`)) return;
    const response = await fetch(`/api/admin/text-commands/${command.id}`, { method: 'DELETE', headers: adminHeaders() });
    if (!response.ok) throw new Error(`Delete text command failed with ${response.status}`);
    await loadTextCommands();
  }

  async function testTextCommand(command: TextCommand) {
    const response = await fetch(`/api/admin/text-commands/${command.id}/test`, { method: 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ user: 'admin', displayName: 'Admin' }) });
    if (!response.ok) throw new Error(`Test text command failed with ${response.status}`);
    await loadTextCommands();
    await loadOutgoingMessages();
  }

  async function rotateWebhookSecret(appId: string) {
    const response = await fetch(`/api/admin/apps/${appId}/webhook-secret`, { method: 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({}) });
    if (!response.ok) throw new Error(`Webhook secret rotation failed with ${response.status}`);
    const payload = await response.json();
    window.alert(`Copy this webhook signing secret now; it will not be shown again:\n\n${payload.rawSecret}`);
    await loadApps();
  }

  async function testAppWebhook(appId: string) {
    const response = await fetch(`/api/admin/apps/${appId}/webhook-test`, { method: 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({}) });
    if (!response.ok) throw new Error(`Webhook test failed with ${response.status}`);
    await loadWebhookDeliveries();
    await loadApps();
  }


  async function createApp() {
    if (!form.name.trim()) throw new Error('App name is required');
    if (!form.slug.trim()) throw new Error('App slug is required');

    const response = await fetch('/api/admin/apps', {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: form.name.trim(),
        slug: form.slug.trim(),
        description: form.description.trim(),
        permissions: splitCsv(form.permissions),
        webhookUrl: form.webhookUrl.trim(),
        webhookEventFilters: splitCsv(form.webhookEventFilters)
      })
    });
    if (!response.ok) throw new Error(`Create app failed with ${response.status}`);
    await loadApps();
  }

  function beginAppEdit(app: RegisteredApp) {
    setError(null);
    setAppEditForms((current) => ({ ...current, [app.id]: appToEditForm(app) }));
  }

  function cancelAppEdit(appId: string) {
    setAppEditForms((current) => {
      const { [appId]: _discarded, ...remaining } = current;
      return remaining;
    });
  }

  function updateAppEditField(appId: string, field: keyof AppEditForm, value: string | string[]) {
    setAppEditForms((current) => {
      const editForm = current[appId];
      if (!editForm) return current;
      return { ...current, [appId]: { ...editForm, [field]: value } };
    });
  }

  function toggleAppEditPermission(appId: string, permission: string) {
    setAppEditForms((current) => {
      const editForm = current[appId];
      if (!editForm) return current;
      const nextPermissions = editForm.permissions.includes(permission)
        ? editForm.permissions.filter((currentPermission) => currentPermission !== permission)
        : [...editForm.permissions, permission];
      return { ...current, [appId]: { ...editForm, permissions: nextPermissions } };
    });
  }

  function validateAppEditPermissions(editForm: AppEditForm) {
    return editForm.permissions.filter((permission) => !permissions.includes(permission));
  }

  async function updateApp(app: RegisteredApp, patch: Partial<RegisteredApp> & { webhookUrl?: string; webhookEventFilters?: string[] }) {
    const response = await fetch(`/api/admin/apps/${app.id}`, {
      method: 'PATCH',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(patch)
    });
    if (!response.ok) throw new Error(`Update app failed with ${response.status}`);
    await loadApps();
  }

  async function saveAppEdit(app: RegisteredApp) {
    const editForm = appEditForms[app.id];
    if (!editForm) return;

    const invalidPermissions = validateAppEditPermissions(editForm);
    if (invalidPermissions.length > 0) {
      throw new Error(`Invalid permissions: ${invalidPermissions.join(', ')}`);
    }

    await updateApp(app, {
      name: editForm.name,
      slug: editForm.slug,
      description: editForm.description,
      permissions: editForm.permissions,
      webhookUrl: editForm.webhookUrl,
      webhookEventFilters: splitCsv(editForm.webhookEventFilters)
    });
    cancelAppEdit(app.id);
  }

  async function archiveApp(app: RegisteredApp) {
    const confirmation = window.prompt(`Archive app ${app.slug}? This renames the stored slug so ${app.slug} can be reused, disables the app, revokes all API keys, and disables webhook endpoints while keeping records auditable. Type ${app.slug} to confirm.`);
    if (confirmation !== app.slug) return;
    const response = await fetch(`/api/admin/apps/${app.id}`, { method: 'DELETE', headers: adminHeaders() });
    if (!response.ok) throw new Error(`Archive app failed with ${response.status}`);
    const payload = await response.json();
    if (!payload.archived) throw new Error('Archive app response did not confirm archival');
    await loadApps();
  }

  async function generateKey(app: RegisteredApp) {
    const name = window.prompt('Key name', `${app.slug} key`);
    if (!name) return;
    const response = await fetch(`/api/admin/apps/${app.id}/keys`, {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name })
    });
    if (!response.ok) throw new Error(`Generate key failed with ${response.status}`);
    const payload = await response.json();
    setNewRawKey(payload.rawKey);
    await loadApps();
  }

  async function startTwitchLogin(role: 'bot' | 'broadcaster') {
    const response = await fetch(`/api/admin/twitch/${role}/login/start`, {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ returnTo: `${window.location.origin}/admin#twitch-setup` })
    });
    if (!response.ok) throw new Error(`Start Twitch ${role} login failed with ${response.status}`);
    const payload = await response.json();
    window.location.assign(payload.authorizationUrl);
  }

  async function syncEventSub() {
    const response = await fetch('/api/admin/twitch/eventsub/sync', {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({})
    });
    if (!response.ok) throw new Error(`EventSub sync failed with ${response.status}`);
    await loadTwitchStatus();
  }

  async function refreshTwitchTokens() {
    const response = await fetch('/api/admin/twitch/tokens/refresh', {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({})
    });
    if (!response.ok) throw new Error(`Refresh Twitch tokens failed with ${response.status}`);
    await loadTwitchStatus();
  }

  function renderTwitchAccount(account: TwitchAccountStatus) {
    return (
      <article className={account.connected && !account.missingScopes.length && !account.tokenExpired ? 'twitch-account healthy' : 'twitch-account degraded'}>
        <div className="app-card-header">
          <div>
            <h3>{account.role === 'bot' ? 'Dedicated bot account' : 'Broadcaster account'}</h3>
            <p>{account.connected ? `${account.login} · ${account.twitchUserId}` : 'Not connected'}</p>
          </div>
          <button onClick={() => void startTwitchLogin(account.role).catch((loginError) => setError(String(loginError)))}>Start {account.role} login</button>
        </div>
        <div className="twitch-meta">
          <span>{account.connected ? 'Connected' : 'Missing authorization'}</span>
          <span>Expires: {account.expiresAt ?? 'not available'}</span>
          {account.tokenExpired ? <span>Token expired/missing</span> : null}
          {!account.tokenValid ? <span>Token invalid{account.validationError ? `: ${account.validationError}` : ''}</span> : null}
          {account.lastRefreshError ? <span>Refresh error: {account.lastRefreshError}</span> : null}
        </div>
        <div className="scope-grid">
          <div><strong>Granted scopes</strong><div className="chips">{account.grantedScopes.length ? account.grantedScopes.map((scope) => <span key={scope}>{scope}</span>) : <span>none</span>}</div></div>
          <div><strong>Missing scopes</strong><div className="chips missing">{account.missingScopes.length ? account.missingScopes.map((scope) => <span key={scope}>{scope}</span>) : <span>none</span>}</div></div>
          <div><strong>Required scopes</strong><div className="chips">{account.requiredScopes.map((scope) => <span key={scope}>{scope}</span>)}</div></div>
        </div>
      </article>
    );
  }

  async function revokeKey(app: RegisteredApp, key: ApiKey) {
    if (!window.confirm(`Revoke API key ${key.keyPrefix}?`)) return;
    const response = await fetch(`/api/admin/apps/${app.id}/keys/${key.id}`, { method: 'DELETE', headers: adminHeaders() });
    if (!response.ok) throw new Error(`Revoke key failed with ${response.status}`);
    await loadApps();
  }

  if (adminAuthStatus !== 'authenticated') {
    return (
      <main className="shell">
        <form className="admin-auth page-card" aria-label="Admin API key" onSubmit={(event) => { event.preventDefault(); void validateAdminKey(); }}>
          <label>Admin API key (stored locally in this browser)
            <input type="password" value={adminKey} onChange={(event) => saveAdminKey(event.target.value)} placeholder="Required when INTERNAL_ADMIN_API_KEY is configured" />
          </label>
          <button type="submit" disabled={adminAuthStatus === 'validating'}>{adminAuthStatus === 'validating' ? 'Validating…' : 'Validate key'}</button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Admin navigation">
        <div className="brand">{gatewayName}</div>
        <nav>
          {pages.map((page) => (
            <a key={page} href={`#${page.toLowerCase().replaceAll(' ', '-')}`}>{page}</a>
          ))}
        </nav>
      </aside>

      <section className="content">
        <header className="hero" id="dashboard">
          <p className="eyebrow">Phase 7 simple text commands</p>
          <h1>Admin operations</h1>
          <p>
            Connect Twitch accounts, manage downstream apps, and own safe static chat responses such as !dc without moving music-domain commands into the gateway.
          </p>
        </header>

        <form className="admin-auth page-card" aria-label="Admin API key" onSubmit={(event) => { event.preventDefault(); void validateAdminKey(); }}>
          <label>Admin API key (stored locally in this browser)
            <input type="password" value={adminKey} onChange={(event) => saveAdminKey(event.target.value)} placeholder="Required when INTERNAL_ADMIN_API_KEY is configured" />
          </label>
          <button type="submit">Validate key</button>
        </form>

        <section className="status-card" aria-label="Gateway status summary">
          <span className="status-dot" />
          <div>
            <strong>{twitchStatus?.status === 'healthy' ? 'Twitch auth healthy' : 'Twitch auth degraded'} · {activeApps} enabled app{activeApps === 1 ? '' : 's'}</strong>
            <p>{loading || twitchLoading ? 'Loading admin status…' : 'Twitch setup and app registry controls are available below.'}</p>
          </div>
        </section>


        <section className="page-card twitch-panel" id="twitch-setup">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Twitch Setup</p>
              <h2>OAuth connections and scope health</h2>
            </div>
            <div className="button-row">
              <button onClick={() => void loadTwitchStatus()}>Refresh status</button>
              <button onClick={() => void refreshTwitchTokens().catch((refreshError) => setError(String(refreshError)))}>Refresh tokens</button>
            </div>
          </div>
          {twitchStatus ? (
            <>
              <div className="app-token-card">
                <strong>App Access Token</strong>
                <p>{twitchStatus.appToken.valid ? `Valid until ${twitchStatus.appToken.expiresAt}` : `Degraded: ${twitchStatus.appToken.error ?? 'not configured'}`}</p>
              </div>
              <div className="twitch-account-list">
                {renderTwitchAccount(twitchStatus.bot)}
                {renderTwitchAccount(twitchStatus.broadcaster)}
              </div>
              {twitchStatus.degradedReasons.length ? <p className="error">Degraded reasons: {twitchStatus.degradedReasons.join(', ')}</p> : null}
            </>
          ) : <p>{twitchLoading ? 'Loading Twitch setup…' : 'Twitch setup status has not loaded yet.'}</p>}
        </section>

        <section className="page-card apps-panel" id="apps">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Apps</p>
              <h2>Registered downstream apps</h2>
            </div>
            <button onClick={() => void loadApps()}>Refresh</button>
          </div>

          {error ? <p className="error">{error}</p> : null}
          {newRawKey ? (
            <div className="one-time-key" role="alert">
              <strong>Copy this raw API key now. It is shown only once.</strong>
              <code>{newRawKey}</code>
              <button onClick={() => setNewRawKey(null)}>I copied it</button>
            </div>
          ) : null}

          <form className="create-form" onSubmit={(event) => { event.preventDefault(); void createApp().catch((createError) => setError(String(createError))); }}>
            <label>Name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Example: Erwin Hatchery" /></label>
            <label>Slug<input required value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="Example: erwin-hatchery" /></label>
            <label>Description<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Example: Hatchery reward integration" /></label>
            <label>Permissions<input value={form.permissions} onChange={(event) => setForm({ ...form, permissions: event.target.value })} placeholder="Example: chat:messages:send,streams:read" /></label>
            <label>Webhook URL placeholder<input value={form.webhookUrl} onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })} placeholder="Example: https://app.example/webhooks/erwin" /></label>
            <label>Webhook event filters<input value={form.webhookEventFilters} onChange={(event) => setForm({ ...form, webhookEventFilters: event.target.value })} placeholder="Example: chat.message,channel_points.redemption" /></label>
            <button type="submit">Create app</button>
          </form>

          <div className="permission-bank">
            <strong>Available permissions</strong>
            <div>{permissions.map((permission) => <code key={permission}>{permission}</code>)}</div>
          </div>

          <div className="app-list">
            {apps.map((registeredApp) => {
              const editForm = appEditForms[registeredApp.id];
              const invalidEditPermissions = editForm ? validateAppEditPermissions(editForm) : [];

              return (
                <article className={registeredApp.enabled ? 'app-card' : 'app-card archived'} key={registeredApp.id}>
                  <div className="app-card-header">
                    <div>
                      <h3>{registeredApp.name}</h3>
                      <p>{registeredApp.slug} · {registeredApp.description ?? 'No description'}</p>
                    </div>
                    <div className="app-actions">
                      {editForm ? (
                        <>
                          <button onClick={() => void saveAppEdit(registeredApp).catch((updateError) => setError(String(updateError)))} disabled={invalidEditPermissions.length > 0}>Save</button>
                          <button onClick={() => cancelAppEdit(registeredApp.id)}>Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => beginAppEdit(registeredApp)}>Edit</button>
                      )}
                      <button onClick={() => void updateApp(registeredApp, { enabled: !registeredApp.enabled }).catch((updateError) => setError(String(updateError)))}>
                        {registeredApp.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button className="destructive" onClick={() => void archiveApp(registeredApp).catch((archiveError) => setError(String(archiveError)))}>Archive</button>
                    </div>
                  </div>

                  {editForm ? (
                    <div className="app-edit-form">
                      <div className="app-edit-grid">
                        <label>Name<input value={editForm.name} onChange={(event) => updateAppEditField(registeredApp.id, 'name', event.target.value)} /></label>
                        <label>Slug<input value={editForm.slug} onChange={(event) => updateAppEditField(registeredApp.id, 'slug', event.target.value)} /></label>
                        <label>Description<input value={editForm.description} onChange={(event) => updateAppEditField(registeredApp.id, 'description', event.target.value)} /></label>
                        <label>Webhook URL placeholder<input value={editForm.webhookUrl} onChange={(event) => updateAppEditField(registeredApp.id, 'webhookUrl', event.target.value)} placeholder="Example: https://app.example/webhooks/erwin" /></label>
                        <label>Webhook event filters<input value={editForm.webhookEventFilters} onChange={(event) => updateAppEditField(registeredApp.id, 'webhookEventFilters', event.target.value)} placeholder="Example: chat.message,channel_points.redemption" /></label>
                      </div>
                      <fieldset className="permission-picker">
                        <legend>Permissions</legend>
                        {permissions.map((permission) => (
                          <label className="checkbox-label" key={permission}>
                            <input type="checkbox" checked={editForm.permissions.includes(permission)} onChange={() => toggleAppEditPermission(registeredApp.id, permission)} />
                            {permission}
                          </label>
                        ))}
                      </fieldset>
                      {invalidEditPermissions.length > 0 ? <p className="error">Remove invalid permissions before saving: {invalidEditPermissions.join(', ')}</p> : null}
                    </div>
                  ) : (
                    <>
                      <div className="chips">{registeredApp.permissions.map((permission) => <span key={permission}>{permission}</span>)}</div>

                      <div className="webhook-summary">
                        <p><strong>Webhook URL placeholder:</strong> {registeredApp.webhook.url || 'Not configured'}</p>
                        <p><strong>Event filters:</strong> {registeredApp.webhook.eventFilters.length > 0 ? registeredApp.webhook.eventFilters.join(', ') : 'All deliverable events'}</p>
                      </div>
                    </>
                  )}

                  <div className="delivery-status">
                    <span>Delivery status: {registeredApp.webhook.enabled ? `enabled · last ${registeredApp.webhook.lastDeliveryAt ?? 'never'}` : 'disabled'}</span>
                    <button onClick={() => void rotateWebhookSecret(registeredApp.id).catch((secretError) => setError(String(secretError)))}>Rotate signing secret</button>
                    <button onClick={() => void testAppWebhook(registeredApp.id).catch((testError) => setError(String(testError)))}>Send test webhook</button>
                  </div>

                  <div className="keys-heading">
                    <strong>API keys</strong>
                    <button onClick={() => void generateKey(registeredApp).catch((keyError) => setError(String(keyError)))}>Generate API key</button>
                  </div>
                  <div className="key-list">
                    {registeredApp.apiKeys.map((key) => (
                      <div className={key.revokedAt ? 'key revoked' : 'key'} key={key.id}>
                        <span><strong>{key.name}</strong> <code>{key.keyPrefix}</code></span>
                        <span>last used {key.lastUsedAt ?? 'never'}</span>
                        {key.revokedAt ? <span>revoked</span> : <button onClick={() => void revokeKey(registeredApp, key).catch((revokeError) => setError(String(revokeError)))}>Revoke</button>}
                      </div>
                    ))}
                    {registeredApp.apiKeys.length === 0 ? <p>No API keys yet.</p> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>


        <section className="page-card" id="text-commands">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Gateway-owned static replies</p>
              <h2>Text Commands</h2>
              <p>Static text only. Safe placeholders: <code>{'{user}'}</code>, <code>{'{displayName}'}</code>, <code>{'{channel}'}</code>.</p>
            </div>
            <button onClick={() => { void loadCommandPrefix().catch((loadError) => setError(String(loadError))); void loadTextCommands().catch((loadError) => setError(String(loadError))); }}>Refresh commands</button>
          </div>

          <form className="create-form command-form" onSubmit={(event) => { event.preventDefault(); void updateCommandPrefix().catch((updateError) => setError(String(updateError))); }}>
            <label>Global command prefix<input value={prefixForm} maxLength={8} onChange={(event) => setPrefixForm(event.target.value)} /></label>
            <button type="submit">Save command prefix</button>
          </form>

          <form className="create-form command-form" onSubmit={(event) => { event.preventDefault(); void createTextCommand().catch((createError) => setError(String(createError))); }}>
            <label>Command<input required value={commandForm.command} onChange={(event) => setCommandForm({ ...commandForm, command: event.target.value })} placeholder="Example: dc" /></label>
            <label>Aliases<input value={commandForm.aliases} onChange={(event) => setCommandForm({ ...commandForm, aliases: event.target.value })} placeholder="Example: discord,youtube" /></label>
            <label>Response text<textarea required value={commandForm.responseText} onChange={(event) => setCommandForm({ ...commandForm, responseText: event.target.value })} placeholder="Example: Join the Discord: https://discord.gg/example" /></label>
            <label>Required role<select value={commandForm.requiredRole} onChange={(event) => setCommandForm({ ...commandForm, requiredRole: event.target.value })}>{['everyone', 'subscriber', 'vip', 'moderator', 'broadcaster'].map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
            <label>Global cooldown seconds<input type="number" min="0" value={commandForm.cooldownSeconds} onChange={(event) => setCommandForm({ ...commandForm, cooldownSeconds: Number(event.target.value) })} /></label>
            <label>User cooldown seconds<input type="number" min="0" value={commandForm.userCooldownSeconds} onChange={(event) => setCommandForm({ ...commandForm, userCooldownSeconds: Number(event.target.value) })} /></label>
            <label>Reply mode<select value={commandForm.replyMode} onChange={(event) => setCommandForm({ ...commandForm, replyMode: event.target.value })}><option value="message">Normal message</option><option value="reply">Reply to chat message</option></select></label>
            <label className="checkbox-label"><input type="checkbox" checked={commandForm.enabled} onChange={(event) => setCommandForm({ ...commandForm, enabled: event.target.checked })} /> Enabled</label>
            <button type="submit">Create text command</button>
          </form>

          <div className="table-list">
            {textCommands.map((command) => (
              <article className="delivery-row" key={command.id}>
                <div className="app-card-header">
                  <div>
                    <h3>{configuredPrefix}{command.command}</h3>
                    <p>{command.responseText}</p>
                  </div>
                  <button onClick={() => void updateTextCommand(command, { enabled: !command.enabled }).catch((updateError) => setError(String(updateError)))}>{command.enabled ? 'Disable' : 'Enable'}</button>
                </div>
                <div className="chips">
                  {command.aliases.map((alias) => <span key={alias}>{configuredPrefix}{alias}</span>)}
                  <span>role {command.requiredRole}</span>
                  <span>global cooldown {command.cooldownSeconds}s</span>
                  <span>user cooldown {command.userCooldownSeconds}s</span>
                  <span>{command.replyMode}</span>
                  <span>used {command.usageCount}</span>
                  <span>last {command.lastUsedAt ?? 'never'}</span>
                </div>
                <div className="button-row">
                  <button onClick={() => void testTextCommand(command).catch((testError) => setError(String(testError)))}>Test</button>
                  <button onClick={() => void deleteTextCommand(command).catch((deleteError) => setError(String(deleteError)))}>Delete</button>
                </div>
              </article>
            ))}
            {textCommands.length === 0 ? <p>No text commands configured yet. Create <code>!dc</code> above to move a Discord link into the gateway.</p> : null}
          </div>
        </section>

        <section className="page-card twitch-panel" id="diagnostics">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Diagnostics</p>
              <h2>Twitch EventSub status</h2>
            </div>
            <div className="button-row">
              <button onClick={() => void loadTwitchStatus()}>Refresh diagnostics</button>
              <button onClick={() => void syncEventSub().catch((syncError) => setError(String(syncError)))}>Sync EventSub</button>
            </div>
          </div>
          {eventSubStatus ? (
            <div className={eventSubStatus.healthy ? 'eventsub healthy' : 'eventsub degraded'}>
              <p><strong>Callback:</strong> {eventSubStatus.callbackUrl ?? 'not configured'}</p>
              <p><strong>Last delivery:</strong> {eventSubStatus.lastDelivery ? `${eventSubStatus.lastDelivery.eventType ?? eventSubStatus.lastDelivery.messageType} at ${eventSubStatus.lastDelivery.receivedAt}` : 'none recorded'}</p>
              <p><strong>Duplicates:</strong> {eventSubStatus.duplicateCount}</p>
              {eventSubStatus.desiredError ? <p className="error">Desired-state error: {eventSubStatus.desiredError}</p> : null}
              <div className="diagnostic-grid">
                <article>
                  <h3>Subscriptions</h3>
                  {eventSubStatus.subscriptions.length ? eventSubStatus.subscriptions.map((subscription) => (
                    <div className="diagnostic-row" key={subscription.id}>
                      <span>{subscription.type} v{subscription.version}</span>
                      <span>{subscription.status}</span>
                    </div>
                  )) : <p>No local EventSub subscriptions recorded.</p>}
                </article>
                <article>
                  <h3>Missing desired subscriptions</h3>
                  {eventSubStatus.missingSubscriptions.length ? eventSubStatus.missingSubscriptions.map((subscription) => <code key={`${subscription.type}-${JSON.stringify(subscription.condition)}`}>{subscription.type}</code>) : <p>None</p>}
                </article>
                <article>
                  <h3>Revoked/unhealthy subscriptions</h3>
                  {eventSubStatus.revokedSubscriptions.length ? eventSubStatus.revokedSubscriptions.map((subscription) => <code key={`${subscription.twitchSubscriptionId}-${subscription.type}`}>{subscription.type}: {subscription.status}</code>) : <p>None</p>}
                </article>
              </div>
            </div>
          ) : <p>EventSub diagnostics have not loaded yet.</p>}
        </section>

        <section className="page-card" id="chat-log">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Chat archive</p>
              <h2>Chat Log</h2>
            </div>
            <form className="button-row" onSubmit={(event) => { event.preventDefault(); void loadChatLog(chatSearch, chatLimit).catch((loadError) => setError(String(loadError))); }}>
              <label>Search text
                <input placeholder="Optional chat text" value={chatSearch} onChange={(event) => setChatSearch(event.target.value)} />
              </label>
              <label>Limit
                <input type="number" min="1" max="500" value={chatLimit} onChange={(event) => setChatLimit(Number.isNaN(event.target.valueAsNumber) ? 1 : event.target.valueAsNumber)} />
              </label>
              <button type="submit">Load messages</button>
            </form>
          </div>
          <div className="table-list">
            {chatMessages.map((message) => (
              <article className="log-row" key={message.id}>
                <div><strong>{message.chatterDisplayName ?? message.chatterLogin ?? 'unknown'}</strong> <span>{new Date(message.createdAt).toLocaleString()}</span></div>
                <p>{message.text}</p>
                <div className="chips">
                  {message.isCommand ? <span>{message.commandSymbol ?? configuredPrefix}{message.commandName}</span> : <span>message</span>}
                  {message.isBroadcaster ? <span>broadcaster</span> : null}
                  {message.isMod ? <span>mod</span> : null}
                  {message.isVip ? <span>vip</span> : null}
                  {message.isSubscriber ? <span>subscriber</span> : null}
                </div>
              </article>
            ))}
            {chatMessages.length === 0 ? <p>{chatLogLoaded ? 'No chat messages match the current filters.' : 'Choose filters and load chat messages.'}</p> : null}
          </div>
        </section>


        <section className="page-card" id="outgoing-messages">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Gateway-owned send queue</p>
              <h2>Outgoing Messages</h2>
            </div>
            <form className="button-row" onSubmit={(event) => { event.preventDefault(); void loadOutgoingMessages(outgoingStatus, outgoingLimit).catch((loadError) => setError(String(loadError))); }}>
              <label>Status
                <select value={outgoingStatus} onChange={(event) => setOutgoingStatus(event.target.value)}>
                  <option value="">All statuses</option>
                  {['queued', 'sending', 'sent', 'dropped', 'failed', 'retrying', 'dead_lettered'].map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
              <label>Limit
                <input type="number" min="1" max="500" value={outgoingLimit} onChange={(event) => setOutgoingLimit(Number.isNaN(event.target.valueAsNumber) ? 1 : event.target.valueAsNumber)} />
              </label>
              <button type="submit">Load messages</button>
            </form>
          </div>
          <div className="table-list">
            {outgoingMessages.map((message) => (
              <article className="delivery-row" key={message.id}>
                <div><strong>{message.status}</strong> <code>{message.id}</code></div>
                <p>{message.message}</p>
                <div className="chips">
                  <span>attempts {message.attempts}</span>
                  <span>priority {message.priority}</span>
                  <span>idempotency {message.idempotencyKey}</span>
                  {message.responseCode ? <span>HTTP {message.responseCode}</span> : null}
                  {message.twitchMessageId ? <span>Twitch {message.twitchMessageId}</span> : null}
                </div>
                {message.twitchDropReason ? <pre className="json-block">drop_reason: {JSON.stringify(message.twitchDropReason, null, 2)}</pre> : null}
                {message.responseBodyExcerpt ? <pre className="json-block">{message.responseBodyExcerpt}</pre> : null}
                {message.lastError ? <p className="error">{message.lastError}</p> : null}
                {!['sent', 'dropped'].includes(message.status) ? <button onClick={() => void retryOutgoingMessage(message.id).catch((retryError) => setError(String(retryError)))}>Retry safely</button> : null}
              </article>
            ))}
            {outgoingMessages.length === 0 ? <p>{outgoingLoaded ? 'No outgoing messages match the current filters.' : 'Choose filters and load outgoing messages.'}</p> : null}
          </div>
        </section>

        <section className="page-card" id="webhook-deliveries">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Fanout reliability</p>
              <h2>Webhook Deliveries</h2>
            </div>
            <button onClick={() => void loadWebhookDeliveries().catch((loadError) => setError(String(loadError)))}>Refresh deliveries</button>
          </div>
          <div className="table-list">
            {webhookDeliveries.map((delivery) => (
              <article className="delivery-row" key={delivery.id}>
                <div><strong>{delivery.status}</strong> <code>{delivery.id}</code></div>
                <p>event {delivery.eventId} · attempts {delivery.attempts} · next {delivery.nextAttemptAt}</p>
                {delivery.lastError ? <p className="error">{delivery.lastError}</p> : null}
                <button onClick={() => void retryWebhookDelivery(delivery.id).catch((retryError) => setError(String(retryError)))}>Retry</button>
              </article>
            ))}
            {webhookDeliveries.length === 0 ? <p>No webhook deliveries recorded yet.</p> : null}
          </div>
        </section>


        <section className="page-card" id="channel-points">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Hatchery MVP rewards</p>
              <h2>Channel Points</h2>
              <p>Reward management uses the broadcaster user token with <code>channel:manage:redemptions</code>; Hatchery keeps economy logic.</p>
            </div>
            <div className="button-row">
              <button onClick={() => void syncChannelPoints().catch((syncError) => setError(String(syncError)))}>Sync from Twitch</button>
              <button onClick={() => void loadChannelPoints().catch((loadError) => setError(String(loadError)))}>Refresh</button>
              <label className="checkbox-label"><input type="checkbox" checked={showDeletedChannelPointRewards} onChange={(event) => { const checked = event.target.checked; setShowDeletedChannelPointRewards(checked); void loadChannelPoints(checked).catch((loadError) => setError(String(loadError))); }} /> Show deleted/local stale rewards</label>
            </div>
          </div>

          {channelPointRewardSyncRun ? (
            <div className="sync-summary" role="status">
              <strong>Last reward sync:</strong> saw {channelPointRewardSyncRun.rewardsSeen} rewards, created {channelPointRewardSyncRun.rewardsCreated}, updated {channelPointRewardSyncRun.rewardsUpdated}
              {channelPointRewardSyncRun.completedAt ? ` · completed ${new Date(channelPointRewardSyncRun.completedAt).toLocaleString()}` : ''}.
              {channelPointRewardSyncRun.rewardsMissingOnTwitch > 0 ? ` ${channelPointRewardSyncRun.rewardsMissingOnTwitch} local rewards were marked deleted because Twitch no longer returned them.` : ''}
            </div>
          ) : null}

          <form className="create-form command-form" onSubmit={(event) => { event.preventDefault(); void createChannelPointReward().catch((createError) => setError(String(createError))); }}>
            <label>Title<input required value={rewardForm.title} onChange={(event) => setRewardForm({ ...rewardForm, title: event.target.value })} placeholder="Example: hatchery-reward" /></label>
            <label>Cost<input required type="number" min="1" value={rewardForm.cost} onChange={(event) => setRewardForm({ ...rewardForm, cost: event.target.value })} placeholder="Example: 1000" /></label>
            <label>Prompt<textarea value={rewardForm.prompt} onChange={(event) => setRewardForm({ ...rewardForm, prompt: event.target.value })} placeholder="Example: Redeem a Hatchery reward" /></label>
            <label>Owning app<select required value={rewardForm.owning_app_id} onChange={(event) => setRewardForm({ ...rewardForm, owning_app_id: event.target.value })}>
              <option value="">Select an owning app</option>
              {apps.map((registeredApp) => <option key={registeredApp.id} value={registeredApp.id}>{registeredApp.slug} — {registeredApp.name}</option>)}
            </select></label>
            <label className="checkbox-label"><input type="checkbox" checked={rewardForm.is_enabled} onChange={(event) => setRewardForm({ ...rewardForm, is_enabled: event.target.checked })} /> Enabled</label>
            <button type="submit">Create reward</button>
          </form>

          <div className="stats-grid">
            <article><h3>Missing scope</h3><p>{channelPointDiagnostics?.missingChannelManageRedemptions ? 'channel:manage:redemptions missing' : 'OK'}</p></article>
            <article><h3>Last sync</h3><p>{JSON.stringify(channelPointDiagnostics?.lastRewardSync ?? null)}</p></article>
            <article><h3>Last redemption</h3><p>{JSON.stringify(channelPointDiagnostics?.lastRedemptionEvent ?? null)}</p></article>
            <article><h3>Missing ownership</h3><p>{channelPointDiagnostics?.twitchRewardsMissingOwnershipMapping ?? 0}</p></article>
            <article><h3>Missing on Twitch</h3><p>{channelPointDiagnostics?.rewardsMissingOnTwitch ?? 0}</p></article>
          </div>

          <h3>Reward list</h3>
          <div className="table-list">
            {channelPointRewards.map((reward) => (
              <article className="delivery-row" key={reward.id}>
                <div><strong>{reward.title}</strong> <code>{reward.twitchRewardId}</code></div>
                <p>cost {reward.cost} · owner {apps.find((app) => app.id === reward.owningAppId)?.slug ?? reward.owningAppId ?? 'unmapped'} · {reward.enabled ? 'enabled' : 'disabled'} · {reward.manageable ? 'manageable' : 'not manageable'}{reward.deletedAt ? ` · deleted ${new Date(reward.deletedAt).toLocaleString()}` : ''}</p>
                <div className="button-row">
                  <button disabled={Boolean(reward.deletedAt)} title={reward.deletedAt ? 'Deleted rewards cannot be updated on Twitch' : undefined} onClick={() => void updateChannelPointReward(reward, { is_enabled: !reward.enabled }).catch((updateError) => setError(String(updateError)))}>{reward.enabled ? 'Disable' : 'Enable'}</button>
                  <button disabled={Boolean(reward.deletedAt)} title={reward.deletedAt ? 'Deleted rewards cannot be deleted on Twitch' : undefined} onClick={() => void deleteChannelPointReward(reward).catch((deleteError) => setError(String(deleteError)))}>Delete</button>
                </div>
              </article>
            ))}
            {channelPointRewards.length === 0 ? <p>No Channel Point rewards have been synced yet.</p> : null}
          </div>

          <h3>Recent redemptions</h3>
          <div className="table-list">
            {channelPointRedemptions.map((redemption) => (
              <article className="delivery-row" key={redemption.id}>
                <div><strong>{redemption.status}</strong> <code>{redemption.twitchRedemptionId}</code></div>
                <p>{redemption.userDisplayName ?? redemption.userLogin ?? 'unknown'} · reward {redemption.twitchRewardId} · {new Date(redemption.redeemedAt).toLocaleString()}</p>
                {redemption.userInput ? <p>{redemption.userInput}</p> : null}
                <div className="chips"><span>gateway event {redemption.eventId ?? 'pending'}</span><span>delivery visible in Webhook Deliveries</span></div>
              </article>
            ))}
            {channelPointRedemptions.length === 0 ? <p>No redemptions recorded yet.</p> : null}
          </div>
        </section>

        {pages.filter((page) => !['Dashboard', 'Apps', 'Twitch Setup', 'Text Commands', 'Diagnostics', 'Chat Log', 'Outgoing Messages', 'Webhook Deliveries', 'Channel Points'].includes(page)).map((page) => (
          <section className="page-card placeholder" id={page.toLowerCase().replaceAll(' ', '-')} key={page}>
            <h2>{page}</h2>
            <p>Operational controls for this area arrive in later phases.</p>
          </section>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
