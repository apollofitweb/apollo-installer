/**
 * Real Supabase Management API Adapter
 * OS-004 Fase 2: Implementa operações reais usando SupabaseHttpClient da Fase 1
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
} from './errors.js';

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
  // Priority 1: Use accessToken from config (for testing)
  if (config.accessToken) {
    return new SupabaseHttpClient({
      accessToken: config.accessToken,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      logger: context.logger,
    });
  }

  // Priority 2: Use getGlobalSecret from config
  if (config.getGlobalSecret) {
    // Note: createSupabaseClientFromSecrets is async, we can't use it here synchronously
    // The caller should use createRealSupabaseAdapter factory for async initialization
    return null;
  }

  // Priority 3: Try to get from context.secrets (for backward compatibility)
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
  // Supabase Management API returns connection_strings with pooler (transaction/session) and direct
  // Use pooler.transaction for application connections (recommended by Supabase)
  // Use direct for migrations and admin operations
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
    // If we have getGlobalSecret, create client from secrets
    if (this.config.getGlobalSecret && !this.config.accessToken) {
      this.client = await createSupabaseClientFromSecrets(
        this.config.getGlobalSecret,
        undefined, // logger will be passed per-operation via context
        {
          baseUrl: this.config.baseUrl,
          timeoutMs: this.config.timeoutMs,
        }
      );
    }
  }

  private getClient(context: EngineContext): SupabaseHttpClient {
    if (this.client) {
      // Update logger for current context
      this.client = new SupabaseHttpClient({
        accessToken: (this.client as any).accessToken, // Access private field via type assertion for re-creation
        baseUrl: (this.client as any).baseUrl,
        timeoutMs: (this.client as any).defaultTimeoutMs,
        logger: context.logger,
      });
      return this.client;
    }

    // Create client per-operation if not initialized
    const client = getClientFromContext(context, this.config);
    if (!client) {
      throw new Error('Supabase adapter not configured: missing accessToken or getGlobalSecret');
    }
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
    // Real adapter validates via secrets, not config
    // Check if we have access to PAT
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
      // ADOPTION MODE: existingProjectRef provided
      if (existingProjectRef) {
        context.logger.info('[RealSupabase] Adoption mode - fetching existing project', {
          existingProjectRef,
        });

        // GET /v1/projects/{ref} - validate project exists and get connection strings
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
          throw error; // Re-throw unknown errors
        }

        // Validate that the project exists and is healthy
        if (!project || !project.ref) {
          return {
            success: false,
            error: `Resposta inválida da Supabase Management API para projeto ${existingProjectRef}: dados do projeto ausentes.`,
          };
        }

        // Validate project status - must be ACTIVE_HEALTHY or similar
        const healthyStatuses = ['ACTIVE_HEALTHY', 'ACTIVE', 'HEALTHY'];
        if (!healthyStatuses.includes(project.status)) {
          context.logger.warn('[RealSupabase] Project status not healthy', {
            existingProjectRef,
            status: project.status,
          });
          // Don't fail - just warn. Project might be provisioning.
        }

        // Validate database password if possible (optional - Supabase doesn't expose this via API)
        // We can't validate dbPassword via Management API, so we trust the user provided the correct one

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

      // CREATION MODE: normal project creation
      context.logger.info('[RealSupabase] Creation mode - creating new project', { slug, region });

      // Validate required parameters for creation
      if (!dbPassword || dbPassword.length < 8) {
        return {
          success: false,
          error: 'dbPassword deve ter pelo menos 8 caracteres para criação de projeto Supabase',
        };
      }

      // Prepare creation request
      // Note: organization_id is optional but recommended for production use
      const createRequest = {
        name: `apollofit-${slug}`,
        region,
        db_pass: dbPassword,
        plan: 'free', // Default to free plan
        // organization_id: undefined - let Supabase use default organization
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
          // Conflict - project might already exist
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

      // New project is PROVISIONING - connection strings may not be immediately available
      // We return what we have, but warn that connection strings might need polling
      let connectionStrings: { databaseUrl: string; directUrl: string };

      try {
        connectionStrings = mapSupabaseProjectToConnectionStrings(createdProject);
      } catch {
        // If connection strings not available yet (provisioning), return placeholder
        // The caller should poll getProject until status is ACTIVE_HEALTHY
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

  async applyMigrations(
    context: EngineContext,
    _params: { databaseUrl: string; directUrl: string }
  ): Promise<AdapterResult<{ migrationsApplied: number }>> {
    // Real implementation would connect to PostgreSQL and apply migrations
    // This is a placeholder - actual implementation requires database connection
    context.logger.warn('[RealSupabase] applyMigrations not implemented in real adapter - requires PostgreSQL connection');
    return {
      success: false,
      error: 'applyMigrations requer conexão PostgreSQL direta - não implementado no adapter HTTP',
    };
  }

  async runSeed(
    context: EngineContext,
    _params: { databaseUrl: string }
  ): Promise<AdapterResult<{ adminCreated: boolean; permissions: number; roles: number; userRoles: number; rolePermissions: number }>> {
    // Real implementation would connect to PostgreSQL and run seed
    // This is a placeholder - actual implementation requires database connection
    context.logger.warn('[RealSupabase] runSeed not implemented in real adapter - requires PostgreSQL connection');
    return {
      success: false,
      error: 'runSeed requer conexão PostgreSQL direta - não implementado no adapter HTTP',
    };
  }

  async validateConnection(
    context: EngineContext,
    _params: { databaseUrl: string }
  ): Promise<AdapterResult<{ connected: boolean }>> {
    // Real implementation would test PostgreSQL connection
    // This is a placeholder - actual implementation requires database connection
    context.logger.warn('[RealSupabase] validateConnection not implemented in real adapter - requires PostgreSQL connection');
    return {
      success: false,
      error: 'validateConnection requer conexão PostgreSQL direta - não implementado no adapter HTTP',
    };
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