/**
 * Swagger/OpenAPI documentation plugin
 */

import { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';

export async function swaggerPlugin(app: FastifyInstance) {
  await app.register(import('@fastify/swagger'), {
    openapi: {
      info: {
        title: 'Apollo Installer API',
        description: 'API para Instalador Automatizado de Novas Filiais Apollo Fit',
        version: '0.1.0',
      },
      servers: [{ url: env.publicApiUrl, description: 'Current environment' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await app.register(import('@fastify/swagger-ui'), {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
}