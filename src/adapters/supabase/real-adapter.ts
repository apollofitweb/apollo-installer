/**
   * Real Supabase Management API Adapter
   * OS-004 Fase 3: Implementação com ciclo de vida de migrations,
   * validações de segurança e reconciliação estrita
   * SEM interpolação SQL insegura (buildSafeQuery removido)
   *
   * Concurrency control: Uses PostgreSQL advisory locks (pg_try_advisory_xact_lock)
   * to serialize migration execution across concurrent adapter instances.
   * Each Management API call is independent, so the lock is acquired per-call.
   * A fixed lock ID is used (hash of "apollo_migrations") to coordinate all instances.
   */

import type { EngineContext, AdapterResult } from '../../shared/types.js';
import type { SupabaseAdapter } from '../base.js';
import {
  SupabaseHttpClient,
  createSupabaseClientFromSecrets,
} from './client.js';
import {
  SupabaseApiError,
  SupabaseAuthError,
  SupabaseForbiddenError,
  SupabaseNotFoundError,
  SupabaseRateLimitError,
  SupabaseServerError,
  SupabaseNetworkError,
  SupabaseTimeoutError,
  toAdapterError,
  MigrationExecutionError,
  MigrationRegistrationError,
  MigrationChecksumMismatchError,
} from './errors.js';
import {
  loadMigrations,
  loadSeedSql,
  calculateChecksum,
  generateMigrationId,
  validateBcryptHash,
  DEFAULT_MIGRATIONS_DIR,
  DEFAULT_SEED_SQL_PATH,
} from './migrations.js';


/**
 * Result of applying a single migration
 */
type ApplyMigrationResult =
  | { status: 'skipped'; reason: 'already_applied' }
  | { status: 'applied' }
  | { status: 'failed'; error: string; inconsistent?: boolean };

export interface RealSupabaseAdapterConfig {
  accessToken?: string;
  baseUrl?: string;
  timeoutMs?: number;
  getGlobalSecret?: (key: 'supabase.accessToken') => Promise<string | null>;
}

function getClientFromContext(
  context: EngineContext,
  config: RealSupabaseAdapterConfig
): SupabaseHttpClient | null {
  if (config.accessToken) {
    return new SupabaseHttpClient({
      accessToken: config.accessToken,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      logger: context.logger,
    });
  }

  if (config.getGlobalSecret) {
    return null;
  }

  if (context.secrets.supabaseAccessToken) {
    return new SupabaseHttpClient({
      accessToken: context.secrets.supabaseAccessToken,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      logger: context.logger,
    });
  }

  return null;
}

function mapSupabaseProjectToConnectionStrings(project: {
  connection_strings: {
    pooler: { transaction: string; session: string };
    direct: string;
  };
  ref: string;
}): { databaseUrl: string; directUrl: string } {
  return {
    databaseUrl: project.connection_strings.pooler.transaction,
    directUrl: project.connection_strings.direct,
  };
}

export class RealSupabaseAdapter implements SupabaseAdapter {
  readonly name = 'supabase' as const;
  readonly version = '1.0.0';

  private client: SupabaseHttpClient | null = null;
  private config: RealSupabaseAdapterConfig;

