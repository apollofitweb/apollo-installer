/**
 * Unit tests for Real Supabase Adapter
 * Uses mocked fetch for testing without real API calls
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RealSupabaseAdapter, createRealSupabaseAdapter } from '../../../src/adapters/supabase/real-adapter.js';
import { loadMigrations, loadSeedSql } from '../../../src/adapters/supabase/migrations.js';

// Mock the migrations module to control what migrations are loaded
vi.mock('../../../src/adapters/supabase/migrations.js', () => ({
  loadMigrations: vi.fn(),
  loadSeedSql: vi.fn().mockReturnValue(
    'INSERT INTO "Permission" (id, name, description, "createdAt", "updatedAt") VALUES (gen_random_uuid(), \'*\', \'Full access\', NOW(), NOW()) ON CONFLICT (name) DO NOTHING;' +
    '\\n-- Admin user creation block' +
    '\\nDO $$' +
    '\\nBEGIN' +
    '\\n  INSERT INTO "User" (id, name, login, email, password, "mustChangePassword", "createdAt", "updatedAt")' +
    '\\n  VALUES (gen_random_uuid(), \'Administrador\', \'administrador\', \'admin@apollo.local\', \'${ADMIN_PASSWORD_HASH}\', true, NOW(), NOW())' +
    '\\n  ON CONFLICT (email) DO NOTHING;' +
    '\\nEND $$;'
  ),
  calculateChecksum: vi.fn((sql: string) => {
    // Simple mock: return first 64 chars of hash-like string
    return 'a'.repeat(64);
  }),
  generateMigrationId: vi.fn(() => 'mock-migration-id'),
  validateBcryptHash: vi.fn((hash: string) => /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)),
  DEFAULT_MIGRATIONS_DIR: '/mock/migrations',
  DEFAULT_SEED_SQL_PATH: '/mock/seed.sql',
}));

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
      // Valid bcrypt hash: $2b$10$ + 53 chars (salt + hash)
      supabaseAdminPasswordHash: '$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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

  describe('Other methods (applyMigrations, runSeed, validateConnection via Management API)', () => {
    it('should return error for applyMigrations when projectRef not in config', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.applyMigrations(context, {
        databaseUrl: 'postgresql://...',
        directUrl: 'postgresql://...',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('supabaseProjectRef não disponível');
    });

    it('should return error for runSeed when projectRef not in config', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.runSeed(context, { databaseUrl: 'postgresql://...' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('supabaseProjectRef não disponível');
    });

    it('should return error for validateConnection when projectRef not in config', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContext();
      const result = await adapter.validateConnection(context, { databaseUrl: 'postgresql://...' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('supabaseProjectRef não disponível');
    });
  });

  describe('applyMigrations (via Management API)', () => {
    const mockProjectRef = 'abcdefghijklmnopqrst';

    const createContextWithProjectRef = () => ({
      ...createContext(),
      config: { ...createContext().config, supabaseProjectRef: mockProjectRef },
    });

    const mockMigrations = [
      { name: '20260728120000_init', sql: 'CREATE TABLE test1...', order: 1 },
      { name: '20260728151000_init_auth', sql: 'CREATE TABLE test2...', order: 2 },
    ];

    beforeEach(() => {
      vi.mocked(loadMigrations).mockReturnValue(mockMigrations);
    });

    it('should return 0 applied when all migrations already applied (idempotent)', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContextWithProjectRef();

      // Mock sequence for 2 migrations already applied:
      // 1. Check _prisma_migrations table existence (returns true)
      // 2. Query _prisma_migrations for migration 1 - returns completed
      // 3. Query _prisma_migrations for migration 2 - returns completed
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ table_exists: true }] })),
        })
        // Migration 1 check
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ migration_name: '20260728120000_init', checksum: 'a'.repeat(64), finished_at: '2024-01-01T00:00:00.000Z', rolled_back_at: null, started_at: '2024-01-01T00:00:00.000Z' }] })),
        })
        // Migration 2 check
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ migration_name: '20260728151000_init_auth', checksum: 'a'.repeat(64), finished_at: '2024-01-01T00:00:00.000Z', rolled_back_at: null, started_at: '2024-01-01T00:00:00.000Z' }] })),
        });

      const result = await adapter.applyMigrations(context, {
        databaseUrl: 'postgresql://...',
        directUrl: 'postgresql://...',
      });

      expect(result.success).toBe(true);
      expect(result.data?.migrationsApplied).toBe(0);
      expect(result.data?.migrationNames).toEqual([]);
      // Should call table existence check + 2 _prisma_migrations checks (one per migration)
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[0][0]).toContain('/database/query');
      expect(mockFetch.mock.calls[1][0]).toContain('/database/query');
      expect(mockFetch.mock.calls[2][0]).toContain('/database/query');
    });

    it('should apply only pending migrations when some already applied', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContextWithProjectRef();

      // Mock sequence for 1 applied, 1 pending:
      // 1. Check _prisma_migrations table existence (returns true)
      // 2. Query _prisma_migrations for migration 1 - returns completed
      // 3. Query _prisma_migrations for migration 2 - returns empty (not applied)
      // 4. Register migration 2 as STARTED (INSERT)
      // 5. Apply migration 2 via Management API (POST /database/migrations)
      // 6. Register migration 2 as FINISHED (UPDATE)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ table_exists: true }] })),
        })
        // Migration 1 check - already applied
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ migration_name: '20260728120000_init', checksum: 'a'.repeat(64), finished_at: '2024-01-01T00:00:00.000Z', rolled_back_at: null, started_at: '2024-01-01T00:00:00.000Z' }] })),
        })
        // Migration 2 check - not applied
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Register migration 2 as STARTED
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Apply migration 2 via Management API
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({})),
        })
        // Register migration 2 as FINISHED
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        });

      const result = await adapter.applyMigrations(context, {
        databaseUrl: 'postgresql://...',
        directUrl: 'postgresql://...',
      });

      expect(result.success).toBe(true);
      expect(result.data?.migrationsApplied).toBe(1);
      expect(result.data?.migrationNames).toEqual(['20260728151000_init_auth']);
      // Should call: table check + 2 migration checks + 1 insert + 1 apply + 1 update = 6
      expect(mockFetch).toHaveBeenCalledTimes(6);
      // Third call should be migration 2 check
      expect(mockFetch.mock.calls[2][0]).toContain('/database/query');
      // Fourth call should be INSERT for registration
      expect(mockFetch.mock.calls[3][0]).toContain('/database/query');
      // Fifth call should be to /database/migrations
      expect(mockFetch.mock.calls[4][0]).toContain('/database/migrations');
      // Sixth call should be UPDATE for completion
      expect(mockFetch.mock.calls[5][0]).toContain('/database/query');
    });

    it('should handle fresh database (no _prisma_migrations table)', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContextWithProjectRef();

      // Mock sequence for fresh database (2 migrations):
      // 1. Check _prisma_migrations table existence (returns false - fresh database)
      // 2. CREATE TABLE _prisma_migrations
      // 3. Migration 1 check - not applied
      // 4. Register migration 1 as STARTED (INSERT)
      // 5. Apply migration 1 via Management API
      // 6. Register migration 1 as FINISHED (UPDATE)
      // 7. Migration 2 check - not applied
      // 8. Register migration 2 as STARTED (INSERT)
      // 9. Apply migration 2 via Management API
      // 10. Register migration 2 as FINISHED (UPDATE)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ table_exists: false }] })),
        })
        // Create table
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Migration 1 check - not applied
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Register migration 1 as STARTED
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Apply migration 1 via Management API
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({})),
        })
        // Register migration 1 as FINISHED
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Migration 2 check - not applied
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Register migration 2 as STARTED
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Apply migration 2 via Management API
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({})),
        })
        // Register migration 2 as FINISHED
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        });

      const result = await adapter.applyMigrations(context, {
        databaseUrl: 'postgresql://...',
        directUrl: 'postgresql://...',
      });

      expect(result.success).toBe(true);
      expect(result.data?.migrationsApplied).toBe(2);
      expect(result.data?.migrationNames).toEqual(['20260728120000_init', '20260728151000_init_auth']);
      // Should call: table check + create table + 2*(check + insert + apply + update) = 10
      expect(mockFetch).toHaveBeenCalledTimes(10);
      expect(mockFetch.mock.calls[1][0]).toContain('/database/query'); // create table
      expect(mockFetch.mock.calls[2][0]).toContain('/database/query'); // migration 1 check
      expect(mockFetch.mock.calls[3][0]).toContain('/database/query'); // migration 1 insert
      expect(mockFetch.mock.calls[4][0]).toContain('/database/migrations'); // migration 1 apply
      expect(mockFetch.mock.calls[5][0]).toContain('/database/query'); // migration 1 update
      expect(mockFetch.mock.calls[6][0]).toContain('/database/query'); // migration 2 check
      expect(mockFetch.mock.calls[7][0]).toContain('/database/query'); // migration 2 insert
      expect(mockFetch.mock.calls[8][0]).toContain('/database/migrations'); // migration 2 apply
      expect(mockFetch.mock.calls[9][0]).toContain('/database/query'); // migration 2 update
    });

    it('should return failure when migration fails', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContextWithProjectRef();

      // Mock sequence:
      // 1. Check _prisma_migrations table existence (returns true)
      // 2. Migration 1 check - not applied
      // 3. Register migration 1 as STARTED
      // 4. Apply migration 1 via Management API - SUCCEEDS
      // 5. Register migration 1 as FINISHED
      // 6. Migration 2 check - not applied
      // 7. Register migration 2 as STARTED
      // 8. Apply migration 2 via Management API - FAILS
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ table_exists: true }] })),
        })
        // Migration 1 check
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Register migration 1 as STARTED
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Apply migration 1 - succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({})),
        })
        // Register migration 1 as FINISHED
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Migration 2 check
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Register migration 2 as STARTED
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Apply migration 2 - fails (HTTP 500)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Syntax error' })),
        })
        // Best effort to record failure in _prisma_migrations
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        });

      const result = await adapter.applyMigrations(context, {
        databaseUrl: 'postgresql://...',
        directUrl: 'postgresql://...',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Migration');
      expect(result.error).toContain('20260728151000_init_auth');
      expect(result.data?.migrationsApplied).toBe(1); // Only successful ones
      // Total calls: table check + 2*(check + insert + apply) + 1 finish for first + 1 failure recording = 9
      expect(mockFetch).toHaveBeenCalledTimes(9);
    });

    it('should handle empty migrations directory', async () => {
      mockFetch.mockReset();
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const context = createContextWithProjectRef();

      vi.mocked(loadMigrations).mockReturnValue([]);

      // Mock table existence check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ result: [{ table_exists: true }] })),
      });

      const result = await adapter.applyMigrations(context, {
        databaseUrl: 'postgresql://...',
        directUrl: 'postgresql://...',
      });

      expect(result.success).toBe(true);
      expect(result.data?.migrationsApplied).toBe(0);
      expect(result.data?.migrationNames).toEqual([]);
    });

    it('should continue registration even if individual registration fails', async () => {
    const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
    const context = createContextWithProjectRef();

    // Mock sequence for 2 pending migrations where second registration fails:
    // 1. Check _prisma_migrations table existence (returns true)
    // 2. Migration 1 check - not applied
    // 3. Register migration 1 as STARTED
    // 4. Apply migration 1 - succeeds
    // 5. Register migration 1 as FINISHED - succeeds
    // 6. Migration 2 check - not applied
    // 7. Register migration 2 as STARTED
    // 8. Apply migration 2 - succeeds
    // 9. Register migration 2 as FINISHED - fails (error in body)
    mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ table_exists: true }] })),
        })
        // Migration 1 check
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Register migration 1 as STARTED
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Apply migration 1
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({})),
        })
        // Register migration 1 as FINISHED - succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Migration 2 check
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Register migration 2 as STARTED
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Apply migration 2
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({})),
        })
        // Register migration 2 as FINISHED - returns error in body but HTTP 200
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [], error: 'Registration failed' })),
        });

      const result = await adapter.applyMigrations(context, {
        databaseUrl: 'postgresql://...',
        directUrl: 'postgresql://...',
      });

      expect(result.success).toBe(false); // Registration failure returns inconsistent
      expect(result.error).toContain('Registration failed');
      expect(result.data?.migrationsApplied).toBe(1); // Only first migration fully completed
      expect(result.inconsistent).toBe(true);
    });
  });

  describe('runSeed (via Management API)', () => {
    const mockProjectRef = 'abcdefghijklmnopqrst';

    const createContextWithProjectRef = (overrides: Partial<{ secrets: Record<string, string> }> = {}) => ({
      ...createContext(),
      config: { ...createContext().config, supabaseProjectRef: mockProjectRef },
      secrets: {
        ...createContext().secrets,
        ...overrides.secrets,
      },
    });

    const mockSeedSql =
  'INSERT INTO "Permission" (id, name, description, "createdAt", "updatedAt") VALUES (gen_random_uuid(), \'*\', \'Full access\', NOW(), NOW()) ON CONFLICT (name) DO NOTHING;' +
  '\\nINSERT INTO "Role" (id, name, description, "createdAt", "updatedAt") VALUES (gen_random_uuid(), \'Administrador\', \'Admin role\', NOW(), NOW()) ON CONFLICT (name) DO NOTHING;' +
  '\\nINSERT INTO "User" (id, name, login, email, password, "mustChangePassword", "createdAt", "updatedAt") VALUES (gen_random_uuid(), \'Administrador\', \'administrador\', \'admin@apollo.local\', \'${ADMIN_PASSWORD_HASH}\', true, NOW(), NOW()) ON CONFLICT (email) DO NOTHING;' +
  '\\nINSERT INTO "UserRole" (id, "userId", "roleId", "createdAt") VALUES (gen_random_uuid(), (SELECT id FROM "User" WHERE email = \'admin@apollo.local\'), (SELECT id FROM "Role" WHERE name = \'Administrador\'), NOW()) ON CONFLICT DO NOTHING;';

    beforeEach(() => {
      vi.mocked(loadSeedSql).mockReturnValue(mockSeedSql);
    });

    it('should execute seed with admin password hash and return actual counts including admin user', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const validHash = '$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const context = createContextWithProjectRef({
        secrets: {
          supabaseAdminPasswordHash: validHash
        }
      });

      // Mock sequence (6 calls to /database/query):
      // 1-4. Seed execution statements (POST /database/query) - with substituted password hash
      // 5. Count query after seed (POST /database/query)
      // 6. Admin check query (POST /database/query)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ permissions: '68', roles: '4', user_roles: '1', role_permissions: '212' }] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ exists: true }] })),
        });

      const result = await adapter.runSeed(context, { databaseUrl: 'postgresql://...' });

      expect(result.success).toBe(true);
      expect(result.data?.adminCreated).toBe(true);
      expect(result.data?.permissions).toBe(68);
      expect(result.data?.roles).toBe(4);
      expect(result.data?.userRoles).toBe(1); // Admin user created with role
      expect(result.data?.rolePermissions).toBe(212);
      // Should have made 6 calls to /database/query (4 seed statements + count + admin check)
      expect(mockFetch).toHaveBeenCalledTimes(6);

      // Verify password hash was substituted in the seed SQL call (3rd statement - User insert)
      const seedCallBody = JSON.parse(mockFetch.mock.calls[2][1]?.body as string);
      expect(seedCallBody.query).toContain(validHash);
      expect(seedCallBody.query).not.toContain('${ADMIN_PASSWORD_HASH}');
    });

    it('should return error when no admin password hash provided', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      // No supabaseAdminPasswordHash in secrets
      const context = createContextWithProjectRef({
        secrets: {
          supabaseAdminPasswordHash: undefined
        }
      });

      const result = await adapter.runSeed(context, { databaseUrl: 'postgresql://...' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('supabaseAdminPasswordHash não configurado');
      expect(result.data?.adminCreated).toBe(false);
    });

    it('should handle seed execution error', async () => {
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const validHash = '$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const context = createContextWithProjectRef({
        secrets: {
          supabaseAdminPasswordHash: validHash
        }
      });

      // Seed execution: first statement fails with error in body (HTTP 200 but error field)
      // Then 3 more seed statements + 1 count query + 1 admin check query (total 6 queries)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'Syntax error in seed SQL' })),
        })
        // Remaining 3 seed statements
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        // Count query
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ permissions: '0', roles: '0', user_roles: '0', role_permissions: '0' }] })),
        })
        // Admin check query
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        });

      const result = await adapter.runSeed(context, { databaseUrl: 'postgresql://...' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Seed execution had');
      expect(result.data?.adminCreated).toBe(false);
    });

    it('should be idempotent - running seed twice returns same counts', async () => {
      mockFetch.mockReset();
      const adapter = new RealSupabaseAdapter({ accessToken: 'test-pat-token' });
      const validHash = '$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const context = createContextWithProjectRef({
        secrets: {
          supabaseAdminPasswordHash: validHash
        }
      });

      // First run - 4 seed statements + 1 count query + 1 admin check
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ permissions: '68', roles: '4', user_roles: '1', role_permissions: '212' }] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ exists: true }] })),
        });

      const result1 = await adapter.runSeed(context, { databaseUrl: 'postgresql://...' });
      expect(result1.success).toBe(true);
      expect(result1.data?.adminCreated).toBe(true);
      expect(result1.data?.userRoles).toBe(1);

      // Second run (simulate retry) - 4 seed statements + 1 count query + 1 admin check
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ permissions: '68', roles: '4', user_roles: '1', role_permissions: '212' }] })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ result: [{ exists: true }] })),
        });

      const result2 = await adapter.runSeed(context, { databaseUrl: 'postgresql://...' });
      expect(result2.success).toBe(true);
      expect(result2.data?.adminCreated).toBe(true);
      expect(result2.data?.userRoles).toBe(1); // Same count - idempotent
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
      mockFetch.mockReset();
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
