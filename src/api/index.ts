/**
 * Apollo Installer API - Main entry point
 */

import 'dotenv/config';
import Fastify from 'fastify';
import { FastifyRequest, FastifyReply } from 'fastify';
import { connectDatabase, disconnectDatabase } from '../persistence/prisma.js';
import { env } from '../config/env.js';
import { requestLogger, swaggerPlugin, authPlugin, globalAuthHook, errorHandler } from './plugins/index.js';
import { deploymentRoutes } from './routes/deployments.js';
import { healthRoutes } from './routes/health.js';
import { logger } from '../shared/logger.js';

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
  await app.register(authPlugin);
  if (env.nodeEnv !== 'production') {
    await app.register(swaggerPlugin);
  }

  console.log('[buildApp] After authPlugin, preHandler hooks:', Object.keys((app as any).hooks || {}).join(', '));

  // Routes
  await app.register(healthRoutes);
  await app.register(deploymentRoutes, { prefix: '/api' });

  console.log('[buildApp] After deploymentRoutes, preHandler hooks:', Object.keys((app as any).hooks || {}).join(', '));

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

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export { buildApp, start };