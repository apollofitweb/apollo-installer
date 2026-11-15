/**
 * Mock adapters for development and testing
 * OS-002: No real external calls - mock implementations only
 * Simulates idempotency conflicts for testing
 */

import type { AdapterResult, EngineContext } from '../shared/types.js';
import type { SupabaseAdapter, RenderAdapter, NetlifyAdapter } from './base.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// In-memory state to simulate idempotency
const supabaseProjects = new Map<string, { projectRef: string; dbPassword: string; region: string }>();
const renderServices = new Map<string, { serviceId: string; serviceUrl: string }>();
const netlifySites = new Map<string, { siteId: string; siteUrl: string }>();

function resetMockState(): void {
  supabaseProjects.clear();
  renderServices.clear();
  netlifySites.clear();
}

export function createMockSupabaseAdapter(): SupabaseAdapter {
  return {
    name: 'supabase',
    version: 'mock-1.0.0',

    async isReady(context: EngineContext): Promise<boolean> {
      context.logger.debug('[MockSupabase] Checking readiness');
      return true;
    },

    async validateConfig(_config: Record<string, unknown>): Promise<AdapterResult> {
      // Validate via secrets in context, not config
      return { success: true };
    },

    async healthCheck(context: EngineContext): Promise<AdapterResult> {
      context.logger.debug('[MockSupabase] Health check');
      await delay(100);
      return { success: true, data: { status: 'ok', mock: true } };
    },

    async createProject(context: EngineContext, params: { slug: string; region: string; dbPassword: string; existingProjectRef?: string }): Promise<AdapterResult<{ projectRef: string; connectionStrings: { databaseUrl: string; directUrl: string } }>> {
      // ADOPTION MODE: existingProjectRef provided
      if (params.existingProjectRef) {
        context.logger.info('[MockSupabase] Adopting existing project', {
          slug: params.slug,
          existingProjectRef: params.existingProjectRef,
          region: params.region
        });
        await delay(300);

        // In a real adapter, we would call Supabase Management API to:
        // 1. GET /v1/projects/{ref} to verify project exists and get connection info
        // 2. Validate credentials by attempting a test connection
        // 3. Return actual connection strings from Supabase

        // MOCK: Simulate validation - fail if password is "wrong-password"
        const validationResult = await this.validateConnection(context, {
          databaseUrl: `mock://validate/${params.existingProjectRef}?password=${params.dbPassword}`
        });

        if (!validationResult.success) {
          return {
            success: false,
            error: `Falha ao adotar projeto existente ${params.existingProjectRef}: ${validationResult.error}`
          };
        }

        // Store for idempotency (key includes existingProjectRef to distinguish from created projects)
        const existingKey = `adopted:${params.existingProjectRef}`;
        supabaseProjects.set(existingKey, {
          projectRef: params.existingProjectRef,
          dbPassword: params.dbPassword,
          region: params.region
        });

        // MOCK: Return placeholder connection strings - real adapter gets these from Supabase API
        return {
          success: true,
          data: {
            projectRef: params.existingProjectRef,
            connectionStrings: {
              databaseUrl: `mock://postgresql://${params.existingProjectRef}.pooler.supabase.com:5432/postgres`,
              directUrl: `mock://postgresql://${params.existingProjectRef}.supabase.co:5432/postgres`,
            },
          },
        };
      }

      // CREATION MODE: normal project creation (original behavior)
      context.logger.info('[MockSupabase] Creating project', { slug: params.slug, region: params.region });
      await delay(500);

      // Check if project already exists (idempotency simulation)
      const existingKey = `${params.slug}:${params.region}`;
      if (supabaseProjects.has(existingKey)) {
        const existing = supabaseProjects.get(existingKey)!;
        // Verify password matches
        if (existing.dbPassword !== params.dbPassword) {
          return { success: false, error: 'Project exists with different dbPassword' };
        }
        context.logger.info('[MockSupabase] Project already exists, returning existing', { projectRef: existing.projectRef });
        return {
          success: true,
          data: {
            projectRef: existing.projectRef,
            connectionStrings: {
              databaseUrl: `mock://postgresql://${existing.projectRef}.pooler.supabase.com:5432/postgres`,
              directUrl: `mock://postgresql://${existing.projectRef}.supabase.co:5432/postgres`,
            },
          },
        };
      }

      const projectRef = `apollo-${params.slug}-${Date.now().toString(36)}`;
      supabaseProjects.set(existingKey, { projectRef, dbPassword: params.dbPassword, region: params.region });

      return {
        success: true,
        data: {
          projectRef,
          connectionStrings: {
            databaseUrl: `mock://postgresql://${projectRef}.pooler.supabase.com:5432/postgres`,
            directUrl: `mock://postgresql://${projectRef}.supabase.co:5432/postgres`,
          },
        },
      };
    },

    async applyMigrations(context: EngineContext, _params: { databaseUrl: string; directUrl: string }): Promise<AdapterResult<{ migrationsApplied: number }>> {
      context.logger.info('[MockSupabase] Applying migrations');
      await delay(300);
      // Idempotent: always returns same result
      return { success: true, data: { migrationsApplied: 12 } };
    },

    async runSeed(context: EngineContext, _params: { databaseUrl: string }): Promise<AdapterResult<{ adminCreated: boolean; permissions: number; roles: number; userRoles: number; rolePermissions: number }>> {
      context.logger.info('[MockSupabase] Running seed');
      await delay(200);
      // Simulate integral seed verification (66 permissions, 4 roles, UserRole, RolePermissions)
      return { success: true, data: { adminCreated: true, permissions: 66, roles: 4, userRoles: 1, rolePermissions: 16 } };
    },

    async validateConnection(context: EngineContext, params: { databaseUrl: string }): Promise<AdapterResult<{ connected: boolean }>> {
      context.logger.debug('[MockSupabase] Validating connection');
      await delay(100);

      // Simulate password validation - if URL contains "wrong-password" or "password=wrong-password", fail
      if (params.databaseUrl.includes('wrong-password')) {
        return { success: false, error: 'Authentication failed: invalid password' };
      }

      return { success: true, data: { connected: true } };
    },
  };
}

