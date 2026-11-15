/**
 * Global error handler for API
 */

import { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { InstallerError } from '../../shared/errors.js';
import { ZodError } from 'zod';

export function errorHandler(app: FastifyInstance) {
  app.setErrorHandler(async (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    const path = request.url;

    // Zod validation errors
    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        message: 'Validation error',
        errors: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      });
    }

    // Custom installer errors
    if (error instanceof InstallerError) {
      const statusCode = error.statusCode;
      return reply.status(statusCode).send({
        success: false,
        message: error.message,
        code: error.code,
        metadata: error.metadata,
      });
    }

    // Fastify validation errors
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        message: 'Validation error',
        errors: error.validation.map((v) => ({
          field: v.instancePath || v.schemaPath,
          message: v.message,
          code: 'VALIDATION_ERROR',
        })),
      });
    }

    // Unknown errors
    app.log.error({ err: error, requestId, path }, 'Unhandled error');
    return reply.status(500).send({
      success: false,
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });
}