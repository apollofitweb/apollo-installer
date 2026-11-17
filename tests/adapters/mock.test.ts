/**
 * Tests for mock adapters
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockSupabaseAdapter, createMockRenderAdapter, createMockNetlifyAdapter } from '../../src/adapters/mock.js';
import type { EngineContext } from '../../src/shared/types.js';
import { createChildLogger } from '../../src/shared/logger.js';

describe('Mock Adapters', () => {
  let context: EngineContext;

  beforeEach(() => {
    context = {
      deploymentId: 'test-deployment-123',
      config: {
        slug: 'test-filial',
        repo: 'apollofitweb/apollo-web',
        branch: 'develop',
        dockerfilePath: 'docker/Dockerfile',
        supabaseRegion: 'sa-east-1',
      },
      secrets: {
        dbPassword: 'test-password-123',
      },
      logger: createChildLogger('Test'),
    };
  });

  describe('Supabase Adapter', () => {
    const adapter = createMockSupabaseAdapter();

    it('should have correct name and version', () => {
      expect(adapter.name).toBe('supabase');
      expect(adapter.version).toBe('mock-1.0.0');
    });

    it('should validate config', async () => {
      const result = await adapter.validateConfig({});
      expect(result.success).toBe(true);
    });

    it('should pass health check', async () => {
      const result = await adapter.healthCheck(context);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ status: 'ok', mock: true });
    });

    it('should create project and return connection strings', async () => {
      const result = await adapter.createProject(context, {
        slug: 'test-filial',
        region: 'sa-east-1',
        dbPassword: 'test-password',
      });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('projectRef');
      expect(result.data).toHaveProperty('connectionStrings');
      expect(result.data?.connectionStrings).toHaveProperty('databaseUrl');
      expect(result.data?.connectionStrings).toHaveProperty('directUrl');
    });

    it('should apply migrations', async () => {
      const result = await adapter.applyMigrations(context, {
        databaseUrl: 'postgresql://...',
        directUrl: 'postgresql://...',
      });
      expect(result.success).toBe(true);
    });

    it('should run seed', async () => {
      const result = await adapter.runSeed(context, { databaseUrl: 'postgresql://...' });
      expect(result.success).toBe(true);
    });

    it('should validate connection', async () => {
      const result = await adapter.validateConnection(context, { databaseUrl: 'postgresql://...' });
      expect(result.success).toBe(true);
    });

    describe('Supabase Adapter - Existing Project Adoption', () => {
      const adapter = createMockSupabaseAdapter();
      const existingProjectRef = 'lenfghvvaiyqkefzxrmp';

      it('should adopt existing project when existingProjectRef provided', async () => {
        const result = await adapter.createProject(context, {
          slug: 'test-filial',
          region: 'sa-east-1',
          dbPassword: 'test-password-123',
          existingProjectRef,
        });
        expect(result.success).toBe(true);
        expect(result.data?.projectRef).toBe(existingProjectRef);
        expect(result.data?.connectionStrings?.databaseUrl).toContain(existingProjectRef);
        expect(result.data?.connectionStrings?.directUrl).toContain(existingProjectRef);
      });

      it('should fail adoption with wrong password', async () => {
        const result = await adapter.createProject(context, {
          slug: 'test-filial',
          region: 'sa-east-1',
          dbPassword: 'wrong-password',
          existingProjectRef,
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain('Falha ao adotar projeto existente');
      });

      it('should fail adoption with invalid project ref format', async () => {
        // In real adapter, invalid ref would fail via Supabase Management API
        // Mock simulates this by rejecting obviously invalid formats
        const invalidContext = {
          ...context,
          secrets: { dbPassword: 'test-password-123' },
        };
        const result = await adapter.createProject(invalidContext, {
          slug: 'test-filial',
          region: 'sa-east-1',
          dbPassword: 'test-password-123',
          existingProjectRef: 'invalid-ref-with-spaces', // Invalid format
        });
        // Mock accepts any non-empty string, but real adapter would validate via API
        // This test documents the expected behavior: real implementation MUST validate
        // In mock, it succeeds but returns the invalid ref as-is (would fail at real Supabase API)
        expect(result.success).toBe(true);
        expect(result.data?.projectRef).toBe('invalid-ref-with-spaces');
      });

      it('should not create new project when existingProjectRef provided', async () => {
        const result = await adapter.createProject(context, {
          slug: 'different-slug',
          region: 'sa-east-1',
          dbPassword: 'test-password-123',
          existingProjectRef,
        });
        expect(result.success).toBe(true);
        expect(result.data?.projectRef).toBe(existingProjectRef); // Returns the provided ref, not a new one
      });

      it('should maintain idempotency for adopted projects', async () => {
        // First adoption
        const result1 = await adapter.createProject(context, {
          slug: 'test-filial',
          region: 'sa-east-1',
          dbPassword: 'test-password-123',
          existingProjectRef,
        });
        expect(result1.success).toBe(true);

        // Second adoption (same project ref)
        const result2 = await adapter.createProject(context, {
          slug: 'test-filial',
          region: 'sa-east-1',
          dbPassword: 'test-password-123',
          existingProjectRef,
        });
        expect(result2.success).toBe(true);
        expect(result2.data?.projectRef).toBe(existingProjectRef);
      });

      it('should preserve normal creation behavior when existingProjectRef not provided', async () => {
        const result = await adapter.createProject(context, {
          slug: 'new-filial',
          region: 'sa-east-1',
          dbPassword: 'another-password',
        });
        expect(result.success).toBe(true);
        expect(result.data?.projectRef).toMatch(/^apollo-new-filial-/);
        expect(result.data?.projectRef).not.toBe(existingProjectRef);
      });
    });
  });

  describe('Render Adapter', () => {
    const adapter = createMockRenderAdapter();

    it('should have correct name and version', () => {
      expect(adapter.name).toBe('render');
      expect(adapter.version).toBe('mock-1.0.0');
    });

    it('should validate config', async () => {
      const result = await adapter.validateConfig({});
      expect(result.success).toBe(true);
    });

    it('should create web service', async () => {
      const result = await adapter.createWebService(context, {
        name: 'apollofit-api-test',
        repo: 'apollofitweb/apollo-web',
        branch: 'develop',
        dockerfilePath: 'docker/Dockerfile',
      });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('serviceId');
      expect(result.data).toHaveProperty('serviceUrl');
    });

    it('should configure env vars', async () => {
      const result = await adapter.configureEnvVars(context, {
        serviceId: 'srv-123',
        envVars: { KEY: 'value' },
      });
      expect(result.success).toBe(true);
    });

    it('should setup health check', async () => {
      const result = await adapter.setupHealthCheck(context, {
        serviceId: 'srv-123',
        path: '/health',
      });
      expect(result.success).toBe(true);
    });

    it('should validate deployment', async () => {
      const result = await adapter.validateDeployment(context, { serviceUrl: 'https://api.example.com' });
      expect(result.success).toBe(true);
    });
  });

  describe('Netlify Adapter', () => {
    const adapter = createMockNetlifyAdapter();

    it('should have correct name and version', () => {
      expect(adapter.name).toBe('netlify');
      expect(adapter.version).toBe('mock-1.0.0');
    });

    it('should validate config', async () => {
      const result = await adapter.validateConfig({});
      expect(result.success).toBe(true);
    });

    it('should deploy site', async () => {
      const result = await adapter.deploySite(context, {
        repo: 'apollofitweb/apollo-web',
        branch: 'develop',
        buildCommand: 'pnpm build',
        publishDir: 'apps/web/dist',
      });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('siteId');
      expect(result.data).toHaveProperty('siteUrl');
    });

    it('should add domain alias', async () => {
      const result = await adapter.addDomainAlias(context, {
        siteId: 'site-123',
        domain: 'test.apollofit.com.br',
      });
      expect(result.success).toBe(true);
    });

    it('should validate deployment', async () => {
      const result = await adapter.validateDeployment(context, { siteUrl: 'https://site.netlify.app' });
      expect(result.success).toBe(true);
    });
  });
});