export { resetMockState };

export function createMockRenderAdapter(): RenderAdapter {
  return {
    name: 'render',
    version: 'mock-1.0.0',

    async isReady(context: EngineContext): Promise<boolean> {
      context.logger.debug('[MockRender] Checking readiness');
      return true;
    },

    async validateConfig(_config: Record<string, unknown>): Promise<AdapterResult> {
      return { success: true };
    },

    async healthCheck(context: EngineContext): Promise<AdapterResult> {
      context.logger.debug('[MockRender] Health check');
      await delay(100);
      return { success: true, data: { status: 'ok', mock: true } };
    },

    async createWebService(
      context: EngineContext,
      params: { name: string; repo: string; branch: string; dockerfilePath: string }
    ): Promise<AdapterResult<{ serviceId: string; serviceUrl: string }>> {
      context.logger.info('[MockRender] Creating web service', { name: params.name, repo: params.repo });
      await delay(800);

      // Check if service already exists (idempotency simulation)
      const existingKey = params.name;
      if (renderServices.has(existingKey)) {
        const existing = renderServices.get(existingKey)!;
        context.logger.info('[MockRender] Service already exists, returning existing', { serviceId: existing.serviceId });
        return { success: true, data: existing };
      }

      const serviceId = `srv-${params.name}-${Date.now().toString(36)}`;
      const serviceUrl = `https://${serviceId}.onrender.com`;
      renderServices.set(existingKey, { serviceId, serviceUrl });

      return {
        success: true,
        data: { serviceId, serviceUrl },
      };
    },

    async configureEnvVars(
      context: EngineContext,
      params: { serviceId: string; envVars: Record<string, string> }
    ): Promise<AdapterResult> {
      context.logger.info('[MockRender] Configuring env vars', { serviceId: params.serviceId, count: Object.keys(params.envVars).length });
      await delay(200);
      // Idempotent: always succeeds
      return { success: true };
    },

    async setupHealthCheck(context: EngineContext, params: { serviceId: string; path: string }): Promise<AdapterResult> {
      context.logger.info('[MockRender] Setting up health check', { serviceId: params.serviceId, path: params.path });
      await delay(100);
      return { success: true };
    },

    async validateDeployment(context: EngineContext, params: { serviceUrl: string }): Promise<AdapterResult<{ healthy: boolean }>> {
      context.logger.debug('[MockRender] Validating deployment', { serviceUrl: params.serviceUrl });
      await delay(200);
      return { success: true, data: { healthy: true } };
    },
  };
}

