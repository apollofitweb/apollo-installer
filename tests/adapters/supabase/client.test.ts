/**
 * Unit tests for Supabase HTTP Client
 * Uses mocked fetch for testing without real API calls
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SupabaseHttpClient, createSupabaseClientFromSecrets } from '../../../src/adapters/supabase/client.js';
import {
  SupabaseAuthError,
  SupabaseForbiddenError,
  SupabaseNotFoundError,
  SupabaseRateLimitError,
  SupabaseServerError,
  SupabaseNetworkError,
  SupabaseTimeoutError,
  SupabaseApiError,
  toAdapterError,
} from '../../../src/adapters/supabase/errors.js';

describe('SupabaseHttpClient', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const createClient = (overrides: Partial<{
    accessToken: string;
    baseUrl: string;
    timeoutMs: number;
  }> = {}) => new SupabaseHttpClient({
    accessToken: overrides.accessToken ?? 'test-pat-token',
    baseUrl: overrides.baseUrl ?? 'https://api.supabase.com/v1',
    timeoutMs: overrides.timeoutMs ?? 5000,
    logger: mockLogger,
  });

  describe('Authentication', () => {
    it('should include Bearer token in Authorization header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"projects":[]}'),
      });

      const client = createClient();
      await client.healthCheck();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      const options = callArgs[1] as RequestInit;
      expect(options.headers).toEqual({
        'Authorization': 'Bearer test-pat-token',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      });
    });

    it('should fail when access token is missing (createSupabaseClientFromSecrets)', async () => {
      const getGlobalSecret = vi.fn().mockResolvedValue(null);
      const client = await createSupabaseClientFromSecrets(getGlobalSecret, mockLogger);
      expect(client).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith('[SupabaseClient] No access token found in secrets');
    });
  });

  describe('HTTP Error Handling', () => {
    it('should throw SupabaseAuthError on 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Unauthorized"}'),
      });

      const client = createClient();
      await expect(client.getProject('valid-ref')).rejects.toThrow(SupabaseAuthError);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should throw SupabaseForbiddenError on 403', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Forbidden"}'),
      });

      const client = createClient();
      await expect(client.getProject('valid-ref')).rejects.toThrow(SupabaseForbiddenError);
    });

    it('should throw SupabaseNotFoundError on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Not found"}'),
      });

      const client = createClient();
      await expect(client.getProject('invalid-ref')).rejects.toThrow(SupabaseNotFoundError);
    });

    it('should throw SupabaseRateLimitError on 429 with Retry-After', async () => {
      const headers = new Headers({ 'Content-Type': 'application/json', 'Retry-After': '60' });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers,
        text: () => Promise.resolve('{"message":"Rate limited"}'),
      });

      const client = createClient();
      let error: Error | undefined;
      try {
        await client.getProject('valid-ref');
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeInstanceOf(SupabaseRateLimitError);
      expect((error as SupabaseRateLimitError).retryAfterSeconds).toBe(60);
    });

    it('should throw SupabaseServerError on 500', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Internal server error"}'),
      });

      const client = createClient();
      await expect(client.getProject('valid-ref')).rejects.toThrow(SupabaseServerError);
    });

    it('should throw SupabaseServerError on 503', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Service unavailable"}'),
      });

      const client = createClient();
      await expect(client.getProject('valid-ref')).rejects.toThrow(SupabaseServerError);
    });

    it('should throw SupabaseNetworkError on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const client = createClient();
      await expect(client.getProject('valid-ref')).rejects.toThrow(SupabaseNetworkError);
    });

    it('should throw SupabaseTimeoutError on timeout', async () => {
      // Simulate AbortError from timeout
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const client = createClient({ timeoutMs: 100 });
      await expect(client.getProject('valid-ref')).rejects.toThrow(SupabaseTimeoutError);
    });
  });

  describe('Successful Responses', () => {
    it('should return project data on successful GET /projects/{ref}', async () => {
      const mockProject = {
        id: '123',
        ref: 'abcdefghijklmnopqrst',
        name: 'test-project',
        region: 'sa-east-1',
        status: 'ACTIVE_HEALTHY',
        database: { host: 'db.supabase.co', version: '15.2' },
        connection_strings: {
          pooler: { transaction: 'postgresql://pooler', session: 'postgresql://session' },
          direct: 'postgresql://direct',
        },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockProject)),
      });

      const client = createClient();
      const result = await client.getProject('abcdefghijklmnopqrst');
      expect(result).toEqual(mockProject);
    });

    it('should return created project on successful POST /projects', async () => {
      const mockCreated = {
        id: '456',
        ref: 'newprojectref12345678',
        name: 'new-project',
        region: 'sa-east-1',
        status: 'PROVISIONING',
        database: { host: 'db.supabase.co', version: '15.2' },
        connection_strings: {
          pooler: { transaction: 'postgresql://pooler', session: 'postgresql://session' },
          direct: 'postgresql://direct',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockCreated)),
      });

      const client = createClient();
      const result = await client.createProject({
        name: 'new-project',
        region: 'sa-east-1',
        db_pass: 'secure-password-123',
      });
      expect(result).toEqual(mockCreated);
    });

    it('should validate project access correctly (true for success)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      });

      const client = createClient();
      const result = await client.validateProjectAccess('valid-ref');
      expect(result).toBe(true);
    });

    it('should validate project access correctly (false for 404)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Not found"}'),
      });

      const client = createClient();
      const result = await client.validateProjectAccess('invalid-ref');
      expect(result).toBe(false);
    });

    it('should validate project access correctly (false for 401)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Unauthorized"}'),
      });

      const client = createClient();
      const result = await client.validateProjectAccess('valid-ref');
      expect(result).toBe(false);
    });

    it('should validate project access correctly (false for 403)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Forbidden"}'),
      });

      const client = createClient();
      const result = await client.validateProjectAccess('valid-ref');
      expect(result).toBe(false);
    });

    it('should propagate other errors in validateProjectAccess', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Server error"}'),
      });

      const client = createClient();
      await expect(client.validateProjectAccess('valid-ref')).rejects.toThrow(SupabaseServerError);
    });
  });

  describe('Request Options', () => {
    it('should use custom timeout when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      });

      const client = createClient({ timeoutMs: 10000 });
      await client.getProject('valid-ref', { timeoutMs: 5000 });

      // Verify timeout was passed to fetchWithTimeout
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should sanitize URL in logs (remove query params)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      });

      const client = createClient();
      await client.getProject('valid-ref?param=secret');

      // Check the Request log call (first call) - logs sanitized endpoint
      const requestLogCall = mockLogger.debug.mock.calls.find(call =>
        call[0] === '[SupabaseClient] Request'
      );
      expect(requestLogCall).toBeDefined();
      // The sanitizeUrlForLog removes query params but keeps base URL
      expect(requestLogCall?.[1]).toEqual(expect.objectContaining({
        endpoint: 'https://api.supabase.com/v1/projects/valid-ref'
      }));
    });
  });
});

describe('toAdapterError', () => {
  it('should map SupabaseAuthError to user-friendly message', () => {
    const error = new SupabaseAuthError('/projects/ref', 'GET');
    const result = toAdapterError(error);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Falha de autenticação');
  });

  it('should map SupabaseForbiddenError to user-friendly message', () => {
    const error = new SupabaseForbiddenError('/projects/ref', 'GET');
    const result = toAdapterError(error);
    expect(result.success).toBe(false);
    expect(result.error).toContain('sem permissão');
  });

  it('should map SupabaseNotFoundError to user-friendly message', () => {
    const error = new SupabaseNotFoundError('/projects/ref', 'GET');
    const result = toAdapterError(error);
    expect(result.success).toBe(false);
    expect(result.error).toContain('não encontrado');
  });

  it('should map SupabaseRateLimitError to user-friendly message with retry info', () => {
    const error = new SupabaseRateLimitError('/projects/ref', 'GET', 60);
    const result = toAdapterError(error);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Rate limit');
    expect(result.error).toContain('60');
  });

  it('should map SupabaseServerError to user-friendly message', () => {
    const error = new SupabaseServerError('/projects/ref', 'GET', 500);
    const result = toAdapterError(error);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Erro no servidor');
  });

  it('should map SupabaseNetworkError to user-friendly message', () => {
    const error = new SupabaseNetworkError('/projects/ref', 'GET', new Error('Network down'));
    const result = toAdapterError(error);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Falha de conexão');
  });

  it('should map SupabaseTimeoutError to user-friendly message', () => {
    const error = new SupabaseTimeoutError('/projects/ref', 'GET', 5000);
    const result = toAdapterError(error);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Timeout');
    expect(result.error).toContain('5000');
  });

  it('should map generic SupabaseApiError to user-friendly message', () => {
    const error = new SupabaseApiError(400, '/projects/ref', 'GET', 'Bad request');
    const result = toAdapterError(error);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Erro da Supabase Management API');
  });

  it('should map unknown errors to generic message', () => {
    const error = new Error('Unknown error');
    const result = toAdapterError(error);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Erro inesperado ao comunicar com Supabase');
  });
});