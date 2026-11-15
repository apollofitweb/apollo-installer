/**
 * Health check routes
 */

import { FastifyInstance } from 'fastify';
import { connectDatabase } from '../../persistence/prisma.js';
import { env } from '../../config/env.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    try {
      await connectDatabase();
      // Simple query to verify connection
      // await prisma.$queryRaw`SELECT 1`;

      return reply.send({
        status: 'ok',
        service: 'apollo-installer',
        version: '0.1.0',
        environment: env.nodeEnv,
        database: 'connected',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return reply.status(503).send({
        status: 'error',
        service: 'apollo-installer',
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/health/ready', async (_request, reply) => {
    return reply.send({
      ready: true,
      service: 'apollo-installer',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/health/live', async (_request, reply) => {
    return reply.send({
      alive: true,
      service: 'apollo-installer',
      timestamp: new Date().toISOString(),
    });
  });
}