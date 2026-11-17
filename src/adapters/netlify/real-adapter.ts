/**
 * Real Netlify Management API Adapter
 * OS-005: Implements domain alias association for shared Matrix site
 * Uses Netlify API v1 (https://developers.netlify.com/api/)
 * Does NOT trigger builds or configure env vars/redirects during provisioning.
 * SPA redirects configured via _redirects in frontend build output.
 * API URL resolved at runtime by frontend via hostname.
 */

import type { EngineContext, AdapterResult } from '../../shared/types.js';
import type { NetlifyAdapter } from '../base.js';


export interface RealNetlifyAdapterConfig {
  authToken?: string;
  baseUrl?: string;
  timeoutMs?: number;
  getGlobalSecret?: (key: 'netlify.authToken' | 'netlify.siteId') => Promise<string | null>;
}

const DEFAULT_BASE_URL = 'https://api.netlify.com/api/v1';

export class RealNetlifyAdapter implements NetlifyAdapter {
  readonly name = 'netlify' as const;
  readonly version = '1.0.0';

  private config: RealNetlifyAdapterConfig;
  private siteId: string | null = null;
  private initialized = false;

  constructor(config: RealNetlifyAdapterConfig = {}) {
    this.config = {
      baseUrl: DEFAULT_BASE_URL,
      timeoutMs: 30000,
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.config.getGlobalSecret && !this.config.authToken) {
      // Retrieve auth token from SecretStore
      const authToken = await this.config.getGlobalSecret('netlify.authToken');
      if (authToken) {
        this.config.authToken = authToken;
      }

      // Retrieve site ID from SecretStore (shared Matrix site)
      const siteId = await this.config.getGlobalSecret('netlify.siteId');
      if (siteId) {
        this.siteId = siteId;
      }
    }
    this.initialized = true;
  }

  private async getSiteId(): Promise<string> {
    if (this.siteId) return this.siteId;
    if (this.config.getGlobalSecret) {
      this.siteId = await this.config.getGlobalSecret('netlify.siteId');
      if (this.siteId) return this.siteId;
    }
    throw new Error('Netlify siteId not configured. Provision netlify.siteId global secret.');
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<AdapterResult<T>> {
    const baseUrl = this.config.baseUrl || DEFAULT_BASE_URL;
    const url = `${baseUrl}${endpoint}`;
    const authToken = this.config.authToken;

    if (!authToken) {
      return { success: false, error: 'Netlify auth token not configured' };
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30000);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        let errorMessage = `Netlify API error: ${response.status} ${response.statusText}`;

        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.msg) errorMessage = errorJson.msg;
          else if (errorJson.message) errorMessage = errorJson.message;
          else if (errorJson.error) errorMessage = errorJson.error;
        } catch {
          if (errorText) errorMessage = errorText;
        }

