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

type RegisteredApp = {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  description: string | null;
  permissions: string[];
  apiKeys: ApiKey[];
  webhook: Webhook;
};

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

function App() {
  const [apps, setApps] = useState<RegisteredApp[]>([]);
  const [permissions, setPermissions] = useState<string[]>(fallbackPermissions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [twitchStatus, setTwitchStatus] = useState<TwitchSetupStatus | null>(null);
  const [eventSubStatus, setEventSubStatus] = useState<EventSubStatus | null>(null);
  const [twitchLoading, setTwitchLoading] = useState(false);
  const [adminKey, setAdminKey] = useState(() => window.localStorage.getItem('erwinGatewayAdminKey') ?? '');
  const [form, setForm] = useState({
    name: 'My Downstream App',
    slug: 'my-downstream-app',
    description: 'Downstream app integration',
    permissions: 'chat:messages:send,streams:read,logs:read_own',
    webhookUrl: '',
    webhookEventFilters: ''
  });

  const activeApps = useMemo(() => apps.filter((app) => app.enabled).length, [apps]);

  function adminHeaders(extraHeaders: Record<string, string> = {}) {
    return adminKey ? { ...extraHeaders, 'X-Admin-API-Key': adminKey } : extraHeaders;
  }

  function saveAdminKey(value: string) {
    setAdminKey(value);
    if (value) {
      window.localStorage.setItem('erwinGatewayAdminKey', value);
    } else {
      window.localStorage.removeItem('erwinGatewayAdminKey');
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
    void loadApps();
    void loadTwitchStatus();
  }, []);

  async function createApp() {
    const response = await fetch('/api/admin/apps', {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: form.name,
        slug: form.slug,
        description: form.description,
        permissions: splitCsv(form.permissions),
        webhookUrl: form.webhookUrl,
        webhookEventFilters: splitCsv(form.webhookEventFilters)
      })
    });
    if (!response.ok) throw new Error(`Create app failed with ${response.status}`);
    await loadApps();
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
          <p className="eyebrow">Phase 3 Twitch auth</p>
          <h1>Admin operations</h1>
          <p>
            Connect the dedicated Twitch bot account and broadcaster account, verify required scopes, and keep
            downstream app registry controls ready for erwin-music and erwin-hatchery.
          </p>
        </header>

        <section className="admin-auth page-card" aria-label="Admin API key">
          <label>Admin API key (stored locally in this browser)
            <input type="password" value={adminKey} onChange={(event) => saveAdminKey(event.target.value)} placeholder="Required when INTERNAL_ADMIN_API_KEY is configured" />
          </label>
        </section>

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
            <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Slug<input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /></label>
            <label>Description<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <label>Permissions<input value={form.permissions} onChange={(event) => setForm({ ...form, permissions: event.target.value })} /></label>
            <label>Webhook URL placeholder<input value={form.webhookUrl} onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })} placeholder="https://app.example/webhooks/erwin" /></label>
            <label>Webhook event filters<input value={form.webhookEventFilters} onChange={(event) => setForm({ ...form, webhookEventFilters: event.target.value })} placeholder="chat.message,channel_points.redemption" /></label>
            <button type="submit">Create app</button>
          </form>

          <div className="permission-bank">
            <strong>Available permissions</strong>
            <div>{permissions.map((permission) => <code key={permission}>{permission}</code>)}</div>
          </div>

          <div className="app-list">
            {apps.map((registeredApp) => (
              <article className="app-card" key={registeredApp.id}>
                <div className="app-card-header">
                  <div>
                    <h3>{registeredApp.name}</h3>
                    <p>{registeredApp.slug} · {registeredApp.description ?? 'No description'}</p>
                  </div>
                  <button onClick={() => void updateApp(registeredApp, { enabled: !registeredApp.enabled }).catch((updateError) => setError(String(updateError)))}>
                    {registeredApp.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>

                <div className="chips">{registeredApp.permissions.map((permission) => <span key={permission}>{permission}</span>)}</div>

                <div className="webhook-row">
                  <label>Webhook URL placeholder
                    <input defaultValue={registeredApp.webhook.url} onBlur={(event) => void updateApp(registeredApp, { webhookUrl: event.target.value }).catch((updateError) => setError(String(updateError)))} />
                  </label>
                  <label>Event filters
                    <input defaultValue={registeredApp.webhook.eventFilters.join(',')} onBlur={(event) => void updateApp(registeredApp, { webhookEventFilters: splitCsv(event.target.value) }).catch((updateError) => setError(String(updateError)))} />
                  </label>
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
            ))}
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

        {pages.filter((page) => page !== 'Dashboard' && page !== 'Apps' && page !== 'Twitch Setup' && page !== 'Diagnostics').map((page) => (
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
