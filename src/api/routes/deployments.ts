/**
 * Deployment API routes
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deploymentRepository } from '../../persistence/deployment.repository.js';
import { validateFilialInput } from '../../config/validation.js';
import { createDeploymentEngine, createProductionDeploymentEngine } from '../../engine/deployment-engine.js';
import { createSecretStore } from '../../secrets/index.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { requireSecretManagement } from '../plugins/auth.js';
import { prisma } from '../../persistence/prisma.js';
import { env } from '../../config/env.js';

const createDeploymentSchema = z.object({
  slug: z.string().min(2).max(50),
  name: z.string().min(2).max(100),
  domain: z.string().max(255).optional(),
  adminEmail: z.string().email().max(255),
  adminName: z.string().min(2).max(100),
  adminPassword: z.string().min(8).max(128).optional(),
  customDomain: z.boolean().optional(),
  mercadoPagoEnabled: z.boolean().optional(),
  mercadoPagoMode: z.enum(['sandbox', 'production']).optional(),
  smtpConfig: z
    .object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      user: z.string().min(1),
      pass: z.string().min(1),
      from: z.string().email(),
    })
    .optional(),
  // Operational config for deployment
  repo: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  dockerfilePath: z.string().min(1).optional(),
  publicApiUrl: z.string().url().optional(),
});

const updateConfigSchema = z.object({
  supabaseRegion: z.string().min(1).optional(),
  supabaseProjectRef: z.string().min(1).optional(),
  renderServiceId: z.string().min(1).optional(),
  netlifySiteId: z.string().min(1).optional(),
  netlifyDomain: z.string().min(1).optional(),
  customDomain: z.string().min(1).optional(),
  allowedOrigins: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  dockerfilePath: z.string().min(1).optional(),
  publicApiUrl: z.string().url().optional(),
  mercadoPagoEnabled: z.boolean().optional(),
  mercadoPagoMode: z.enum(['sandbox', 'production']).optional(),
  smtpHost: z.string().min(1).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().min(1).optional(),
  smtpPass: z.string().min(1).optional(),
  smtpFrom: z.string().email().optional(),
});

// Secret schemas
const setDeploymentSecretSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().min(1),
  expectedVersion: z.number().int().min(0).optional(),
});

const setGlobalSecretSchema = z.object({
  key: z.enum(['netlify.siteId', 'netlify.authToken', 'installer.jwtSigningSecret']),
  value: z.string().min(1),
  expectedVersion: z.number().int().min(0).optional(),
});

const deleteSecretSchema = z.object({
  expectedVersion: z.number().int().min(0),
});

export async function deploymentRoutes(app: FastifyInstance) {
  // Helper to create the appropriate engine based on environment
  const createEngine = async () => {
    if (env.isProduction) {
      return createProductionDeploymentEngine(prisma);
    }
    return createDeploymentEngine();
  };

  // Test route for preHandler
  app.get('/test-prehandler', { preHandler: requireSecretManagement }, async (request, reply) => {
    return { success: true, message: 'PreHandler worked!' };
  });
  // Create new deployment
  app.post<{ Body: z.infer<typeof createDeploymentSchema> }>(
    '/deployments',
    {
      schema: {
        body: {
          type: 'object',
          required: ['slug', 'name', 'adminEmail', 'adminName'],
          properties: {
            slug: { type: 'string', minLength: 2, maxLength: 50 },
            name: { type: 'string', minLength: 2, maxLength: 100 },
            domain: { type: 'string', maxLength: 255 },
            adminEmail: { type: 'string', format: 'email', maxLength: 255 },
            adminName: { type: 'string', minLength: 2, maxLength: 100 },
            adminPassword: { type: 'string', minLength: 8, maxLength: 128 },
            customDomain: { type: 'boolean' },
            mercadoPagoEnabled: { type: 'boolean' },
            mercadoPagoMode: { type: 'string', enum: ['sandbox', 'production'] },
            smtpConfig: {
              type: 'object',
              properties: {
                host: { type: 'string' },
                port: { type: 'integer', minimum: 1, maximum: 65535 },
                user: { type: 'string' },
                pass: { type: 'string' },
                from: { type: 'string', format: 'email' },
              },
            },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  slug: { type: 'string' },
                  status: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const validation = validateFilialInput(request.body);
      if (!validation.valid) {
        return reply.status(400).send({ success: false, errors: validation.errors });
      }

      const existing = await deploymentRepository.findBySlug(request.body.slug);
      if (existing) {
        throw new ConflictError('Slug already in use', 'slug', request.body.slug);
      }

      const deployment = await deploymentRepository.create({
        slug: request.body.slug,
        name: request.body.name,
        domain: request.body.domain,
        adminEmail: request.body.adminEmail,
        adminName: request.body.adminName,
      });

      // Store operational config if provided
      const { repo, branch, dockerfilePath, publicApiUrl, ..._rest } = request.body;
      if (repo || branch || dockerfilePath || publicApiUrl) {
        await deploymentRepository.createConfig(deployment.id, {
          repo: repo ?? 'apollofitweb/apollo-web',
          branch: branch ?? 'develop',
          dockerfilePath: dockerfilePath ?? 'docker/Dockerfile',
          publicApiUrl: publicApiUrl ?? `https://api.${request.body.slug}.apollofit.com.br`,
        });
      }

      return reply.status(201).send({
        success: true,
        data: { id: deployment.id, slug: deployment.slug, status: deployment.status },
      });
    }
  );

  // List all deployments
  app.get('/deployments', async (_request, reply) => {
    const deployments = await deploymentRepository.findAll();
    return reply.send({
      success: true,
      data: deployments.map((d) => ({
        id: d.id,
        slug: d.slug,
        name: d.name,
        domain: d.domain,
        adminEmail: d.adminEmail,
        status: d.status,
        currentStep: d.currentStep,
        totalSteps: d.totalSteps,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        completedAt: d.completedAt,
      })),
    });
  });

  // Get deployment by ID
  app.get<{ Params: { id: string } }>('/deployments/:id', async (request, reply) => {
    const deployment = await deploymentRepository.findById(request.params.id);
    if (!deployment) {
      throw new NotFoundError('Deployment', request.params.id);
    }
    return reply.send({ success: true, data: deployment });
  });

  // Get deployment by slug
  app.get<{ Params: { slug: string } }>('/deployments/slug/:slug', async (request, reply) => {
    const deployment = await deploymentRepository.findBySlug(request.params.slug);
    if (!deployment) {
      throw new NotFoundError('Deployment', request.params.slug);
    }
    return reply.send({ success: true, data: deployment });
  });

  // Start deployment
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/deployments/:id/start', async (request, reply) => {
    const deployment = await deploymentRepository.findById(request.params.id);
    if (!deployment) {
      throw new NotFoundError('Deployment', request.params.id);
    }

    const engine = await createEngine();
    await engine.startDeployment(deployment.id, request.body ?? {});

    return reply.send({ success: true, message: 'Deployment started' });
  });

  // Resume deployment
  app.post<{ Params: { id: string } }>('/deployments/:id/resume', async (request, reply) => {
    const deployment = await deploymentRepository.findById(request.params.id);
    if (!deployment) {
      throw new NotFoundError('Deployment', request.params.id);
    }

    const engine = await createEngine();
    await engine.resumeDeployment(deployment.id);

    return reply.send({ success: true, message: 'Deployment resumed' });
  });

  // Update deployment config
  app.patch<{ Params: { id: string }; Body: z.infer<typeof updateConfigSchema> }>(
    '/deployments/:id/config',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            supabaseRegion: { type: 'string' },
            supabaseProjectRef: { type: 'string' },
            renderServiceId: { type: 'string' },
            netlifySiteId: { type: 'string' },
            netlifyDomain: { type: 'string' },
            customDomain: { type: 'string' },
            jwtAccessSecret: { type: 'string', minLength: 32 },
            jwtRefreshSecret: { type: 'string', minLength: 32 },
            allowedOrigins: { type: 'string' },
            repo: { type: 'string' },
            branch: { type: 'string' },
            dockerfilePath: { type: 'string' },
            publicApiUrl: { type: 'string', format: 'uri' },
            mercadoPagoEnabled: { type: 'boolean' },
            mercadoPagoMode: { type: 'string', enum: ['sandbox', 'production'] },
            smtpHost: { type: 'string' },
            smtpPort: { type: 'integer', minimum: 1, maximum: 65535 },
            smtpUser: { type: 'string' },
            smtpPass: { type: 'string' },
            smtpFrom: { type: 'string', format: 'email' },
          },
        },
      },
    },
    async (request, reply) => {
      const deployment = await deploymentRepository.findById(request.params.id);
      if (!deployment) {
        throw new NotFoundError('Deployment', request.params.id);
      }

      const config = await deploymentRepository.updateConfig(request.params.id, request.body);
      return reply.send({ success: true, data: config });
    }
  );

  // Delete deployment
  app.delete<{ Params: { id: string } }>('/deployments/:id', async (request, reply) => {
    const deployment = await deploymentRepository.findById(request.params.id);
    if (!deployment) {
      throw new NotFoundError('Deployment', request.params.id);
    }

    await deploymentRepository.delete(deployment.id);
    return reply.send({ success: true, message: 'Deployment deleted' });
  });

  // ===== SECRET PROVISIONING API =====
  // All secret routes require authentication and secret management role (admin/operator)

  // Deployment-scoped secrets

  // Set deployment secret
  app.post<{ Params: { id: string }; Body: z.infer<typeof setDeploymentSecretSchema> }>(
    '/deployments/:id/secrets',
    {
      schema: {
        body: {
          type: 'object',
          required: ['key', 'value'],
          properties: {
            key: { type: 'string', minLength: 1, maxLength: 100 },
            value: { type: 'string', minLength: 1 },
            expectedVersion: { type: 'integer', minimum: 0 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  version: { type: 'integer' },
                  updatedAt: { type: 'string' },
                  updatedBy: { type: 'string' },
                  deleted: { type: 'boolean' },
                },
              },
            },
          },
          409: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { type: 'string' },
            },
          },
        },
      },
      preHandler: requireSecretManagement,
    },
    async (request, reply) => {
      const deployment = await deploymentRepository.findById(request.params.id);
      if (!deployment) {
        throw new NotFoundError('Deployment', request.params.id);
      }

      const secretStore = createSecretStore();
      try {
        const metadata = await secretStore.set(
          deployment.id,
          'deployment',
          request.body.key,
          request.body.value,
          request.body.expectedVersion ?? 0
        );
        return reply.send({ success: true, data: metadata });
      } catch (error) {
        if (error instanceof Error && error.name === 'SecretVersionConflictError') {
          return reply.status(409).send({ success: false, error: error.message });
        }
        throw error;
      }
    }
  );

  // Get deployment secret (value)
  app.get<{ Params: { id: string; key: string } }>(
    '/deployments/:id/secrets/:key',
    { preHandler: requireSecretManagement },
    async (request, reply) => {
      const deployment = await deploymentRepository.findById(request.params.id);
      if (!deployment) {
        throw new NotFoundError('Deployment', request.params.id);
      }

      const secretStore = createSecretStore();
      const value = await secretStore.get(deployment.id, 'deployment', request.params.key);
      if (value === null) {
        return reply.status(404).send({ success: false, error: 'Secret not found' });
      }
      return reply.send({ success: true, data: { value } });
    }
  );

  // Get deployment secret metadata (no value)
  app.get<{ Params: { id: string; key: string } }>(
    '/deployments/:id/secrets/:key/meta',
    { preHandler: requireSecretManagement },
    async (request, reply) => {
      const deployment = await deploymentRepository.findById(request.params.id);
      if (!deployment) {
        throw new NotFoundError('Deployment', request.params.id);
      }

      const secretStore = createSecretStore();
      const list = await secretStore.list(deployment.id, 'deployment');
      const meta = list[request.params.key];
      if (!meta) {
        return reply.status(404).send({ success: false, error: 'Secret not found' });
      }
      return reply.send({ success: true, data: meta });
    }
  );

  // List deployment secrets (metadata only)
  app.get<{ Params: { id: string } }>(
    '/deployments/:id/secrets',
    { preHandler: requireSecretManagement },
    async (request, reply) => {
      const deployment = await deploymentRepository.findById(request.params.id);
      if (!deployment) {
        throw new NotFoundError('Deployment', request.params.id);
      }

      const secretStore = createSecretStore();
      const list = await secretStore.list(deployment.id, 'deployment');
      return reply.send({ success: true, data: list });
    }
  );

  // Delete deployment secret
  app.delete<{ Params: { id: string; key: string }; Body: z.infer<typeof deleteSecretSchema> }>(
    '/deployments/:id/secrets/:key',
    {
      schema: {
        body: {
          type: 'object',
          required: ['expectedVersion'],
          properties: {
            expectedVersion: { type: 'integer', minimum: 0 },
          },
        },
        response: {
          200: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } },
          409: { type: 'object', properties: { success: { type: 'boolean', const: false }, error: { type: 'string' } } },
        },
      },
      preHandler: requireSecretManagement,
    },
    async (request, reply) => {
      const deployment = await deploymentRepository.findById(request.params.id);
      if (!deployment) {
        throw new NotFoundError('Deployment', request.params.id);
      }

      const secretStore = createSecretStore();
      try {
        await secretStore.delete(deployment.id, 'deployment', request.params.key, request.body.expectedVersion);
        return reply.send({ success: true, message: 'Secret deleted (tombstone created)' });
      } catch (error) {
        if (error instanceof Error && error.name === 'SecretVersionConflictError') {
          return reply.status(409).send({ success: false, error: error.message });
        }
        throw error;
      }
    }
  );

  // ===== GLOBAL-SCOPED SECRETS (ALLOWLIST ONLY) =====

  // Set global secret
  app.post<{ Body: z.infer<typeof setGlobalSecretSchema> }>(
    '/secrets/global',
    {
      schema: {
        body: {
          type: 'object',
          required: ['key', 'value'],
          properties: {
            key: { type: 'string', enum: ['netlify.siteId', 'netlify.authToken', 'installer.jwtSigningSecret'] },
            value: { type: 'string', minLength: 1 },
            expectedVersion: { type: 'integer', minimum: 0 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  version: { type: 'integer' },
                  updatedAt: { type: 'string' },
                  updatedBy: { type: 'string' },
                  deleted: { type: 'boolean' },
                },
              },
            },
          },
          400: { type: 'object', properties: { success: { type: 'boolean', const: false }, error: { type: 'string' } } },
          409: { type: 'object', properties: { success: { type: 'boolean', const: false }, error: { type: 'string' } } },
        },
      },
      preHandler: requireSecretManagement,
    },
    async (request, reply) => {
      const secretStore = createSecretStore();
      try {
        const metadata = await secretStore.setGlobal(
          'global',
          request.body.key as 'netlify.siteId' | 'netlify.authToken' | 'installer.jwtSigningSecret',
          request.body.value,
          request.body.expectedVersion ?? 0
        );
        return reply.send({ success: true, data: metadata });
      } catch (error) {
        if (error instanceof Error && error.name === 'SecretVersionConflictError') {
          return reply.status(409).send({ success: false, error: error.message });
        }
        if (error instanceof Error && error.message.includes('allowlist')) {
          return reply.status(400).send({ success: false, error: error.message });
        }
        throw error;
      }
    }
  );

  // Get global secret (value)
  app.get<{ Params: { key: string } }>(
    '/secrets/global/:key',
    { preHandler: requireSecretManagement },
    async (request, reply) => {
      const secretStore = createSecretStore();
      const allowedKeys = ['netlify.siteId', 'netlify.authToken', 'installer.jwtSigningSecret'] as const;
      if (!allowedKeys.includes(request.params.key as any)) {
        return reply.status(400).send({ success: false, error: 'Invalid global key' });
      }

      const value = await secretStore.getGlobal('global', request.params.key as 'netlify.siteId' | 'netlify.authToken' | 'installer.jwtSigningSecret');
      if (value === null) {
        return reply.status(404).send({ success: false, error: 'Secret not found' });
      }
      return reply.send({ success: true, data: { value } });
    }
  );

  // Get global secret metadata (no value)
  app.get<{ Params: { key: string } }>(
    '/secrets/global/:key/meta',
    { preHandler: requireSecretManagement },
    async (request, reply) => {
      const secretStore = createSecretStore();
      const allowedKeys = ['netlify.siteId', 'netlify.authToken', 'installer.jwtSigningSecret'] as const;
      if (!allowedKeys.includes(request.params.key as any)) {
        return reply.status(400).send({ success: false, error: 'Invalid global key' });
      }

      const list = await secretStore.listGlobal('global');
      const meta = list[request.params.key];
      if (!meta) {
        return reply.status(404).send({ success: false, error: 'Secret not found' });
      }
      return reply.send({ success: true, data: meta });
    }
  );

  // List global secrets (metadata only)
  app.get(
    '/secrets/global',
    { preHandler: requireSecretManagement },
    async (_request, reply) => {
      const secretStore = createSecretStore();
      const list = await secretStore.listGlobal('global');
      return reply.send({ success: true, data: list });
    }
  );

  // Delete global secret
  app.delete<{ Params: { key: string }; Body: z.infer<typeof deleteSecretSchema> }>(
    '/secrets/global/:key',
    {
      schema: {
        body: {
          type: 'object',
          required: ['expectedVersion'],
          properties: {
            expectedVersion: { type: 'integer', minimum: 0 },
          },
        },
        response: {
          200: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } },
          409: { type: 'object', properties: { success: { type: 'boolean', const: false }, error: { type: 'string' } } },
        },
      },
      preHandler: requireSecretManagement,
    },
    async (request, reply) => {
      const secretStore = createSecretStore();
      const allowedKeys = ['netlify.siteId', 'netlify.authToken', 'installer.jwtSigningSecret'] as const;
      if (!allowedKeys.includes(request.params.key as any)) {
        return reply.status(400).send({ success: false, error: 'Invalid global key' });
      }

      try {
        await secretStore.deleteGlobal('global', request.params.key as 'netlify.siteId' | 'netlify.authToken' | 'installer.jwtSigningSecret', request.body.expectedVersion);
        return reply.send({ success: true, message: 'Global secret deleted (tombstone created)' });
      } catch (error) {
        if (error instanceof Error && error.name === 'SecretVersionConflictError') {
          return reply.status(409).send({ success: false, error: error.message });
        }
        throw error;
      }
    }
  );
}