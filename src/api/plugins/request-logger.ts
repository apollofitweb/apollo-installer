/**
 * Request logger plugin
 */

import { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
  }
}

export async function requestLogger(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    request.startTime = Date.now();
    request.log.info({ method: request.method, url: request.url }, 'Request started');
  });

  app.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - (request.startTime ?? Date.now());
    request.log.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode, durationMs: duration },
      'Request completed'
    );
  });
}