export function createMockNetlifyAdapter(): NetlifyAdapter {
  return {
    name: 'netlify',
    version: 'mock-1.0.0',

    async isReady(context: EngineContext): Promise<boolean> {
      context.logger.debug('[MockNetlify] Checking readiness');
      return true;
    },

    async validateConfig(_config: Record<string, unknown>): Promise<AdapterResult> {
      return { success: true };
    },

    async healthCheck(context: EngineContext): Promise<AdapterResult> {
      context.logger.debug('[MockNetlify] Health check');
      await delay(100);
      return { success: true, data: { status: 'ok', mock: true } };
    },

    async deploySite(
      context: EngineContext,
      params: { repo: string; branch: string; buildCommand: string; publishDir: string }
    ): Promise<AdapterResult<{ siteId: string; siteUrl: string }>> {
      context.logger.info('[MockNetlify] Deploying site', { repo: params.repo, branch: params.branch });
      await delay(1000);

      // Netlify deploy is idempotent - always creates new build
      const siteId = `site-${Date.now().toString(36)}`;
      return {
        success: true,
        data: {
          siteId,
          siteUrl: `https://${siteId}.netlify.app`,
        },
      };
    },

    async addDomainAlias(
      context: EngineContext,
      params: { siteId: string; domain: string }
    ): Promise<AdapterResult<{ aliasAdded: boolean; domain: string }>> {
      context.logger.info('[MockNetlify] Adding domain alias', { siteId: params.siteId, domain: params.domain });
      await delay(300);
      // Idempotent: adding same domain again succeeds
      return { success: true, data: { aliasAdded: true, domain: params.domain } };
    },

    async configureEnvVars(
      context: EngineContext,
      params: { siteId: string; envVars: Record<string, string>; context: 'production' | 'preview' | 'branch' }
    ): Promise<AdapterResult> {
      context.logger.info('[MockNetlify] Configuring env vars', {
        siteId: params.siteId,
        context: params.context,
        count: Object.keys(params.envVars).length,
      });
      await delay(200);
      // Idempotent: upsert behavior
      return { success: true };
    },

    async configureRedirects(context: EngineContext, params: { siteId: string }): Promise<AdapterResult> {
      context.logger.info('[MockNetlify] Configuring SPA redirects', { siteId: params.siteId });
      await delay(100);
      return { success: true };
    },

    async validateDeployment(context: EngineContext, params: { siteUrl: string }): Promise<AdapterResult<{ healthy: boolean }>> {
      context.logger.debug('[MockNetlify] Validating deployment', { siteUrl: params.siteUrl });
      await delay(200);
      return { success: true, data: { healthy: true } };
    },
  };
}

export function createAdapterFactory() {
  return {
    createSupabaseAdapter: (_config: Record<string, unknown>) => createMockSupabaseAdapter(),
    createRenderAdapter: (_config: Record<string, unknown>) => createMockRenderAdapter(),
    createNetlifyAdapter: (_config: Record<string, unknown>) => createMockNetlifyAdapter(),
  };
}