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
          <p className="eyebrow">Phase 2 app registry</p>
          <h1>Admin operations</h1>
          <p>
            Create downstream apps, assign contract permissions, rotate app API keys, and prepare webhook endpoint
            configuration before services such as erwin-music and erwin-hatchery call the gateway.
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
            <strong>{activeApps} enabled app{activeApps === 1 ? '' : 's'}</strong>
            <p>{loading ? 'Loading app registry…' : 'App registry controls are available below.'}</p>
          </div>
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

        {pages.filter((page) => page !== 'Dashboard' && page !== 'Apps').map((page) => (
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
