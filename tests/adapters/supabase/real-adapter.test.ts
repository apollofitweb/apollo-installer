/**
 * Unit tests for Real Supabase Adapter
 * Uses mocked fetch for testing without real API calls
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RealSupabaseAdapter, createRealSupabaseAdapter } from '../../../src/adapters/supabase/real-adapter.js';

describe('RealSupabaseAdapter', () => {
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

  const createContext = (overrides: Partial<{ secrets: Record<string, string> }> = {}) => ({
    deploymentId: 'test-deployment',
    config: { slug: 'test-gym', supabaseRegion: 'sa-east-1' },
    secrets: {
      dbPassword: 'SecurePass123!',
      ...overrides.secrets,
    },
    logger: mockLogger,
  });

  describe('Adoption Mode (existingProjectRef provided)', () => {
    it('should successfully adopt existing project and return connection strings', async () => {
      const mockProject = {
        id: '123',
        ref: 'abcdefghijklmnopqrst',
        name: 'apollofit-test-gym',
        region: 'sa-east-1',
        status: 'ACTIVE_HEALTHY',
        database: { host: 'db.supabase.co', version: '15.2' },
        connection_strings: {
          pooler: {
            transaction: 'postgresql://postgres:password@aws-0-sa-east-1.pooler.supabase.com:5432/postgres',
            session: 'postgresql://postgres:password@aws-0-sa-east-1.pooler.supabase.com:5432/postgres',
          },
          direct: 'postgresql://postgres:password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
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

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
        existingProjectRef: 'abcdefghijklmnopqrst',
      });

      expect(result.success).toBe(true);
      expect(result.data?.projectRef).toBe('abcdefghijklmnopqrst');
      expect(result.data?.connectionStrings.databaseUrl).toBe(mockProject.connection_strings.pooler.transaction);
      expect(result.data?.connectionStrings.directUrl).toBe(mockProject.connection_strings.direct);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toBe('https://api.supabase.com/v1/projects/abcdefghijklmnopqrst');
      expect(call[1]).toEqual(expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-pat-token',
        }),
      }));
    });

    it('should return error when project not found (404)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Not found"}'),
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
        existingProjectRef: 'nonexistent-ref',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('não encontrado');
      expect(result.error).toContain('nonexistent-ref');
    });

    it('should return error when PAT is invalid (401)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Unauthorized"}'),
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'invalid-pat' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
        existingProjectRef: 'abcdefghijklmnopqrst',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Falha de autenticação');
      expect(result.error).toContain('PAT inválido ou expirado');
    });

    it('should return error when PAT has no permission (403)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Forbidden"}'),
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
        existingProjectRef: 'abcdefghijklmnopqrst',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Acesso negado');
      expect(result.error).toContain('sem permissão');
    });

    it('should return error on rate limit (429) with Retry-After', async () => {
      const headers = new Headers({ 'Content-Type': 'application/json', 'Retry-After': '60' });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers,
        text: () => Promise.resolve('{"message":"Rate limited"}'),
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
        existingProjectRef: 'abcdefghijklmnopqrst',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit excedido');
      expect(result.error).toContain('60');
    });

    it('should return error on 5xx server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Internal server error"}'),
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
        existingProjectRef: 'abcdefghijklmnopqrst',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Erro no servidor Supabase (500)');
    });

    it('should return error on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
        existingProjectRef: 'abcdefghijklmnopqrst',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Falha de conexão');
    });

    it('should return error on timeout', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token', timeoutMs: 100 });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
        existingProjectRef: 'abcdefghijklmnopqrst',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');
    });

    it('should return error on invalid API response', async () => {
      // Missing required fields
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"id": "123"}'), // missing ref, connection_strings
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
        existingProjectRef: 'abcdefghijklmnopqrst',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Resposta inválida');
    });

    it('should NEVER call POST /v1/projects in adoption mode', async () => {
      const mockProject = {
        id: '123',
        ref: 'abcdefghijklmnopqrst',
        name: 'apollofit-test-gym',
        region: 'sa-east-1',
        status: 'ACTIVE_HEALTHY',
        database: { host: 'db.supabase.co', version: '15.2' },
        connection_strings: {
          pooler: { transaction: 'postgresql://pooler', session: 'postgresql://pooler' },
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

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
        existingProjectRef: 'abcdefghijklmnopqrst',
      });

      // Verify only GET was called, never POST
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      expect(call[1]).toEqual(expect.objectContaining({ method: 'GET' }));
      expect(call[0]).not.toBe('https://api.supabase.com/v1/projects'); // Not POST to /projects
    });

    it('should fail adoption if error occurs and NEVER trigger creation', async () => {
      // Simulate 500 error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Server error"}'),
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
        existingProjectRef: 'abcdefghijklmnopqrst',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Erro no servidor Supabase');
      // Verify only GET was attempted, no fallback to POST
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      expect(call[1]).toEqual(expect.objectContaining({ method: 'GET' }));
    });
  });

  describe('Creation Mode (no existingProjectRef)', () => {
    it('should create project successfully with valid parameters', async () => {
      const mockCreated = {
        id: '456',
        ref: 'newprojectref12345678',
        name: 'apollofit-test-gym',
        region: 'sa-east-1',
        status: 'PROVISIONING',
        database: { host: 'db.supabase.co', version: '15.2' },
        connection_strings: {
          pooler: {
            transaction: 'postgresql://pooler',
            session: 'postgresql://pooler',
          },
          direct: 'postgresql://direct',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockCreated)),
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
      });

      expect(result.success).toBe(true);
      expect(result.data?.projectRef).toBe('newprojectref12345678');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toBe('https://api.supabase.com/v1/projects');
      expect(call[1]).toEqual(expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-pat-token',
        }),
        body: expect.stringContaining('"name":"apollofit-test-gym"'),
      }));
    });

    it('should return error on creation failure (401)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Unauthorized"}'),
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'invalid-pat' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Falha de autenticação');
    });

    it('should return error on creation failure (403)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Forbidden"}'),
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Acesso negado');
    });

    it('should return error on creation failure (429)', async () => {
      const headers = new Headers({ 'Content-Type': 'application/json', 'Retry-After': '30' });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers,
        text: () => Promise.resolve('{"message":"Rate limited"}'),
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit excedido');
      expect(result.error).toContain('30');
    });

    it('should return error on creation failure (500)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Internal server error"}'),
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Erro no servidor Supabase (500)');
    });

    it('should return error on invalid dbPassword (too short)', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'short',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('pelo menos 8 caracteres');
    });

    it('should return error on network failure during creation', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.createProject(context, {
        slug: 'test-gym',
        region: 'sa-east-1',
        dbPassword: 'SecurePass123!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Falha de conexão');
    });
  });

  describe('Other methods (not implemented in HTTP adapter)', () => {
    it('should return error for applyMigrations', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.applyMigrations(context, {
        databaseUrl: 'postgresql://...',
        directUrl: 'postgresql://...',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('requer conexão PostgreSQL');
    });

    it('should return error for runSeed', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.runSeed(context, { databaseUrl: 'postgresql://...' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('requer conexão PostgreSQL');
    });

    it('should return error for validateConnection', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.validateConnection(context, { databaseUrl: 'postgresql://...' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('requer conexão PostgreSQL');
    });
  });

  describe('createRealSupabaseAdapter factory', () => {
    it('should create and initialize adapter with getGlobalSecret', async () => {
      const mockGetGlobalSecret = vi.fn().mockResolvedValue('pat-from-secrets');
      const adapter = await createRealSupabaseAdapter({ getGlobalSecret: mockGetGlobalSecret });
      expect(adapter).toBeInstanceOf(RealSupabaseAdapter);
    });

    it('should return null client from factory when no PAT in secrets', async () => {
      const mockGetGlobalSecret = vi.fn().mockResolvedValue(null);
      const adapter = await createRealSupabaseAdapter({ getGlobalSecret: mockGetGlobalSecret });
      // Adapter is created but client will be null until PAT is available
      expect(adapter).toBeInstanceOf(RealSupabaseAdapter);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy on successful health check', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"projects":[]}'),
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.healthCheck(context);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({ status: 'ok', real: true }));
    });

    it('should return unhealthy on failed health check', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve('{"message":"Unauthorized"}'),
      });

      const adapter = new RealSupabaseAdapter({ accessToken: 'invalid-pat' });
      const context = createContext();
      const result = await adapter.healthCheck(context);

      expect(result.success).toBe(true); // healthCheck doesn't throw, returns false
      expect(result.data).toEqual(expect.objectContaining({ status: 'unhealthy', real: true }));
    });
  });
});