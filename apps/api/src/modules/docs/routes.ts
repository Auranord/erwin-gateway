import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildOpenApiDocument } from './openapi.js';

const swaggerUiVersion = '5.17.14';

const markdownDocs = {
  'README.integration.md': 'README.integration.md',
  'README.migration-erwin-music.md': 'README.migration-erwin-music.md',
  'README.migration-erwin-hatchery.md': 'README.migration-erwin-hatchery.md'
} as const;

export async function registerDocsRoutes(app: FastifyInstance) {
  app.get('/openapi.json', async (_request, reply) => reply.send(buildOpenApiDocument()));

  app.get<{ Params: { fileName: keyof typeof markdownDocs } }>('/docs/:fileName', async (request, reply) => {
    const docFile = markdownDocs[request.params.fileName];
    if (!docFile) {
      return reply.code(404).send({ error: 'Documentation file not found' });
    }

    try {
      const docPath = path.resolve(process.cwd(), 'docs', docFile);
      const contents = await fs.readFile(docPath, 'utf8');
      return reply.type('text/markdown; charset=utf-8').send(contents);
    } catch (error) {
      request.log.warn({ err: error, docFile }, 'failed to serve documentation file');
      return reply.code(404).send({ error: 'Documentation file not found' });
    }
  });

  app.get('/docs', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>erwin-gateway API docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${swaggerUiVersion}/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@${swaggerUiVersion}/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true, displayRequestDuration: true });
  </script>
</body>
</html>`)
  );
}
