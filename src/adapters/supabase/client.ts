/**
 * Supabase Management API HTTP Client
 * Typed fetch wrapper with PAT authentication, timeout, and error handling
 */

import type { EngineContext } from '../../shared/types.js';
import {
  SupabaseApiError,
  SupabaseAuthError,
  SupabaseForbiddenError,
  SupabaseNotFoundError,
  SupabaseNetworkError,
  SupabaseTimeoutError,
  mapHttpError,
} from './errors.js';

// Supabase Management API base URL
export const SUPABASE_MANAGEMENT_API_BASE = 'https://api.supabase.com/v1';

export interface SupabaseClientConfig {
  accessToken: string;
  baseUrl?: string;
  timeoutMs?: number;
  logger?: EngineContext['logger'];
}

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

interface SupabaseProjectResponse {
  id: string;
  ref: string;
  name: string;
  region: string;
  status: string;
  database: {
    host: string;
    version: string;
  };
  connection_strings: {
    pooler: {
      transaction: string;
      session: string;
    };
    direct: string;
  };
  created_at: string;
  updated_at: string;
}

interface SupabaseCreateProjectRequest {
  name: string;
  region: string;
  db_pass: string;
  plan?: string;
  organization_id?: string;
}

interface SupabaseCreateProjectResponse {
  id: string;
  ref: string;
  name: string;
  region: string;
  status: string;
  database: {
    host: string;
    version: string;
  };
  connection_strings: {
    pooler: {
      transaction: string;
      session: string;
    };
    direct: string;
  };
}

/**
 * Response from POST /v1/projects/{ref}/database/migrations
 * Supabase returns HTTP 200 with empty object {} on success
 * No status/error fields in response body
 */
export interface SupabaseMigrationResponse {
  // Empty object on success per Supabase API docs
  [key: string]: never;
}

/**
 * Response from POST /v1/projects/{ref}/database/query
 * Success: { "result": [...] }
 * Error: { "error": "..." }
 * Note: The API returns HTTP 200 even when query has errors; check error field
 */
export interface SupabaseQueryResponse {
  result?: unknown[];
  error?: string;
}

export class SupabaseHttpClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly logger?: EngineContext['logger'];

  constructor(config: SupabaseClientConfig) {
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl ?? SUPABASE_MANAGEMENT_API_BASE;
    this.defaultTimeoutMs = config.timeoutMs ?? 30000; // 30s default
    this.logger = config.logger;
  }

  private buildHeaders(): HeadersInit {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private sanitizeUrlForLog(url: string): string {
    // Remove query params that might contain sensitive data
    return url.replace(/\?.*$/, '');
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestOptions
  ): Promise<Response> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      const err = error as Error;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SupabaseTimeoutError(url, options.method ?? 'GET', timeoutMs);
      }
      throw new SupabaseNetworkError(url, options.method ?? 'GET', err);
    }
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    customTimeoutMs?: number
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const sanitizedUrl = this.sanitizeUrlForLog(url);

    this.logger?.debug('[SupabaseClient] Request', { method, endpoint: sanitizedUrl });

    const response = await this.fetchWithTimeout(url, {
      method,
      headers: this.buildHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: customTimeoutMs,
    });

    this.logger?.debug('[SupabaseClient] Response', {
      method,
      endpoint: sanitizedUrl,
      status: response.status,
    });

    const responseText = await response.text();
    let responseData: unknown;
    try {
      responseData = responseText ? JSON.parse(responseText) : undefined;
    } catch {
      responseData = responseText;
    }

    if (!response.ok) {
      const retryAfter = response.headers.get('Retry-After');
      const apiError = mapHttpError(response.status, sanitizedUrl, method, responseData, retryAfter);
      this.logger?.warn('[SupabaseClient] API Error', {
        method,
        endpoint: sanitizedUrl,
        status: response.status,
        error: apiError.message,
      });
      throw apiError;
    }

    // For /migrations endpoint: HTTP 200 with {} = success
    // For /query endpoint: check for error field in body
    // Note: Supabase Management API returns HTTP 200 even for query errors; error is in response body
    if (endpoint.includes('/database/migrations')) {
      // Success = HTTP 200 (already checked response.ok)
      // Body is empty object {} per docs
      this.logger?.debug('[SupabaseClient] Migration applied successfully');
      return {} as T;
    }

    if (endpoint.includes('/database/query')) {
      const queryResponse = responseData as SupabaseQueryResponse;
      if (queryResponse.error) {
        this.logger?.warn('[SupabaseClient] Query returned error', { error: queryResponse.error });
        throw new SupabaseApiError(
          response.status,
          sanitizedUrl,
          method,
          queryResponse.error
        );
      }
      this.logger?.debug('[SupabaseClient] Query succeeded');
      return queryResponse as T;
    }

    this.logger?.debug('[SupabaseClient] Success', { method, endpoint: sanitizedUrl });
    return responseData as T;
  }

  /**
   * GET /v1/projects/{ref}
   * Get project details including connection strings
   */
  async getProject(ref: string): Promise<SupabaseProjectResponse> {
    return this.request<SupabaseProjectResponse>('GET', `/projects/${ref}`);
  }

  /**
   * POST /v1/projects
   * Create a new Supabase project
   */
  async createProject(data: SupabaseCreateProjectRequest): Promise<SupabaseCreateProjectResponse> {
    return this.request<SupabaseCreateProjectResponse>('POST', '/projects', data);
  }

  /**
   * Validate connection by attempting to get project details
   * Used for adoption mode validation
   */
  async validateProjectAccess(ref: string): Promise<boolean> {
    try {
      await this.getProject(ref);
      return true;
    } catch (error) {
      if (error instanceof SupabaseNotFoundError || error instanceof SupabaseAuthError || error instanceof SupabaseForbiddenError) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Health check - validate PAT works
   */
  async healthCheck(): Promise<boolean> {
    try {
      // List projects is a lightweight call to validate auth
      await this.request<{ projects: unknown[] }>('GET', '/projects');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * POST /v1/projects/{ref}/database/migrations
   * Apply a SINGLE database migration
   * Returns void on success (HTTP 200 with empty body)
   * Throws on HTTP error or timeout
   */
  async applyMigration(ref: string, migrationSql: string, customTimeoutMs?: number): Promise<void> {
    await this.request<void>(
      'POST',
      `/projects/${ref}/database/migrations`,
      { query: migrationSql },
      customTimeoutMs
    );
  }

  /**
   * POST /v1/projects/{ref}/database/query
   * Execute arbitrary SQL query (for seed data, history checks)
   * Returns parsed response with result[] or throws on error field
   */
  async executeQuery(ref: string, query: string): Promise<SupabaseQueryResponse> {
    return this.request<SupabaseQueryResponse>('POST', `/projects/${ref}/database/query`, { query });
  }
}

/**
 * Factory function to create client from SecretStore
 * Resolves accessToken from global secrets
 */
export async function createSupabaseClientFromSecrets(
  getGlobalSecret: (key: 'supabase.accessToken') => Promise<string | null>,
  logger?: EngineContext['logger'],
  config?: Partial<SupabaseClientConfig>
): Promise<SupabaseHttpClient | null> {
  const accessToken = await getGlobalSecret('supabase.accessToken');
  if (!accessToken) {
    logger?.warn('[SupabaseClient] No access token found in secrets');
    return null;
  }
  return new SupabaseHttpClient({ accessToken, logger, ...config });
}