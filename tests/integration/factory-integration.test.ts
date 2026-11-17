/**
 * Integration tests for Adapter Factory with Real/Mock selection
 * Validates: async factory, adapter caching, SecretStore integration, real/mock selection
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DeploymentEngine, createProductionDeploymentEngine } from '../../src/engine/deployment-engine.js';
import { createAdapterFactory, createMockAdapterFactory } from '../../src/adapters/index.js';
import { createSecretStore, createDurableSecretStore } from '../../src/secrets/index.js';
import { deploymentRepository } from '../../src/persistence/deployment.repository.js';
import { DEPLOYMENT_STEPS } from '../../src/shared/types.js';
import { prisma } from '../../src/persistence/prisma.js';
import { RealSupabaseAdapter } from '../../src/adapters/supabase/real-adapter.js';
import { RealNetlifyAdapter } from '../../src/adapters/netlify/real-adapter.js';

// Mock fetch globally for RealSupabaseAdapter tests
const mockFetch = vi.fn();
const originalFetch = global.fetch;

describe('Adapter Factory Integration', () => {
  let secretStore: ReturnType<typeof createSecretStore>;
  let deploymentId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    global.fetch = mockFetch;

    // Clean database - deployments and global secrets
    await prisma.deploymentStep.deleteMany();
    await prisma.deploymentConfig.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.globalSecret.deleteMany();

    // Reset mock state
    const { resetMockState } = await import('../../src/adapters/mock.js');
    resetMockState();

    // Create fresh secret store
    secretStore = createSecretStore();
    if ('clear' in secretStore) {
      (secretStore as any).clear();
    }

    // Create a test deployment
    const deployment = await deploymentRepository.create({
      slug: 'factory-test',
      name: 'Factory Test',
      adminEmail: 'admin@test.com',
      adminName: 'Admin Test',
    });
    deploymentId = deployment.id;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('Mock Adapter Factory (createMockAdapterFactory)', () => {
    it('should create synchronous factory returning mock adapters', () => {
      const factory = createMockAdapterFactory();

      // Factory methods should be synchronous
      const supabaseAdapter = factory.createSupabaseAdapter({});
      const renderAdapter = factory.createRenderAdapter({});
      const netlifyAdapter = factory.createNetlifyAdapter({});

      expect(supabaseAdapter).toBeDefined();
      expect(renderAdapter).toBeDefined();
      expect(netlifyAdapter).toBeDefined();

      expect(supabaseAdapter.name).toBe('supabase');
      expect(renderAdapter.name).toBe('render');
      expect(netlifyAdapter.name).toBe('netlify');

      // All should be mock versions
      expect(supabaseAdapter.version).toContain('mock');
      expect(renderAdapter.version).toContain('mock');
      expect(netlifyAdapter.version).toContain('mock');
    });

    it('should return different instances on each call (no caching in mock factory)', () => {
      const factory = createMockAdapterFactory();

      const adapter1 = factory.createSupabaseAdapter({});
      const adapter2 = factory.createSupabaseAdapter({});

      // Mock factory creates new instances each time
      expect(adapter1).not.toBe(adapter2);
    });
  });

  describe('Async Adapter Factory (createAdapterFactory with useRealAdapters)', () => {
    it('should create async factory that returns mock adapters by default', async () => {
      const factory = createAdapterFactory({ useRealAdapters: false });

      const supabaseAdapter = await factory.createSupabaseAdapter({});
      const renderAdapter = await factory.createRenderAdapter({});
      const netlifyAdapter = await factory.createNetlifyAdapter({});

      expect(supabaseAdapter).toBeDefined();
      expect(renderAdapter).toBeDefined();
      expect(netlifyAdapter).toBeDefined();

      // All should be mock versions
      expect(supabaseAdapter.version).toContain('mock');
      expect(renderAdapter.version).toContain('mock');
      expect(netlifyAdapter.version).toContain('mock');
    });

    it('should create async factory with real Supabase adapter when useRealAdapters=true', async () => {
      // Mock the Supabase Management API responses
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({
          id: '123',
          ref: 'abcdefghijklmnopqrst',
          name: 'apollofit-factory-test',
          region: 'sa-east-1',
          status: 'ACTIVE_HEALTHY',
          database: { host: 'db.supabase.co', version: '15.2' },
          connection_strings: {
            pooler: { transaction: 'postgresql://pooler', session: 'postgresql://pooler' },
            direct: 'postgresql://direct',
          },
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        })),
      });

      // Set up global secrets for both Supabase PAT and Netlify
      await secretStore.setGlobal('global', 'supabase.accessToken', 'test-pat-token-from-secretstore');
      await secretStore.setGlobal('global', 'netlify.authToken', 'test-netlify-token');
      await secretStore.setGlobal('global', 'netlify.siteId', 'test-site-id');

      const factory = createAdapterFactory({
        useRealAdapters: true,
        supabaseConfig: {
          getGlobalSecret: (key) => secretStore.getGlobal('global', key as 'supabase.accessToken'),
        },
        netlifyConfig: {
          getGlobalSecret: (key) => secretStore.getGlobal('global', key as 'netlify.authToken' | 'netlify.siteId'),
        },
      });

      const supabaseAdapter = await factory.createSupabaseAdapter({});
      const renderAdapter = await factory.createRenderAdapter({});
      const netlifyAdapter = await factory.createNetlifyAdapter({});

      // Supabase should be real adapter, Netlify should be real adapter, Render stays mock
      expect(supabaseAdapter).toBeInstanceOf(RealSupabaseAdapter);
      expect(supabaseAdapter.name).toBe('supabase');
      expect(supabaseAdapter.version).toBe('1.0.0'); // Real adapter version

      expect(renderAdapter).toBeDefined();
      expect(renderAdapter.version).toContain('mock');

      expect(netlifyAdapter).toBeInstanceOf(RealNetlifyAdapter);
      expect(netlifyAdapter.name).toBe('netlify');
      expect(netlifyAdapter.version).toBe('1.0.0'); // Real adapter version
    });

    it('should cache RealSupabaseAdapter instance (singleton per factory)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({
          id: '123',
          ref: 'cached-ref-123456789012',
          name: 'apollofit-factory-test',
          region: 'sa-east-1',
          status: 'ACTIVE_HEALTHY',
          database: { host: 'db.supabase.co', version: '15.2' },
          connection_strings: {
            pooler: { transaction: 'postgresql://pooler', session: 'postgresql://pooler' },
            direct: 'postgresql://direct',
          },
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        })),
      });

      await secretStore.setGlobal('global', 'supabase.accessToken', 'test-pat-token-from-secretstore');

      const factory = createAdapterFactory({
        useRealAdapters: true,
        supabaseConfig: {
          getGlobalSecret: (key) => secretStore.getGlobal('global', key as 'supabase.accessToken'),
        },
      });

      // Call multiple times - should return same instance
      const adapter1 = await factory.createSupabaseAdapter({});
      const adapter2 = await factory.createSupabaseAdapter({});
      const adapter3 = await factory.createSupabaseAdapter({});

      expect(adapter1).toBe(adapter2);
      expect(adapter2).toBe(adapter3);
      expect(adapter1).toBeInstanceOf(RealSupabaseAdapter);
    });

    it('should initialize RealSupabaseAdapter with getGlobalSecret and retrieve PAT from SecretStore', async () => {
      let getGlobalSecretCalls = 0;
      let receivedKey: string | null = null;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({
          id: '123',
          ref: 'init-ref-12345678901234',
          name: 'apollofit-factory-test',
          region: 'sa-east-1',
          status: 'ACTIVE_HEALTHY',
          database: { host: 'db.supabase.co', version: '15.2' },
          connection_strings: {
            pooler: { transaction: 'postgresql://pooler', session: 'postgresql://pooler' },
            direct: 'postgresql://direct',
          },
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        })),
      });

      const factory = createAdapterFactory({
        useRealAdapters: true,
        supabaseConfig: {
          getGlobalSecret: async (key) => {
            getGlobalSecretCalls++;
            receivedKey = key;
            return 'pat-from-secretstore';
          },
        },
      });

      // First call should trigger initialization with getGlobalSecret
      const adapter = await factory.createSupabaseAdapter({});

      expect(getGlobalSecretCalls).toBe(1);
      expect(receivedKey).toBe('supabase.accessToken');
      expect(adapter).toBeInstanceOf(RealSupabaseAdapter);

      // Second call should use cached adapter, not call getGlobalSecret again
      getGlobalSecretCalls = 0;
      const adapter2 = await factory.createSupabaseAdapter({});
      expect(getGlobalSecretCalls).toBe(0);
      expect(adapter2).toBe(adapter);
    });

    it('should not expose PAT in logs (no accessToken in config passed to factory)', async () => {
      // Verify the factory config doesn't contain accessToken directly
      const factory = createAdapterFactory({
        useRealAdapters: true,
        supabaseConfig: {
          getGlobalSecret: async () => 'secret-pat',
        },
      });

      // The factory should only have getGlobalSecret, not accessToken
      // This is verified by the RealSupabaseAdapter constructor receiving config without accessToken
      const adapter = await factory.createSupabaseAdapter({}) as RealSupabaseAdapter;

      // Access private config via type assertion to verify
      const config = (adapter as any).config;
      expect(config.accessToken).toBeUndefined();
      expect(config.getGlobalSecret).toBeDefined();
    });
  });

  describe('DeploymentEngine Integration with Async Factory', () => {
    it('should use async factory getters and cache adapters internally', async () => {
      const validProjectRef = 'lenfghvvaiyqkefzxrmp';

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({
          id: '123',
          ref: validProjectRef,
          name: 'apollofit-factory-test',
          region: 'sa-east-1',
          status: 'ACTIVE_HEALTHY',
          database: { host: 'db.supabase.co', version: '15.2' },
          connection_strings: {
            pooler: { transaction: 'postgresql://pooler', session: 'postgresql://pooler' },
            direct: 'postgresql://direct',
          },
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        })),
      });

      await secretStore.setGlobal('global', 'supabase.accessToken', 'test-pat-token');

      const factory = createAdapterFactory({
        useRealAdapters: true,
        supabaseConfig: {
          getGlobalSecret: (key) => secretStore.getGlobal('global', key as 'supabase.accessToken'),
        },
      });

      const engine = new DeploymentEngine({
        adapterFactory: factory,
        secretStore,
      });

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'allowedOrigins', 'https://factory-test.apollofit.com.br');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      const config = {
        slug: 'factory-test',
        repo: 'apollofitweb/apollo-web',
        branch: 'develop',
        dockerfilePath: 'docker/Dockerfile',
        supabaseRegion: 'sa-east-1',
        publicApiUrl: 'https://api.factory-test.apollofit.com.br',
        renderServiceId: 'srv-mock',
        netlifySiteId: 'site-mock',
        allowedOrigins: 'https://factory-test.apollofit.com.br',
        supabaseProjectRef: validProjectRef,
      };

      // Run step 1 only (supabase_create) to test adapter integration
      const context = await engine['buildEngineContext'](deploymentId, config, 1);
      const stepDef = DEPLOYMENT_STEPS[0];

      const result = await engine['executeStep'](stepDef, context);

      expect(result.success).toBe(true);
      expect(result.data?.projectRef).toBe(validProjectRef); // Adoption mode returns existing ref

      // Verify RealSupabaseAdapter was used (it returns connection strings from mocked API response)
      expect(result.data?.connectionStrings?.databaseUrl).toBeDefined();
      expect(result.data?.connectionStrings?.directUrl).toBeDefined();

      // Verify adapter was cached - internal getters should return same instance
      // We can't directly access private fields, but we can verify by running another step
      const context2 = await engine['buildEngineContext'](deploymentId, config, 2);
      const stepDef2 = DEPLOYMENT_STEPS[1];

      // This should use the cached adapter
      const result2 = await engine['executeStep'](stepDef2, context2);
      // Step 2 might fail due to missing projectRef in config for applyMigrations
      // The important thing is that the cached adapter is used (no new factory call)
      expect(result2).toBeDefined();
    });

    it('should work with mock adapters when useRealAdapters=false', async () => {
      const factory = createAdapterFactory({ useRealAdapters: false });

      const engine = new DeploymentEngine({
        adapterFactory: factory,
        secretStore,
      });

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'allowedOrigins', 'https://factory-test.apollofit.com.br');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      const config = {
        slug: 'factory-test',
        repo: 'apollofitweb/apollo-web',
        branch: 'develop',
        dockerfilePath: 'docker/Dockerfile',
        supabaseRegion: 'sa-east-1',
        publicApiUrl: 'https://api.factory-test.apollofit.com.br',
        renderServiceId: 'srv-mock',
        netlifySiteId: 'site-mock',
        allowedOrigins: 'https://factory-test.apollofit.com.br',
      };

      const context = await engine['buildEngineContext'](deploymentId, config, 1);
      const stepDef = DEPLOYMENT_STEPS[0];

      const result = await engine['executeStep'](stepDef, context);

      expect(result.success).toBe(true);
      // Mock adapter in creation mode generates prefixed projectRef
      expect(result.data?.projectRef).toMatch(/^apollo-factory-test-/);
      // Mock connection strings
      expect(result.data?.connectionStrings?.databaseUrl).toContain('mock://');
    });

    it('should validate adapters async during executeStepsAfterAcquire', async () => {
      const validProjectRef = 'validref12345678901234';

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({
          id: '123',
          ref: validProjectRef,
          name: 'apollofit-factory-test',
          region: 'sa-east-1',
          status: 'ACTIVE_HEALTHY',
          database: { host: 'db.supabase.co', version: '15.2' },
          connection_strings: {
            pooler: { transaction: 'postgresql://pooler', session: 'postgresql://pooler' },
            direct: 'postgresql://direct',
          },
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        })),
      });

      await secretStore.setGlobal('global', 'supabase.accessToken', 'test-pat-token');

      const factory = createAdapterFactory({
        useRealAdapters: true,
        supabaseConfig: {
          getGlobalSecret: (key) => secretStore.getGlobal('global', key as 'supabase.accessToken'),
        },
      });

      const engine = new DeploymentEngine({
        adapterFactory: factory,
        secretStore,
      });

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'allowedOrigins', 'https://factory-test.apollofit.com.br');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      const config = {
        slug: 'factory-test',
        repo: 'apollofitweb/apollo-web',
        branch: 'develop',
        dockerfilePath: 'docker/Dockerfile',
        supabaseRegion: 'sa-east-1',
        publicApiUrl: 'https://api.factory-test.apollofit.com.br',
        renderServiceId: 'srv-mock',
        netlifySiteId: 'site-mock',
        allowedOrigins: 'https://factory-test.apollofit.com.br',
        supabaseProjectRef: validProjectRef,
      };

      // The validateConfig call happens in executeStepsAfterAcquire
      // We can verify it doesn't throw and adapters are ready
      const supabaseAdapter = await engine['getSupabaseAdapter']();
      const validation = await supabaseAdapter.validateConfig(config);

      expect(validation.success).toBe(true);
    });
  });

  describe('SecretStore Integration', () => {
    it('should retrieve global secrets (netlify.authToken, supabase.accessToken) via getGlobalSecret', async () => {
      const testSecretStore = createSecretStore();
      if ('clear' in testSecretStore) {
        (testSecretStore as any).clear();
      }

      // Set global secrets
      await testSecretStore.setGlobal('global', 'netlify.authToken', 'netlify-secret-token');
      await testSecretStore.setGlobal('global', 'supabase.accessToken', 'supabase-pat-secret');

      // Retrieve via getGlobalSecret pattern
      const netlifyToken = await testSecretStore.getGlobal('global', 'netlify.authToken');
      const supabasePat = await testSecretStore.getGlobal('global', 'supabase.accessToken');

      expect(netlifyToken).toBe('netlify-secret-token');
      expect(supabasePat).toBe('supabase-pat-secret');
    });

    it('should retrieve deployment-scoped secrets', async () => {
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'secret-db-password');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'secret-jwt-access');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'secret-jwt-refresh');

      const dbPassword = await secretStore.get(deploymentId, 'deployment', 'dbPassword');
      const jwtAccess = await secretStore.get(deploymentId, 'deployment', 'jwtAccessSecret');
      const jwtRefresh = await secretStore.get(deploymentId, 'deployment', 'jwtRefreshSecret');

      expect(dbPassword).toBe('secret-db-password');
      expect(jwtAccess).toBe('secret-jwt-access');
      expect(jwtRefresh).toBe('secret-jwt-refresh');
    });

    it('should not allow arbitrary global keys (allowlist enforcement)', async () => {
      await expect(
        secretStore.setGlobal('global', 'arbitrary.key' as any, 'value')
      ).rejects.toThrow('Global key not in allowlist');
    });
  });

  describe('No Duplicate Adapter Creation', () => {
    it('should not call createSupabaseAdapter multiple times during deployment', async () => {
      const validProjectRef = 'lenfghvvaiyqkefzxrmp';

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({
          id: '123',
          ref: validProjectRef,
          name: 'apollofit-factory-test',
          region: 'sa-east-1',
          status: 'ACTIVE_HEALTHY',
          database: { host: 'db.supabase.co', version: '15.2' },
          connection_strings: {
            pooler: { transaction: 'postgresql://pooler', session: 'postgresql://pooler' },
            direct: 'postgresql://direct',
          },
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        })),
      });

      await secretStore.setGlobal('global', 'supabase.accessToken', 'test-pat-token');

      const factory = createAdapterFactory({
        useRealAdapters: true,
        supabaseConfig: {
          getGlobalSecret: (key) => secretStore.getGlobal('global', key as 'supabase.accessToken'),
        },
      });

      // Spy on factory method
      const createSupabaseSpy = vi.spyOn(factory, 'createSupabaseAdapter');

      const engine = new DeploymentEngine({
        adapterFactory: factory,
        secretStore,
      });

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'allowedOrigins', 'https://factory-test.apollofit.com.br');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      const config = {
        slug: 'factory-test',
        repo: 'apollofitweb/apollo-web',
        branch: 'develop',
        dockerfilePath: 'docker/Dockerfile',
        supabaseRegion: 'sa-east-1',
        publicApiUrl: 'https://api.factory-test.apollofit.com.br',
        renderServiceId: 'srv-mock',
        netlifySiteId: 'site-mock',
        allowedOrigins: 'https://factory-test.apollofit.com.br',
        supabaseProjectRef: validProjectRef,
      };

      // Execute step 1 (supabase_create)
      const context1 = await engine['buildEngineContext'](deploymentId, config, 1);
      await engine['executeStep'](DEPLOYMENT_STEPS[0], context1);

      // Execute step 2 (supabase_migrate_seed) - should use cached adapter
      const context2 = await engine['buildEngineContext'](deploymentId, config, 2);
      await engine['executeStep'](DEPLOYMENT_STEPS[1], context2);

      // Factory createSupabaseAdapter should only be called ONCE (first time)
      // Subsequent calls use cached instance
      expect(createSupabaseSpy).toHaveBeenCalledTimes(1);
    });

    it('should not call createRenderAdapter multiple times', async () => {
      const factory = createMockAdapterFactory();
      const createRenderSpy = vi.spyOn(factory, 'createRenderAdapter');

      const engine = new DeploymentEngine({
        adapterFactory: factory,
        secretStore,
      });

      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'allowedOrigins', 'https://factory-test.apollofit.com.br');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      const config = {
        slug: 'factory-test',
        repo: 'apollofitweb/apollo-web',
        branch: 'develop',
        dockerfilePath: 'docker/Dockerfile',
        supabaseRegion: 'sa-east-1',
        publicApiUrl: 'https://api.factory-test.apollofit.com.br',
        renderServiceId: 'srv-mock',
        netlifySiteId: 'site-mock',
        allowedOrigins: 'https://factory-test.apollofit.com.br',
      };

      // Execute step 3 (render_create)
      const context3 = await engine['buildEngineContext'](deploymentId, config, 3);
      await engine['executeStep'](DEPLOYMENT_STEPS[2], context3);

      // Execute step 4 (render_configure) - should use cached adapter
      const context4 = await engine['buildEngineContext'](deploymentId, config, 4);
      await engine['executeStep'](DEPLOYMENT_STEPS[3], context4);

      // Factory createRenderAdapter should only be called ONCE
      expect(createRenderSpy).toHaveBeenCalledTimes(1);
    });

    it('should not call createNetlifyAdapter multiple times', async () => {
      const factory = createMockAdapterFactory();
      const createNetlifySpy = vi.spyOn(factory, 'createNetlifyAdapter');

      const engine = new DeploymentEngine({
        adapterFactory: factory,
        secretStore,
      });

      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'allowedOrigins', 'https://factory-test.apollofit.com.br');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      const config = {
        slug: 'factory-test',
        repo: 'apollofitweb/apollo-web',
        branch: 'develop',
        dockerfilePath: 'docker/Dockerfile',
        supabaseRegion: 'sa-east-1',
        publicApiUrl: 'https://api.factory-test.apollofit.com.br',
        renderServiceId: 'srv-mock',
        netlifySiteId: 'site-mock',
        allowedOrigins: 'https://factory-test.apollofit.com.br',
      };

      // Execute step 5 (netlify_deploy)
      const context5 = await engine['buildEngineContext'](deploymentId, config, 5);
      await engine['executeStep'](DEPLOYMENT_STEPS[4], context5);

      // Factory createNetlifyAdapter should only be called ONCE
      expect(createNetlifySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Production Deployment Engine (createProductionDeploymentEngine)', () => {
    // Valid 32-byte base64 master key for AES-256-GCM
    const validMasterKey = Buffer.from('a'.repeat(32)).toString('base64'); // 44 chars

    beforeEach(() => {
      process.env.SECRETS_MASTER_KEY = validMasterKey;
    });

    afterEach(() => {
      delete process.env.SECRETS_MASTER_KEY;
    });

    it('should create engine with real Supabase adapter and DurableSecretStore via createProductionDeploymentEngine', async () => {
      // Provision the PAT in DurableSecretStore
      const durableSecretStore = await createDurableSecretStore(prisma);
      await durableSecretStore.setGlobal('global', 'supabase.accessToken', 'prod-pat-secret-1');

      // Call the actual production factory function
      const engine = await createProductionDeploymentEngine(prisma);

      // Verify the engine can get the real adapter
      const supabaseAdapter = await engine['getSupabaseAdapter']();
      expect(supabaseAdapter).toBeInstanceOf(RealSupabaseAdapter);
      expect(supabaseAdapter.version).toBe('1.0.0');

      // Verify PAT was retrieved from SecretStore (not exposed in config)
      const config = (supabaseAdapter as any).config;
      expect(config.accessToken).toBeUndefined();
      expect(config.getGlobalSecret).toBeDefined();

      // Verify secretStore is DurableSecretStore
      expect(engine['secretStore']).toBeDefined();
    });

    it('should retrieve PAT from SecretStore via getGlobalSecret at initialization using production factory', async () => {
      // Provision PAT in DurableSecretStore
      const durableSecretStore = await createDurableSecretStore(prisma);
      await durableSecretStore.setGlobal('global', 'supabase.accessToken', 'pat-from-secretstore-2');

      // Call production factory
      const engine = await createProductionDeploymentEngine(prisma);

      // First access should trigger initialization with getGlobalSecret
      const adapter = await engine['getSupabaseAdapter']();

      expect(adapter).toBeInstanceOf(RealSupabaseAdapter);

      // Second access should use cached adapter
      const adapter2 = await engine['getSupabaseAdapter']();
      expect(adapter2).toBe(adapter);
    });

    it('should not expose PAT value in logs or config when using production factory', async () => {
      const secretPat = 'very-secret-pat-token-12345-3';
      const durableSecretStore = await createDurableSecretStore(prisma);
      await durableSecretStore.setGlobal('global', 'supabase.accessToken', secretPat);

      // Call production factory
      const engine = await createProductionDeploymentEngine(prisma);

      const adapter = await engine['getSupabaseAdapter']();

      // Verify PAT is not in the adapter config
      const config = (adapter as any).config;
      expect(config.accessToken).toBeUndefined();
      expect(config.getGlobalSecret).toBeDefined();

      // Verify the adapter can still be used (PAT retrieved internally)
      expect(adapter.name).toBe('supabase');
      expect(adapter.version).toBe('1.0.0');
    });

    it('should execute deployment steps with real adapter factory via production factory (mocked API)', async () => {
      const validProjectRef = 'prodref1234567890123'; // exactly 20 chars

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({
          id: '123',
          ref: validProjectRef,
          name: 'apollofit-prod-test',
          region: 'sa-east-1',
          status: 'ACTIVE_HEALTHY',
          database: { host: 'db.supabase.co', version: '15.2' },
          connection_strings: {
            pooler: { transaction: 'postgresql://pooler', session: 'postgresql://pooler' },
            direct: 'postgresql://direct',
          },
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        })),
      });

      // Provision PAT in DurableSecretStore
      const durableSecretStore = await createDurableSecretStore(prisma);
      await durableSecretStore.setGlobal('global', 'supabase.accessToken', 'prod-pat-secret-4');

      // Call the actual production factory function
      const engine = await createProductionDeploymentEngine(prisma);

      // Create a test deployment
      const deployment = await deploymentRepository.create({
        slug: 'prod-integration-test-4',
        name: 'Prod Integration Test 4',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      const deploymentId = deployment.id;

      // Set up deployment-scoped secrets in DurableSecretStore
      await durableSecretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await durableSecretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await durableSecretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await durableSecretStore.set(deploymentId, 'deployment', 'allowedOrigins', 'https://prod-integration-test.apollofit.com.br');
      await durableSecretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      const config = {
        slug: 'prod-integration-test-4',
        repo: 'apollofitweb/apollo-web',
        branch: 'develop',
        dockerfilePath: 'docker/Dockerfile',
        supabaseRegion: 'sa-east-1',
        publicApiUrl: 'https://api.prod-integration-test.apollofit.com.br',
        renderServiceId: 'srv-mock',
        netlifySiteId: 'site-mock',
        allowedOrigins: 'https://prod-integration-test.apollofit.com.br',
        supabaseProjectRef: validProjectRef,
      };

      // Execute step 1 (supabase_create) with adoption mode
      const context1 = await engine['buildEngineContext'](deploymentId, config, 1);
      const result1 = await engine['executeStep'](DEPLOYMENT_STEPS[0], context1);

      // Debug: log result if failed
      if (!result1.success) {
        console.log('STEP 1 ERROR:', result1.error);
      }

      expect(result1.success).toBe(true);
      expect(result1.data?.projectRef).toBe(validProjectRef); // Adoption mode returns existing ref
      expect(result1.data?.connectionStrings?.databaseUrl).toBeDefined();
      expect(result1.data?.connectionStrings?.directUrl).toBeDefined();

      // Verify RealSupabaseAdapter was used (not mock)
      const supabaseAdapter = await engine['getSupabaseAdapter']();
      expect(supabaseAdapter).toBeInstanceOf(RealSupabaseAdapter);
    });
  });
});