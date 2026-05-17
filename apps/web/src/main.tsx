import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { gatewayName } from '@erwin-gateway/shared';
import './styles.css';

const pages = [
  {
    title: 'Dashboard',
    description: 'Overall status, active channel, queue depth, recent activity, and missing scope summary.'
  },
  {
    title: 'Twitch Setup',
    description: 'Bot and broadcaster OAuth status, required scopes, token expiry, and EventSub sync controls.'
  },
  {
    title: 'Apps',
    description: 'Registered downstream apps, API key rotation, webhook URLs, permissions, and test delivery tools.'
  },
  {
    title: 'Text Commands',
    description: 'Static replies such as !dc with aliases, cooldowns, role requirements, usage counts, and tests.'
  },
  {
    title: 'Chat Log',
    description: 'Searchable chat history with command, user, event type, and moderation-marker filters.'
  },
  {
    title: 'Outgoing Messages',
    description: 'Queued, sent, dropped, failed, and dead-lettered outbound chat messages with safe retry actions.'
  },
  {
    title: 'Webhook Deliveries',
    description: 'Delivery status, attempts, response excerpts, retry timing, and dead-letter state for app webhooks.'
  },
  {
    title: 'Channel Points',
    description: 'Reward ownership, synchronization, manageable state, recent redemptions, and delivery status.'
  },
  {
    title: 'Diagnostics',
    description: 'EventSub reconciliation, token refresh, rate limits, queue watchdogs, build metadata, and diagnostic events.'
  },
  {
    title: 'Docs',
    description: 'OpenAPI documentation and integration examples for downstream applications.'
  }
];

function App() {
  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Admin navigation">
        <div className="brand">{gatewayName}</div>
        <nav>
          {pages.map((page) => (
            <a key={page.title} href={`#${page.title.toLowerCase().replaceAll(' ', '-')}`}>
              {page.title}
            </a>
          ))}
        </nav>
      </aside>

      <section className="content">
        <header className="hero">
          <p className="eyebrow">Phase 1 foundation</p>
          <h1>Admin UI shell</h1>
          <p>
            This shell intentionally contains placeholders only. Twitch behavior, app registration,
            queues, and diagnostics are implemented in later phases while the service foundation stays
            module-ready for future integrations such as Discord.
          </p>
        </header>

        <section className="status-card" aria-label="Gateway status summary">
          <span className="status-dot" />
          <div>
            <strong>Gateway shell loaded</strong>
            <p>Use the API health endpoint to verify the process: /api/v1/health/live</p>
          </div>
        </section>

        <section className="grid" aria-label="Placeholder pages">
          {pages.map((page) => (
            <article className="page-card" id={page.title.toLowerCase().replaceAll(' ', '-')} key={page.title}>
              <h2>{page.title}</h2>
              <p>{page.description}</p>
              <span>Placeholder page</span>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
