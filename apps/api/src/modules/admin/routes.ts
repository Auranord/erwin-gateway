import type { FastifyInstance } from 'fastify';

const adminPages = [
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

export async function registerAdminApiRoutes(app: FastifyInstance) {
  app.get('/api/admin/shell', async () => ({
    service: 'erwin-gateway',
    phase: 'phase-1-foundation',
    pages: adminPages,
    message: 'Admin UI shell is available. Operational data arrives in later phases.'
  }));
}