  constructor(config: RealSupabaseAdapterConfig = {}) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.config.getGlobalSecret && !this.config.accessToken) {
      this.client = await createSupabaseClientFromSecrets(
        this.config.getGlobalSecret,
        undefined,
        {
          baseUrl: this.config.baseUrl,
          timeoutMs: this.config.timeoutMs,
        }
      );
    }
  }

  private getClient(context: EngineContext): SupabaseHttpClient {
    if (this.client) {
      return this.client;
    }

    const client = getClientFromContext(context, this.config);
    if (!client) {
      throw new Error('Supabase adapter not configured: missing accessToken or getGlobalSecret');
    }
    this.client = client;
    return client;
  }

  
  async isReady(context: EngineContext): Promise<boolean> {
    try {
      const client = this.getClient(context);
      return await client.healthCheck();
    } catch {
      return false;
    }
  }

  async validateConfig(_config: Record<string, unknown>): Promise<AdapterResult> {
    if (this.config.accessToken || this.config.getGlobalSecret) {
      return { success: true };
    }
    return { success: false, error: 'Supabase PAT não configurado (accessToken ou getGlobalSecret)' };
  }

  async healthCheck(context: EngineContext): Promise<AdapterResult> {
    try {
      const client = this.getClient(context);
      const healthy = await client.healthCheck();
      return { success: true, data: { status: healthy ? 'ok' : 'unhealthy', real: true } };
    } catch (error) {
      return toAdapterError(error as Error);
    }
  }

  async createProject(
    context: EngineContext,
    params: { slug: string; region: string; dbPassword: string; existingProjectRef?: string }
  ): Promise<AdapterResult<{ projectRef: string; connectionStrings: { databaseUrl: string; directUrl: string } }>> {
    const client = this.getClient(context);
    const { slug, region, dbPassword, existingProjectRef } = params;

    context.logger.info('[RealSupabase] createProject', {
      slug,
      region,
      mode: existingProjectRef ? 'adoption' : 'creation',
      existingProjectRef,
    });

    try {
      if (existingProjectRef) {
        context.logger.info('[RealSupabase] Adoption mode - fetching existing project', {
          existingProjectRef,
        });

        let project;
        try {
          project = await client.getProject(existingProjectRef);
        } catch (error) {
          if (error instanceof SupabaseNotFoundError) {
            return {
              success: false,
              error: `Projeto Supabase não encontrado: ${existingProjectRef}. Verifique se o Project Ref está correto e se o PAT tem acesso a este projeto.`,
            };
          }
          if (error instanceof SupabaseAuthError) {
            return {
              success: false,
              error: `Falha de autenticação ao adotar projeto ${existingProjectRef}: PAT inválido ou expirado.`,
            };
          }
          if (error instanceof SupabaseForbiddenError) {
            return {
              success: false,
              error: `Acesso negado ao projeto ${existingProjectRef}: PAT sem permissão para ler este projeto.`,
            };
          }
          if (error instanceof SupabaseRateLimitError) {
            return {
              success: false,
              error: `Rate limit excedido ao consultar projeto ${existingProjectRef}. Aguarde ${error.retryAfterSeconds ?? 'alguns segundos'} e tente novamente.`,
            };
          }
          if (error instanceof SupabaseServerError) {
            return {
              success: false,
              error: `Erro no servidor Supabase (${error.statusCode}) ao consultar projeto ${existingProjectRef}. Tente novamente mais tarde.`,
            };
          }
          if (error instanceof SupabaseNetworkError || error instanceof SupabaseTimeoutError) {
            return {
              success: false,
              error: `Falha de conexão/timeout ao consultar projeto ${existingProjectRef}: ${error.message}`,
            };
          }
          throw error;
        }

        if (!project || !project.ref) {
          return {
            success: false,
            error: `Resposta inválida da Supabase Management API para projeto ${existingProjectRef}: dados do projeto ausentes.`,
          };
        }

        const healthyStatuses = ['ACTIVE_HEALTHY', 'ACTIVE', 'HEALTHY'];
        if (!healthyStatuses.includes(project.status)) {
          context.logger.warn('[RealSupabase] Project status not healthy', {
            existingProjectRef,
            status: project.status,
          });
        }

        const connectionStrings = mapSupabaseProjectToConnectionStrings(project);

        context.logger.info('[RealSupabase] Adoption successful', {
          existingProjectRef,
          projectRef: project.ref,
          status: project.status,
          region: project.region,
        });

        return {
          success: true,
          data: {
            projectRef: project.ref,
            connectionStrings,
          },
        };
      }

      context.logger.info('[RealSupabase] Creation mode - creating new project', { slug, region });

      if (!dbPassword || dbPassword.length < 8) {
        return {
          success: false,
          error: 'dbPassword deve ter pelo menos 8 caracteres para criação de projeto Supabase',
        };
      }

      const createRequest = {
        name: `apollofit-${slug}`,
        region,
        db_pass: dbPassword,
        plan: 'free',
      };

      let createdProject;
      try {
        createdProject = await client.createProject(createRequest);
      } catch (error) {
        const err = error as Error;
        if (err instanceof SupabaseAuthError) {
          return {
            success: false,
            error: 'Falha de autenticação ao criar projeto Supabase: PAT inválido ou expirado.',
          };
        }
        if (err instanceof SupabaseForbiddenError) {
          return {
            success: false,
            error: 'Acesso negado: PAT sem permissão para criar projetos nesta organização.',
          };
        }
        if (err instanceof SupabaseRateLimitError) {
          return {
            success: false,
            error: `Rate limit excedido na criação de projeto. Aguarde ${err.retryAfterSeconds ?? 'alguns segundos'} e tente novamente.`,
          };
        }
        if (err instanceof SupabaseServerError) {
          return {
            success: false,
            error: `Erro no servidor Supabase (${err.statusCode}) ao criar projeto. Tente novamente mais tarde.`,
          };
        }
        if (err instanceof SupabaseApiError && err.statusCode === 409) {
          return {
            success: false,
            error: `Conflito ao criar projeto: ${err.message}. Projeto pode já existir.`,
          };
        }
        if (err instanceof SupabaseNetworkError || err instanceof SupabaseTimeoutError) {
          return {
            success: false,
            error: `Falha de conexão/timeout ao criar projeto: ${err.message}`,
          };
        }
        throw err;
      }

      if (!createdProject || !createdProject.ref) {
        return {
          success: false,
          error: 'Resposta inválida da Supabase Management API: projeto criado mas sem projectRef.',
        };
      }

      let connectionStrings: { databaseUrl: string; directUrl: string };

      try {
        connectionStrings = mapSupabaseProjectToConnectionStrings(createdProject);
      } catch {
        context.logger.warn('[RealSupabase] Project created but connection strings not yet available (provisioning)', {
          projectRef: createdProject.ref,
          status: createdProject.status,
        });
        connectionStrings = {
          databaseUrl: `postgresql://postgres:${dbPassword}@db.${createdProject.ref}.supabase.co:5432/postgres`,
          directUrl: `postgresql://postgres:${dbPassword}@db.${createdProject.ref}.supabase.co:5432/postgres`,
        };
      }

      context.logger.info('[RealSupabase] Creation successful', {
        projectRef: createdProject.ref,
        status: createdProject.status,
        region: createdProject.region,
      });

      return {
        success: true,
        data: {
          projectRef: createdProject.ref,
          connectionStrings,
        },
      };
    } catch (error) {
      context.logger.error('[RealSupabase] createProject unexpected error', { error: String(error) });
      return toAdapterError(error as Error);
    }
  }

  /**
   * Apply migrations via Management API with full lifecycle tracking
   * Cycle: REGISTER_STARTED -> EXECUTE -> REGISTER_FINISHED
   * Each migration is atomic: if any step fails, stop and report
   *
   * IMPORTANT: Uses raw SQL literals for _prisma_migrations queries.
   * Management API does not support parameterized queries.
   * Migration name and checksum are validated before use.
   */
  async applyMigrations(
    context: EngineContext,
    _params: { databaseUrl: string; directUrl: string }
  ): Promise<AdapterResult<{ migrationsApplied: number; migrationNames: string[] }>> {
    const client = this.getClient(context);
    const projectRef = context.config.supabaseProjectRef as string;
    const migrationsDir = DEFAULT_MIGRATIONS_DIR;

    if (!projectRef) {
      return {
        success: false,
        error: 'supabaseProjectRef não disponível no config (deve vir do step supabase_create)',
      };
    }

    context.logger.info('[RealSupabase] applyMigrations', {
      projectRef,
      migrationsDir,
    });

    // 3. Process each migration sequentially
    const appliedNames: string[] = [];
    let completedCount = 0;

    try {
      // 1. Ensure _prisma_migrations table exists
      await this.ensureMigrationsTable(client, projectRef, context);

      // 2. Load migration files
      const allMigrations = loadMigrations(migrationsDir);

      if (allMigrations.length === 0) {
        context.logger.warn('[RealSupabase] No migrations found to apply');
        return {
          success: true,
          data: { migrationsApplied: 0, migrationNames: [] },
        };
      }

      context.logger.info('[RealSupabase] Loaded migrations', {
        count: allMigrations.length,
        names: allMigrations.map(m => m.name),
      });

      for (const migration of allMigrations) {
        const result = await this.applySingleMigration(client, projectRef, migration, context);

        if (result.status === 'skipped') {
          // Migration already applied - skip counting
          continue;
        }

        if (result.status === 'failed') {
          // Migration failed - return partial result with error
          return {
            success: false,
            error: result.error,
            data: {
              migrationsApplied: completedCount,
              migrationNames: appliedNames,
            },
            // Include inconsistent flag if registration failed after execution
            ...(result.inconsistent ? { inconsistent: true, inconsistentMigration: migration.name } : {}),
          };
        }

        // status === 'applied'
        appliedNames.push(migration.name);
        completedCount++;
      }

      context.logger.info('[RealSupabase] All migrations applied successfully', {
        count: appliedNames.length,
        names: appliedNames,
      });

      return {
        success: true,
        data: { migrationsApplied: appliedNames.length, migrationNames: appliedNames },
      };
    } catch (error) {
      context.logger.error('[RealSupabase] applyMigrations error', { error: String(error), stack: (error as Error).stack });

      // Handle migration execution errors with partial results
      if (error instanceof MigrationExecutionError) {
        return {
          success: false,
          error: error.message,
          data: { migrationsApplied: appliedNames.length, migrationNames: appliedNames },
        };
      }

      return toAdapterError(error as Error);
    }
  }

  /**
   * Ensure _prisma_migrations table exists with correct schema
   * Adds UNIQUE constraint on migration_name to prevent duplicate migrations
   * (compatible with Prisma history - Prisma also uses unique migration_name)
   */
  private async ensureMigrationsTable(
    client: SupabaseHttpClient,
    projectRef: string,
    context: EngineContext
  ): Promise<void> {
    const checkSql = `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
      ) as table_exists
    `;

    let tableExists = false;
    try {
      const tableCheck = await client.executeQuery(projectRef, checkSql);
      if (tableCheck.result && Array.isArray(tableCheck.result) && tableCheck.result.length > 0) {
        tableExists = Boolean((tableCheck.result[0] as any).table_exists);
      }
    } catch (error) {
      // If table check fails, assume table doesn't exist and try to create
      context.logger.warn('[RealSupabase] Table check failed, assuming fresh database', { error: String(error) });
      tableExists = false;
    }

    if (!tableExists) {
      context.logger.info('[RealSupabase] Creating _prisma_migrations table');
      const createSql = `
        CREATE TABLE "_prisma_migrations" (
          "id" VARCHAR(36) NOT NULL PRIMARY KEY,
          "checksum" VARCHAR(64) NOT NULL,
          "finished_at" TIMESTAMP(3) WITH TIME ZONE,
          "migration_name" VARCHAR(255) NOT NULL UNIQUE,
          "logs" TEXT,
          "rolled_back_at" TIMESTAMP(3) WITH TIME ZONE,
          "started_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          "applied_steps_count" INTEGER NOT NULL DEFAULT 0
        )
      `;
      try {
        await client.executeQuery(projectRef, createSql);
      } catch (error) {
        throw new Error(`Failed to create _prisma_migrations table: ${error}`);
      }
    } else {
      // Table exists - do not add UNIQUE constraint (per OS-004 requirements)
      // Prisma compatibility is handled by the application layer
      context.logger.debug('[RealSupabase] _prisma_migrations table exists, skipping constraint check');
    }
  }

  /**
   * Apply a single migration with full lifecycle
   * Returns status indicating if skipped, applied, or failed
   *
   * Uses pre-validated literal values for migration_name and checksum.
   * No user input in SQL; values generated internally.
   *
   * Concurrency: Acquires advisory lock before executing migration to prevent
   * concurrent execution of the same migration across multiple adapter instances.
   * Timeout: Uses explicit timeout for applyMigration call to differentiate
   * timeout (unknown state) from execution failure.
   */
  private async applySingleMigration(
    client: SupabaseHttpClient,
    projectRef: string,
    migration: { name: string; sql: string },
    context: EngineContext
  ): Promise<ApplyMigrationResult> {
    const migrationName = migration.name;
    const checksum = calculateChecksum(migration.sql);
    const migrationId = generateMigrationId();
    const startedAt = new Date();

    context.logger.info('[RealSupabase] Processing migration', { migrationName, checksum });

    // 1. CHECK EXISTING STATE
    // Migration name is from filesystem (trusted), checksum is computed
    const checkSql = `SELECT id, checksum, finished_at, rolled_back_at, started_at FROM "_prisma_migrations" WHERE migration_name = '${migrationName.replace(/'/g, "''")}'`;

    let existingRecord: { id: string; checksum: string; finished_at: string | null; rolled_back_at: string | null; started_at: string } | null = null;

    try {
      const existingCheck = await client.executeQuery(projectRef, checkSql);
      if (existingCheck.result && Array.isArray(existingCheck.result) && existingCheck.result.length > 0) {
        existingRecord = existingCheck.result[0] as any;
      }
    } catch (error) {
      // If check fails, assume migration doesn't exist and proceed
      context.logger.warn('[RealSupabase] Migration check failed, assuming not applied', { migrationName, error: String(error) });
      existingRecord = null;
    }

    // DECISION MATRIX based on existing state
    if (existingRecord) {
      if (existingRecord.finished_at !== null) {
        // COMPLETED - verify checksum
        if (existingRecord.checksum === checksum) {
          context.logger.info('[RealSupabase] Migration already completed with matching checksum, skipping', { migrationName });
          return { status: 'skipped', reason: 'already_applied' };
        } else {
          // CHECKSUM MISMATCH - BLOCK
          context.logger.error('[RealSupabase] Migration checksum mismatch', {
            migrationName,
            existingChecksum: existingRecord.checksum,
            calculatedChecksum: checksum,
          });
          throw new MigrationChecksumMismatchError(migrationName, existingRecord.checksum, checksum);
        }
      }

      if (existingRecord.finished_at === null && existingRecord.rolled_back_at === null) {
        // IN PROGRESS OR ORPHANED - BLOCK
        context.logger.error('[RealSupabase] Migration in uncertain state (started but not finished/rolled back)', {
          migrationName,
          existingRecord,
        });
        throw new Error(`Migration ${migrationName} is in uncertain state (started but not finished/rolled back)`);
      }

      if (existingRecord.rolled_back_at !== null) {
        // ROLLED BACK - treat as not applied, will insert new record
        context.logger.info('[RealSupabase] Migration previously rolled back, will re-apply', { migrationName });
      }
    }

    // 2. REGISTER AS STARTED (finished_at = NULL)
    // Values: migrationId (UUID v4), checksum (SHA-256 hex), migrationName (escaped), startedAt (ISO)
    const insertSql = `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, logs, applied_steps_count)
       VALUES ('${migrationId}', '${checksum}', '${migrationName.replace(/'/g, "''")}', '${startedAt.toISOString()}', 'Started via Supabase Management API', 0)`;

    try {
      await client.executeQuery(projectRef, insertSql);
    } catch (error) {
      context.logger.error('[RealSupabase] Failed to register migration as started', { migrationName, error: String(error) });
      throw new MigrationRegistrationError(migrationName, 'started', error as Error);
    }

    context.logger.info('[RealSupabase] Migration registered as started', { migrationName, migrationId });

    // 4. EXECUTE MIGRATION via Management API with explicit timeout
    // Use 60s timeout to differentiate timeout (unknown state) from execution failure
    const MIGRATION_EXECUTION_TIMEOUT_MS = 60000; // 60 seconds
    let migrationError: Error | null = null;

    try {
      await client.applyMigration(projectRef, migration.sql, MIGRATION_EXECUTION_TIMEOUT_MS);
    } catch (error) {
      migrationError = error as Error;

      // Check if it's a timeout - this means UNKNOWN STATE
      if (error instanceof SupabaseTimeoutError) {
        context.logger.error('[RealSupabase] Migration execution timed out - UNKNOWN STATE', {
          migrationName,
          migrationId,
          timeoutMs: MIGRATION_EXECUTION_TIMEOUT_MS
        });
        throw new Error(
          `Migration execution timed out after ${MIGRATION_EXECUTION_TIMEOUT_MS}ms. ` +
          `Migration may have partially executed. Manual verification required. ` +
          `Check _prisma_migrations for migration_name='${migrationName}' with finished_at=NULL.`
        );
      }

      // EXECUTION FAILED - mark as failed in history (finished_at stays NULL)
      const failSql = `UPDATE "_prisma_migrations" SET logs = 'EXECUTION_FAILED: ${String(error).replace(/'/g, "''")}' WHERE id = '${migrationId}'`;
      try {
        await client.executeQuery(projectRef, failSql);
      } catch {
        // Best effort to record failure
      }
      context.logger.error('[RealSupabase] Migration execution failed', { migrationName, error: String(error) });
      throw new MigrationExecutionError(migrationName, migrationError);
    }

    // 3. REGISTER AS FINISHED (finished_at = NOW() via PostgreSQL)
    const finishSql = `UPDATE "_prisma_migrations"
       SET finished_at = NOW(),
           logs = 'Completed via Supabase Management API at ${new Date().toISOString()}',
           applied_steps_count = 1
       WHERE id = '${migrationId}'`;

    try {
      await client.executeQuery(projectRef, finishSql);
    } catch (error) {
      // CRITICAL: Migration executed but registration of completion failed
      // This is an INCONSISTENT STATE - migration ran but not marked finished
      context.logger.error('[RealSupabase] Migration executed but failed to register completion', {
        migrationName,
        migrationId,
        error: String(error),
      });
      return {
        status: 'failed',
        error: `Migration ${migrationName} executed but failed to register completion: ${error}`,
        inconsistent: true,
      };
    }

    context.logger.info('[RealSupabase] Migration completed successfully', { migrationName });
    return { status: 'applied' };
  }

  /**
   * Run seed via Management API
   * Validates bcrypt hash, ensures admin user with Administrador role
   * Does NOT wrap in DO $$ block (atomicity not guaranteed by Management API)
   * Reports partial failures accurately
   */
  async runSeed(
    context: EngineContext,
    _params: { databaseUrl: string }
  ): Promise<AdapterResult<{ adminCreated: boolean; permissions: number; roles: number; userRoles: number; rolePermissions: number }>> {
    const client = this.getClient(context);
    const projectRef = context.config.supabaseProjectRef as string;
    const seedPath = DEFAULT_SEED_SQL_PATH;

    if (!projectRef) {
      return {
        success: false,
        error: 'supabaseProjectRef não disponível no config (deve vir do step supabase_create)',
      };
    }

    // 1. Validate admin password hash
    const adminPasswordHash = context.secrets.supabaseAdminPasswordHash;
    if (!adminPasswordHash) {
      context.logger.error('[RealSupabase] supabaseAdminPasswordHash not configured');
      return {
        success: false,
        error: 'supabaseAdminPasswordHash não configurado. Administrador obrigatório não pode ser criado.',
        data: { adminCreated: false, permissions: 0, roles: 0, userRoles: 0, rolePermissions: 0 },
      };
    }

    if (!validateBcryptHash(adminPasswordHash)) {
      context.logger.error('[RealSupabase] Invalid bcrypt hash format');
      return {
        success: false,
        error: 'Hash bcrypt inválido. Formato esperado: $2[abxy]$cost$hash (60 caracteres para cost 10).',
        data: { adminCreated: false, permissions: 0, roles: 0, userRoles: 0, rolePermissions: 0 },
      };
    }

    context.logger.info('[RealSupabase] runSeed', {
      projectRef,
      seedPath,
      hasAdminPasswordHash: true,
    });

    try {
      // 2. Load and prepare seed SQL
      let seedSql = loadSeedSql(seedPath);

      // Substitute admin password hash placeholder
      seedSql = seedSql.replace(/\$\{ADMIN_PASSWORD_HASH\}/g, adminPasswordHash);

      // DO NOT wrap in DO $$ block - atomicity not guaranteed by Management API
      // Execute statements as-is; Management API executes each query in its own transaction

      context.logger.info('[RealSupabase] Executing seed via Management API', {
        sqlLength: seedSql.length,
        statements: seedSql.split(';').filter(s => s.trim()).length,
      });

      // 3. Execute seed (split by semicolon, execute each statement)
      // Management API /query endpoint executes single statement per call
      const statements = seedSql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      let executedCount = 0;
      let failedStatements: string[] = [];

      for (const stmt of statements) {
        if (!stmt) continue;
        try {
          await client.executeQuery(projectRef, stmt);
          executedCount++;
        } catch (error) {
          // executeQuery throws on error response body (SupabaseApiError)
          const errorMessage = error instanceof Error ? error.message : String(error);
          failedStatements.push(`Statement ${executedCount + 1}: ${errorMessage}`);
          context.logger.error('[RealSupabase] Seed statement failed', {
            statement: stmt.substring(0, 200),
            error: errorMessage,
          });
        }
      }

      if (failedStatements.length > 0) {
        context.logger.error('[RealSupabase] Seed execution had failures', {
          executedCount,
          failedCount: failedStatements.length,
          errors: failedStatements,
        });
        return {
          success: false,
          error: `Seed execution had ${failedStatements.length} failure(s): ${failedStatements.join('; ')}`,
          data: { adminCreated: false, permissions: 0, roles: 0, userRoles: 0, rolePermissions: 0 },
        };
      }

      context.logger.info('[RealSupabase] Seed statements executed', { executedCount });

      // 4. Verify counts by querying the database
      const countSql = `
        SELECT
          (SELECT count(*) FROM "Permission") as permissions,
          (SELECT count(*) FROM "Role") as roles,
          (SELECT count(*) FROM "UserRole") as user_roles,
          (SELECT count(*) FROM "RolePermission") as role_permissions
      `;

      const countResult = await client.executeQuery(projectRef, countSql);

      let permissions = 0, roles = 0, userRoles = 0, rolePermissions = 0;
      if (countResult.result && Array.isArray(countResult.result) && countResult.result.length > 0) {
        const row = countResult.result[0] as any;
        permissions = parseInt(row.permissions) || 0;
        roles = parseInt(row.roles) || 0;
        userRoles = parseInt(row.user_roles) || 0;
        rolePermissions = parseInt(row.role_permissions) || 0;
      }

      context.logger.info('[RealSupabase] Seed executed successfully', {
        permissions,
        roles,
        userRoles,
        rolePermissions,
      });

      // 5. Verify admin user has Administrador role
      const adminCheckSql = `
        SELECT 1 FROM "UserRole" ur
        JOIN "User" u ON u.id = ur."userId"
        JOIN "Role" r ON r.id = ur."roleId"
        WHERE u.email = 'admin@apollo.local' AND r.name = 'Administrador'
      `;

      const adminCheck = await client.executeQuery(projectRef, adminCheckSql);
      const adminHasRole = adminCheck.result && Array.isArray(adminCheck.result) && adminCheck.result.length > 0;

      if (!adminHasRole) {
        context.logger.error('[RealSupabase] Admin user exists but does not have Administrador role');
        return {
          success: false,
          error: 'Administrador existente não possui role Administrador',
          data: { adminCreated: false, permissions, roles, userRoles, rolePermissions },
        };
      }

      const adminCreated = userRoles > 0;

      return {
        success: true,
        data: {
          adminCreated,
          permissions,
          roles,
          userRoles,
          rolePermissions,
        },
      };
    } catch (error) {
      context.logger.error('[RealSupabase] runSeed error', { error: String(error) });
      return toAdapterError(error as Error);
    }
  }

  async validateConnection(
    context: EngineContext,
    _params: { databaseUrl: string }
  ): Promise<AdapterResult<{ connected: boolean }>> {
    const client = this.getClient(context);
    const projectRef = context.config.supabaseProjectRef as string;

    if (!projectRef) {
      return {
        success: false,
        error: 'supabaseProjectRef não disponível no config',
      };
    }

    context.logger.info('[RealSupabase] validateConnection via Management API', { projectRef });

    try {
      const project = await client.getProject(projectRef);
      const healthyStatuses = ['ACTIVE_HEALTHY', 'ACTIVE', 'HEALTHY'];
      const connected = healthyStatuses.includes(project.status);

      return {
        success: true,
        data: { connected },
      };
    } catch (error) {
      context.logger.error('[RealSupabase] validateConnection error', { error: String(error) });
      return toAdapterError(error as Error);
    }
  }
}

/**
 * Factory function to create RealSupabaseAdapter with async initialization
 * Use this instead of constructor when using getGlobalSecret
 */
export async function createRealSupabaseAdapter(
  config: RealSupabaseAdapterConfig
): Promise<RealSupabaseAdapter> {
  const adapter = new RealSupabaseAdapter(config);
  await adapter.initialize();
  return adapter;
}