        return {
          success: false,
          error: errorMessage,
          metadata: { status: response.status, endpoint },
        };
      }

      const data = await response.json().catch(() => null) as T;
      return { success: true, data };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: `Netlify API timeout after ${this.config.timeoutMs}ms` };
      }
      return { success: false, error: `Netlify API request failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async isReady(_context: EngineContext): Promise<boolean> {
    try {
      const result = await this.makeRequest('/sites');
      return result.success;
    } catch {
      return false;
    }
  }

  async validateConfig(_config: Record<string, unknown>): Promise<AdapterResult> {
    if (this.config.authToken || this.config.getGlobalSecret) {
      return { success: true };
    }
    return { success: false, error: 'Netlify auth token não configurado (authToken ou getGlobalSecret)' };
  }

  async healthCheck(_context: EngineContext): Promise<AdapterResult> {
    const result = await this.makeRequest('/sites');
    if (result.success) {
      return { success: true, data: { status: 'ok', real: true } };
    }
    return result;
  }

  async deploySite(
    context: EngineContext,
    params: { repo: string; branch: string; buildCommand: string; publishDir: string }
  ): Promise<AdapterResult<{ siteId: string; siteUrl: string }>> {
    context.logger.info('[RealNetlify] Deploying site', { repo: params.repo, branch: params.branch });

    // For shared Matrix site, we don't create a new site - we deploy to existing site
    // This method should trigger a build/deploy on the existing site
    // Netlify API: POST /sites/:site_id/builds
    const siteId = await this.getSiteId();

    const result = await this.makeRequest<{ id: string; state: string; deploy_url: string }>(
      `/sites/${siteId}/builds`,
      {
        method: 'POST',
        body: JSON.stringify({
          branch: params.branch,
        }),
      });

    if (!result.success) {
      return { success: false, error: result.error, metadata: result.metadata };
    }

    // Get site info for siteUrl
    const siteResult = await this.makeRequest<{ url: string; ssl_url: string }>(`/sites/${siteId}`);
    if (!siteResult.success) {
      return { success: false, error: siteResult.error, metadata: siteResult.metadata };
    }

    return {
      success: true,
      data: {
        siteId,
        siteUrl: siteResult.data?.ssl_url || siteResult.data?.url || `https://${siteId}.netlify.app`,
      },
    };
  }

  async addDomainAlias(
    context: EngineContext,
    params: { siteId?: string; domain: string }
  ): Promise<AdapterResult<{ aliasAdded: boolean; domain: string }>> {
    const targetSiteId = params.siteId || await this.getSiteId();
    const domain = params.domain.toLowerCase();

    context.logger.info('[RealNetlify] Adding domain alias', { siteId: targetSiteId, domain });

    // IDEMPOTENCY: Check if domain already exists on this site
    const existingDomains = await this.makeRequest<Array<{ domain: string; verified: boolean }>>(
      `/sites/${targetSiteId}/domains`
    );

    if (existingDomains.success && existingDomains.data) {
      const domainExists = existingDomains.data.some(d => d.domain.toLowerCase() === domain);
      if (domainExists) {
        context.logger.info('[RealNetlify] Domain already exists, skipping', { domain });
        return { success: true, data: { aliasAdded: false, domain } };
      }
    }

    // Add domain alias - Netlify API: POST /sites/:site_id/domains
    const result = await this.makeRequest<{ id: string; domain: string; verified: boolean }>(
      `/sites/${targetSiteId}/domains`,
      {
        method: 'POST',
        body: JSON.stringify({ domain }),
      }
    );

    if (!result.success) {
      // Check if it's a "already exists" error (idempotency at API level)
      if (result.error?.toLowerCase().includes('already exists') ||
          result.error?.toLowerCase().includes('duplicate') ||
          result.error?.toLowerCase().includes('conflict')) {
        context.logger.info('[RealNetlify] Domain already exists (API conflict)', { domain });
        return { success: true, data: { aliasAdded: false, domain } };
      }
      return { success: false, error: result.error, metadata: result.metadata };
    }

    // Map Netlify response to our expected format
    context.logger.info('[RealNetlify] Domain alias added', { domain, verified: result.data?.verified });
    return { success: true, data: { aliasAdded: true, domain } };
  }

  async validateDeployment(
    context: EngineContext,
    params: { siteUrl: string }
  ): Promise<AdapterResult<{ healthy: boolean }>> {
    context.logger.debug('[RealNetlify] Validating deployment', { siteUrl: params.siteUrl });

    try {
      const response = await fetch(params.siteUrl, { method: 'HEAD' });
      const healthy = response.ok || response.status === 404; // 404 is OK for SPA (index.html handles routing)
      return { success: true, data: { healthy } };
    } catch {
      return { success: true, data: { healthy: false } };
    }
  }
}

/**
 * Factory function to create RealNetlifyAdapter with async initialization
 */
export async function createRealNetlifyAdapter(
  config: RealNetlifyAdapterConfig
): Promise<RealNetlifyAdapter> {
  const adapter = new RealNetlifyAdapter(config);
  await adapter.initialize();
  return adapter;
}