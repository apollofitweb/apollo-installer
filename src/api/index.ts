/**
 * Apollo Installer API - Main entry point
 */

import 'dotenv/config';
import Fastify from 'fastify';
import { FastifyRequest, FastifyReply } from 'fastify';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { connectDatabase, disconnectDatabase } from '../persistence/prisma.js';
import { env } from '../config/env.js';
import { requestLogger, swaggerPlugin, authPlugin, globalAuthHook, errorHandler, corsPlugin } from './plugins/index.js';
import { deploymentRoutes } from './routes/deployments.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { logger } from '../shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ADMIN_DIST_PATH = join(__dirname, '..', '..', 'dist', 'admin');

async function buildApp() {
  const app = Fastify({
    logger: true,
    ajv: { customOptions: { removeAdditional: 'all' } },
  });

  // Set error handler on root app
  errorHandler(app);

  // Add global auth hook
  app.addHook('preHandler', globalAuthHook);

  // Plugins
  await app.register(requestLogger);
  await app.register(corsPlugin);
  await app.register(authPlugin);
  if (env.nodeEnv !== 'production') {
    await app.register(swaggerPlugin);
  }

  // Routes
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(deploymentRoutes, { prefix: '/api' });

  // Serve Admin UI static files in production
  if (env.nodeEnv === 'production') {
    await app.register(import('@fastify/static'), {
      root: ADMIN_DIST_PATH,
      prefix: '/',
    });

    // SPA fallback - serve index.html for non-API routes
    app.setNotFoundHandler(async (request, reply) => {
      // Only serve SPA for non-API routes
      if (!request.url.startsWith('/api/') && !request.url.startsWith('/docs')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Not found' });
    });
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await app.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return app;
}

async function start() {
  try {
    await connectDatabase();
    const app = await buildApp();
    await app.listen({ port: env.port, host: '0.0.0.0' });
    logger.info(`Apollo Installer API running on port ${env.port}`);
    logger.info(`Environment: ${env.nodeEnv}`);
    logger.info(`Swagger docs: ${env.publicApiUrl}/docs`);
  } catch (error) {
    logger.error('Failed to start server', { error: error instanceof Error ? error.message : 'Unknown' });
    await disconnectDatabase();
    process.exit(1);
  }
}

// Cross-platform "is this the entrypoint?" check (Windows paths differ from file:// URLs)
const entrypoint = process.argv[1] ? resolve(process.argv[1]) : '';
const currentModule = fileURLToPath(import.meta.url);
if (entrypoint && resolve(currentModule).toLowerCase() === entrypoint.toLowerCase()) {
  start();
}

export { buildApp, start };