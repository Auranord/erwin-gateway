import type { FastifyInstance } from 'fastify';
import { buildOpenApiDocument } from './openapi.js';

const swaggerUiVersion = '5.17.14';

export async function registerDocsRoutes(app: FastifyInstance) {
  app.get('/openapi.json', async (_request, reply) => reply.send(buildOpenApiDocument()));

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
