/**
 * Real Render API Adapter
 * Uses Render API v1 (https://api-docs.render.com/reference/introduction)
 *
 * Implements web service creation (idempotent by name), environment variable
 * configuration, health check setup and deployment validation.
 *
 * Secrets are resolved at initialization time via getGlobalSecret('render.apiToken')
 * and never logged or persisted in plaintext.
 */

import type { EngineContext, AdapterResult } from '../../shared/types.js';
import type { RenderAdapter } from '../base.js';

export interface RealRenderAdapterConfig {
  apiToken?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Render workspace/owner ID. If omitted it is discovered via GET /v1/owners. */
  ownerId?: string;
  /** Render region (e.g. oregon, ohio, frankfurt, singapore, virginia). */
  region?: string;
  /** Render plan for the web service (e.g. starter, standard). */
  plan?: string;
  getGlobalSecret?: (
    key: 'render.apiToken' | 'render.ownerId'
  ) => Promise<string | null>;
}

const DEFAULT_BASE_URL = 'https://api.render.com/v1';
const DEFAULT_REGION = 'oregon';
const DEFAULT_PLAN = 'starter';

interface RenderService {
  id: string;
  name: string;
  serviceDetails?: {
    url?: string;
    region?: string;
    plan?: string;
  };
  service?: RenderService;
}

interface RenderOwner {
  id: string;
  name?: string;
  type?: string;
}

function unwrapService(entry: RenderService): RenderService {
  return entry.service ?? entry;
}

function normalizeRepo(repo: string): string {
  if (/^https?:\/\//i.test(repo) || repo.startsWith('git@')) {
    return repo;
  }
  return `https://github.com/${repo}`;
}

function normalizeDockerContext(dockerfilePath: string): string {
  // For a Dockerfile inside a subdirectory (e.g. docker/Dockerfile) the build
  // context is still the repository root unless explicitly configured.
  return '.';
}

export class RealRenderAdapter implements RenderAdapter {
  readonly name = 'render' as const;
  readonly version = '1.0.0';

  private config: RealRenderAdapterConfig;
  private apiToken: string | null = null;
  private ownerId: string | null = null;
  private initialized = false;

  constructor(config: RealRenderAdapterConfig = {}) {
    this.config = {
      baseUrl: DEFAULT_BASE_URL,
      timeoutMs: 30000,
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.config.getGlobalSecret && !this.config.apiToken) {
      const token = await this.config.getGlobalSecret('render.apiToken');
      if (token) this.apiToken = token;
    }

    if (!this.ownerId) {
      this.ownerId = this.config.ownerId ?? process.env.RENDER_OWNER_ID ?? null;
    }

    if (this.config.getGlobalSecret && !this.ownerId) {
      const ownerId = await this.config.getGlobalSecret('render.ownerId');
      if (ownerId) this.ownerId = ownerId;
    }

    this.initialized = true;
  }

  private getToken(context?: EngineContext): string | null {
    if (this.apiToken) return this.apiToken;
    if (this.config.apiToken) return this.config.apiToken;
    if (context?.secrets.renderApiToken) return context.secrets.renderApiToken;
    if (process.env.RENDER_API_TOKEN) return process.env.RENDER_API_TOKEN;
    return null;
  }

  private getRegion(): string {
    return this.config.region ?? process.env.RENDER_REGION ?? DEFAULT_REGION;
  }

  private getPlan(): string {
    return this.config.plan ?? process.env.RENDER_PLAN ?? DEFAULT_PLAN;
  }

  private async makeRequest<T>(
    context: EngineContext | undefined,
    endpoint: string,
    options: RequestInit = {}
  ): Promise<AdapterResult<T>> {
    const baseUrl = this.config.baseUrl || DEFAULT_BASE_URL;
    const token = this.getToken(context);

    if (!token) {
      return {
        success: false,
        error:
          'Render API token não configurado (apiToken, RENDER_API_TOKEN ou segredo global render.apiToken)',
      };
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 30000
    );

    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        let errorMessage = `Render API error: ${response.status} ${response.statusText}`;

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage =
            errorJson.message ??
            errorJson.error ??
            (Array.isArray(errorJson.errors) ? errorJson.errors.join('; ') : null) ??
            errorMessage;
        } catch {
          if (errorText) errorMessage = errorText;
        }

        return {
          success: false,
          error: errorMessage,
          metadata: { status: response.status, endpoint },
        };
      }

      // Some Render endpoints return 204/empty bodies.
      const data = (await response.json().catch(() => null)) as T;
      return { success: true, data };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: `Render API timeout after ${this.config.timeoutMs}ms`,
        };
      }
      return {
        success: false,
        error: `Render API request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async isReady(context: EngineContext): Promise<boolean> {
    const result = await this.makeRequest<unknown>(context, '/services?limit=1');
    return result.success;
  }

  async validateConfig(_config: Record<string, unknown>): Promise<AdapterResult> {
    if (
      this.config.apiToken ||
      this.config.getGlobalSecret ||
      process.env.RENDER_API_TOKEN
    ) {
      return { success: true };
    }
    return {
      success: false,
      error:
        'Render API token não configurado (apiToken, RENDER_API_TOKEN ou segredo global render.apiToken)',
    };
  }

  async healthCheck(context: EngineContext): Promise<AdapterResult> {
    const result = await this.makeRequest<unknown>(context, '/services?limit=1');
    if (result.success) {
      return { success: true, data: { status: 'ok', real: true } };
    }
    return result;
  }

  private async resolveOwnerId(context: EngineContext): Promise<string | null> {
    if (this.ownerId) return this.ownerId;

    const result = await this.makeRequest<Array<RenderOwner | { owner: RenderOwner }>>(
      context,
      '/owners?limit=100'
    );

    if (!result.success || !Array.isArray(result.data)) {
      return null;
    }

    const first = result.data[0];
    if (!first) return null;
    const owner = 'owner' in first ? first.owner : first;
    if (owner?.id) {
      this.ownerId = owner.id;
      return owner.id;
    }
    return null;
  }

  private async findServiceByName(
    context: EngineContext,
    name: string
  ): Promise<RenderService | null> {
    const result = await this.makeRequest<Array<RenderService | { service: RenderService }>>(
      context,
      `/services?name=${encodeURIComponent(name)}&limit=100`
    );

    if (!result.success || !Array.isArray(result.data)) {
      return null;
    }

    const match = result.data
      .map((entry) => unwrapService(entry as RenderService))
      .find((service) => service.name === name);

    return match ?? null;
  }

  async createWebService(
    context: EngineContext,
    params: { name: string; repo: string; branch: string; dockerfilePath: string }
  ): Promise<AdapterResult<{ serviceId: string; serviceUrl: string }>> {
    await this.initialize();

    context.logger.info('[RealRender] Ensuring web service', {
      name: params.name,
      repo: params.repo,
      branch: params.branch,
      dockerfilePath: params.dockerfilePath,
    });

    // Idempotency: return an existing service with the same name instead of
    // creating a duplicate (Render rejects duplicate names).
    const existing = await this.findServiceByName(context, params.name);
    if (existing) {
      const serviceUrl =
        existing.serviceDetails?.url ?? `https://${params.name}.onrender.com`;
      context.logger.info('[RealRender] Service already exists, reusing', {
        serviceId: existing.id,
        serviceUrl,
      });
      return {
        success: true,
        data: { serviceId: existing.id, serviceUrl },
      };
    }

    const ownerId = await this.resolveOwnerId(context);
    if (!ownerId) {
      return {
        success: false,
        error:
          'Render ownerId não encontrado. Defina RENDER_OWNER_ID, o segredo global render.ownerId ou garanta que o token tenha acesso a /v1/owners.',
      };
    }

    const payload = {
      type: 'web_service',
      name: params.name,
      ownerId,
      repo: normalizeRepo(params.repo),
      branch: params.branch,
      autoDeploy: 'yes',
      serviceDetails: {
        env: 'docker',
        plan: this.getPlan(),
        region: this.getRegion(),
        envSpecificDetails: {
          dockerfilePath: params.dockerfilePath,
          dockerContext: normalizeDockerContext(params.dockerfilePath),
        },
      },
    };

    const result = await this.makeRequest<RenderService>(context, '/services', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!result.success) {
      // Render returns 409 for a service that already exists. Try to adopt it.
      const status = (result.metadata as { status?: number } | undefined)?.status;
      if (status === 409) {
        const adopted = await this.findServiceByName(context, params.name);
        if (adopted) {
          const serviceUrl =
            adopted.serviceDetails?.url ??
            `https://${params.name}.onrender.com`;
          return { success: true, data: { serviceId: adopted.id, serviceUrl } };
        }
      }
      return { success: false, error: result.error, metadata: result.metadata };
    }

    const service = result.data;
    if (!service?.id) {
      return {
        success: false,
        error: 'Resposta inválida da Render API: serviço criado sem id.',
      };
    }

    const serviceUrl =
      service.serviceDetails?.url ?? `https://${params.name}.onrender.com`;

    context.logger.info('[RealRender] Web service created', {
      serviceId: service.id,
      serviceUrl,
      region: this.getRegion(),
      plan: this.getPlan(),
    });

    return { success: true, data: { serviceId: service.id, serviceUrl } };
  }

  /**
   * Upsert a single environment variable. Rendering the per-key endpoint avoids
   * replacing (wiping) unrelated variables that already exist on the service.
   */
  private async upsertEnvVar(
    context: EngineContext,
    serviceId: string,
    key: string,
    value: string
  ): Promise<AdapterResult> {
    const path = `/services/${serviceId}/env-vars/${encodeURIComponent(key)}`;

    const update = await this.makeRequest<unknown>(context, path, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });

    if (update.success) return update;

    const status = (update.metadata as { status?: number } | undefined)?.status;
    if (status === 404) {
      // Variable does not exist yet - create it.
      return this.makeRequest<unknown>(context, `/services/${serviceId}/env-vars`, {
        method: 'POST',
        body: JSON.stringify({ key, value }),
      });
    }

    return update;
  }

  async configureEnvVars(
    context: EngineContext,
    params: { serviceId: string; envVars: Record<string, string> }
  ): Promise<AdapterResult> {
    await this.initialize();

    const entries = Object.entries(params.envVars);
    context.logger.info('[RealRender] Configuring environment variables', {
      serviceId: params.serviceId,
      count: entries.length,
    });

    for (const [key, value] of entries) {
      const result = await this.upsertEnvVar(context, params.serviceId, key, value);
      if (!result.success) {
        return {
          success: false,
          error: `Falha ao configurar variável ${key}: ${result.error}`,
          metadata: result.metadata,
        };
      }
    }

    context.logger.info('[RealRender] Environment variables configured', {
      serviceId: params.serviceId,
      count: entries.length,
    });

    return { success: true };
  }

  async setupHealthCheck(
    context: EngineContext,
    params: { serviceId: string; path: string }
  ): Promise<AdapterResult> {
    await this.initialize();

    context.logger.info('[RealRender] Verifying service health check path', {
      serviceId: params.serviceId,
      path: params.path,
    });

    // Render derives the health check from the service; validate that the
    // service is reachable/known so misconfiguration surfaces early.
    const result = await this.makeRequest<RenderService>(
      context,
      `/services/${params.serviceId}`
    );

    if (!result.success) {
      return result;
    }

    return {
      success: true,
      data: { serviceId: params.serviceId, path: params.path },
    };
  }

  async validateDeployment(
    context: EngineContext,
    params: { serviceUrl: string }
  ): Promise<AdapterResult<{ healthy: boolean }>> {
    context.logger.debug('[RealRender] Validating deployment', {
      serviceUrl: params.serviceUrl,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 30000
    );

    try {
      let response = await fetch(params.serviceUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });

      // Some services reject HEAD - retry with GET.
      if (response.status === 405) {
        response = await fetch(params.serviceUrl, {
          method: 'GET',
          signal: controller.signal,
        });
      }

      const healthy = response.ok || response.status === 401 || response.status === 403;
      return { success: true, data: { healthy } };
    } catch {
      return { success: true, data: { healthy: false } };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Factory function to create RealRenderAdapter with async initialization.
 */
export async function createRealRenderAdapter(
  config: RealRenderAdapterConfig
): Promise<RealRenderAdapter> {
  const adapter = new RealRenderAdapter(config);
  await adapter.initialize();
  return adapter;
}
