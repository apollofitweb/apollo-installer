/**
 * Deployment Engine - orchestrates deployment steps
 * Independent from admin interface and adapters
 */

import type {
  EngineContext,
  DeploymentStepDefinition,
  AdapterResult,
  AdapterFactory,
} from '../shared/types.js';
import { deploymentRepository } from '../persistence/deployment.repository.js';
import { createAdapterFactory, createMockAdapterFactory, type SupabaseAdapter, type RenderAdapter, type NetlifyAdapter } from '../adapters/index.js';
import { createChildLogger } from '../shared/logger.js';
import { DeploymentError, StateTransitionError } from '../shared/errors.js';
import { DEPLOYMENT_STEPS } from '../shared/types.js';
import { createSecretStore } from '../secrets/index.js';
import { createDurableSecretStore } from '../secrets/index.js';
import { PrismaClient } from '@prisma/client';

export interface DeploymentEngineConfig {
  adapterFactory: AdapterFactory;
  secretStore?: ReturnType<typeof createSecretStore>;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class DeploymentEngine {
  private adapterFactory: AdapterFactory;
  private secretStore: ReturnType<typeof createSecretStore>;
  private maxRetries: number;
  private retryDelayMs: number;
  private supabaseAdapter: SupabaseAdapter | null = null;
  private renderAdapter: RenderAdapter | null = null;
  private netlifyAdapter: NetlifyAdapter | null = null;
  private supabaseAdapterPromise: Promise<SupabaseAdapter> | null = null;

  constructor(config: DeploymentEngineConfig) {
    this.adapterFactory = config.adapterFactory;
    this.secretStore = config.secretStore ?? createSecretStore();
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 5000;
  }

  private async getSupabaseAdapter(): Promise<SupabaseAdapter> {
    if (this.supabaseAdapter) {
      return this.supabaseAdapter;
    }
    if (this.supabaseAdapterPromise) {
      return this.supabaseAdapterPromise;
    }
    const result = this.adapterFactory.createSupabaseAdapter({});
    this.supabaseAdapterPromise = Promise.resolve(result);
    this.supabaseAdapter = await this.supabaseAdapterPromise;
    return this.supabaseAdapter;
  }

  private async getRenderAdapter(): Promise<RenderAdapter> {
    if (!this.renderAdapter) {
      const result = this.adapterFactory.createRenderAdapter({});
      this.renderAdapter = await Promise.resolve(result);
    }
    return this.renderAdapter;
  }

  private async getNetlifyAdapter(): Promise<NetlifyAdapter> {
    if (!this.netlifyAdapter) {
      const result = this.adapterFactory.createNetlifyAdapter({});
      this.netlifyAdapter = await Promise.resolve(result);
    }
    return this.netlifyAdapter;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async retry<T>(
    fn: () => Promise<AdapterResult<T>>,
    stepName: string,
    context: EngineContext
  ): Promise<AdapterResult<T>> {
    let lastError: string | undefined;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const result = await fn();
      if (result.success) return result;
      lastError = result.error;
      context.logger.warn(`[${stepName}] Attempt ${attempt}/${this.maxRetries} failed`, { error: result.error });
      if (attempt < this.maxRetries) {
        await this.sleep(this.retryDelayMs * attempt);
      }
    }
    return { success: false, error: lastError ?? 'Max retries exceeded' };
  }

  private async buildEngineContext(deploymentId: string, config: Record<string, unknown>, stepNumber: number): Promise<EngineContext> {
    const stepLog = createChildLogger(`Engine:${deploymentId}:Step${stepNumber}`);

    // Resolve secrets for this step from SecretStore
    const secrets: Record<string, string> = {};

    // Step-specific secrets resolution
    switch (stepNumber) {
      case 1: // supabase_create - needs dbPassword
        secrets.dbPassword = await this.secretStore.get(deploymentId, 'deployment', 'dbPassword') ?? '';
        break;
      case 2: // supabase_migrate_seed - needs databaseUrl, directUrl (from step 1 metadata, not secrets)
        break;
      case 3: // render_create - no secrets needed
        break;
      case 4: // render_configure - needs JWT secrets (allowedOrigins comes from operational config)
        secrets.jwtAccessSecret = await this.secretStore.get(deploymentId, 'deployment', 'jwtAccessSecret') ?? '';
        secrets.jwtRefreshSecret = await this.secretStore.get(deploymentId, 'deployment', 'jwtRefreshSecret') ?? '';
        break;
      case 5: // netlify_deploy - needs netlify auth token (global)
        secrets.netlifyAuthToken = await this.secretStore.getGlobal('global', 'netlify.authToken') ?? '';
        break;
    }

    return {
      deploymentId,
      config,
      secrets,
      logger: stepLog,
    };
  }

  private validateRequiredConfig(config: Record<string, unknown>, deploymentId: string): void {
    const requiredFields = [
      { field: 'repo', value: config.repo },
      { field: 'branch', value: config.branch },
      { field: 'dockerfilePath', value: config.dockerfilePath },
      { field: 'supabaseRegion', value: config.supabaseRegion },
      { field: 'publicApiUrl', value: config.publicApiUrl },
      { field: 'renderServiceId', value: config.renderServiceId },
      { field: 'netlifySiteId', value: config.netlifySiteId },
    ];

    for (const { field, value } of requiredFields) {
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        throw new DeploymentError(`Configuração obrigatória ausente: ${field}`, deploymentId, 0);
      }
    }
  }

  private validateStepConfig(config: Record<string, unknown>, secrets: Record<string, string>, stepName: string, deploymentId: string): void {
    // Only validate INPUT fields (provided by user or previous step outputs already in config).
    // Output fields from previous steps (databaseUrl, directUrl, renderServiceId, netlifySiteId, etc.)
    // are propagated at runtime and should not be validated upfront.
    const stepRequirements: Record<string, string[]> = {
      supabase_create: ['slug', 'supabaseRegion'],
      supabase_migrate_seed: [], // databaseUrl, directUrl come from supabase_create output
      render_create: ['slug', 'repo', 'branch', 'dockerfilePath'],
      render_configure: ['renderServiceId', 'publicApiUrl'], // databaseUrl, directUrl come from supabase_migrate_seed output
      netlify_deploy: ['repo', 'branch'],
    };

    const secretRequirements: Record<string, string[]> = {
      supabase_create: ['dbPassword'],
      render_configure: ['jwtAccessSecret', 'jwtRefreshSecret'],
      netlify_deploy: ['netlifyAuthToken'],
    };

    const required = stepRequirements[stepName];
    if (required) {
      for (const field of required) {
        const value = config[field];
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          throw new DeploymentError(`Configuração obrigatória para step ${stepName} ausente: ${field}`, deploymentId, 0);
        }
      }
    }

    const secretRequired = secretRequirements[stepName];
    if (secretRequired) {
      for (const field of secretRequired) {
        const value = secrets[field];
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          throw new DeploymentError(`Segredo obrigatório para step ${stepName} ausente: ${field}`, deploymentId, 0);
        }
      }
    }
  }

  private async executeStepsAfterAcquire(deploymentId: string, config: Record<string, unknown>, _deployment: any): Promise<void> {
    const stepLog = createChildLogger(`Engine:${deploymentId}`);

    // Validate adapters (using config without secrets)
    stepLog.info('Validating adapters');
    const supabaseAdapter = await this.getSupabaseAdapter();
    const renderAdapter = await this.getRenderAdapter();
    const netlifyAdapter = await this.getNetlifyAdapter();

    const adapters = [
      { name: 'supabase', adapter: supabaseAdapter },
      { name: 'render', adapter: renderAdapter },
      { name: 'netlify', adapter: netlifyAdapter },
    ];

    for (const { name, adapter } of adapters) {
      const validation = await adapter.validateConfig(config);
      if (!validation.success) {
        await deploymentRepository.update(deploymentId, {
          status: 'FAILED',
          errorMessage: `Adapter ${name} validation failed: ${validation.error}`,
        });
        throw new DeploymentError(`Adapter ${name} validation failed: ${validation.error}`, deploymentId, 0);
      }
    }

    // Start execution
    await deploymentRepository.update(deploymentId, {
      status: 'IN_PROGRESS',
    });

    try {
      await this.executeSteps(deploymentId, config);
      await deploymentRepository.update(deploymentId, {
        status: 'COMPLETED',
        currentStep: DEPLOYMENT_STEPS.length,
        completedAt: new Date(),
      });
      stepLog.info('Deployment completed successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await deploymentRepository.update(deploymentId, {
        status: 'FAILED',
        errorMessage: message,
      });
      stepLog.error('Deployment failed', { error: message });
      throw error;
    }
  }

  /**
   * Internal method to run deployment with a pre-built config.
   * Used by resumeDeployment to avoid re-acquiring.
   */
  private async runDeploymentWithConfig(deploymentId: string, config: Record<string, unknown>): Promise<void> {
    const deployment = await deploymentRepository.findById(deploymentId);
    if (!deployment) throw new DeploymentError('Deployment not found', deploymentId, 0);

    await this.executeStepsAfterAcquire(deploymentId, config, deployment);
  }

  async startDeployment(deploymentId: string, config: Record<string, unknown>): Promise<void> {
    const deployment = await deploymentRepository.findById(deploymentId);
    if (!deployment) {
      throw new DeploymentError('Deployment not found', deploymentId, 0);
    }

    if (deployment.status !== 'PENDING' && deployment.status !== 'FAILED') {
      throw new StateTransitionError(
        `Cannot start deployment in status: ${deployment.status}`,
        deployment.status,
        'IN_PROGRESS'
      );
    }

    // Merge provided config with persisted config
    const mergedConfig = { ...deployment.config, ...config } as Record<string, unknown>;

    // Validate required config is present
    if (deployment.config) {
      this.validateRequiredConfig(deployment.config as unknown as Record<string, unknown>, deploymentId);
    }

    // Atomically acquire deployment for execution
    const acquired = await deploymentRepository.tryAcquireForExecution(
      deploymentId,
      deployment.version,
      ['PENDING', 'FAILED'],
      'VALIDATING',
      0
    );

    if (!acquired) {
      throw new StateTransitionError(
        'Deployment modificado concorrentemente ou status inválido',
        deployment.status,
        'VALIDATING'
      );
    }

    // Use acquired deployment which has the incremented version
    await this.executeStepsAfterAcquire(deploymentId, mergedConfig, acquired);
  }

  private async executeSteps(deploymentId: string, config: Record<string, unknown>): Promise<void> {
    const deployment = await deploymentRepository.findById(deploymentId);
    if (!deployment) throw new DeploymentError('Deployment not found', deploymentId, 0);

    // If current step is FAILED, retry it (stepNumber = currentStep)
    // If current step is COMPLETED or PENDING, start from next step
    // If current step is RUNNING (crashed mid-step), treat as FAILED and retry
    const currentStep = deployment.currentStep;
    const currentStepRecord = deployment.steps?.find(s => s.stepNumber === currentStep);
    const startStep = (currentStepRecord?.status === 'FAILED' || currentStepRecord?.status === 'RUNNING')
      ? currentStep - 1
      : currentStep;

    for (const stepDef of DEPLOYMENT_STEPS.slice(startStep)) {
      const stepNumber = stepDef.stepNumber;

      // Build context with secrets for this step
      const context = await this.buildEngineContext(deploymentId, config, stepNumber);

      // Validate step-specific config and secrets
      this.validateStepConfig(config, context.secrets, stepDef.name, deploymentId);

      // Get current step version for optimistic locking
      const step = deployment.steps?.find(s => s.stepNumber === stepNumber);
      const expectedVersion = step?.version ?? 1;

      // Update step status to RUNNING
      await deploymentRepository.updateStep(deploymentId, stepNumber, {
        status: 'RUNNING',
        startedAt: new Date(),
        expectedVersion,
      });
      await deploymentRepository.update(deploymentId, { currentStep: stepNumber });

      context.logger.info(`Starting step: ${stepDef.name}`);

      try {
        const result = await this.executeStep(stepDef, context);
        if (!result.success) {
          await deploymentRepository.updateStep(deploymentId, stepNumber, {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: result.error,
            expectedVersion: expectedVersion + 1, // version incremented by RUNNING update
          });
          throw new DeploymentError(result.error ?? 'Step failed', deploymentId, stepNumber);
        }

        // Sanitize metadata - remove any potential secrets before persisting
        const sanitizedData = this.sanitizeMetadata(result.data);

        await deploymentRepository.updateStep(deploymentId, stepNumber, {
          status: 'COMPLETED',
          completedAt: new Date(),
          metadata: sanitizedData as any,
          expectedVersion: expectedVersion + 1, // version incremented by RUNNING update
        });

        // Propagate step outputs to config for subsequent steps
        if (result.data && typeof result.data === 'object') {
          Object.assign(config, result.data);
          // Flatten connectionStrings if present (from supabase_create)
          const data = result.data as Record<string, unknown>;
          if (data.connectionStrings && typeof data.connectionStrings === 'object') {
            Object.assign(config, data.connectionStrings);
          }
        }

        context.logger.info(`Step completed: ${stepDef.name}`);
      } catch (error) {
        if (error instanceof DeploymentError) throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        await deploymentRepository.updateStep(deploymentId, stepNumber, {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: message,
          expectedVersion: expectedVersion + 1, // version incremented by RUNNING update
        });
        throw new DeploymentError(message, deploymentId, stepNumber);
      }
    }
  }

  private sanitizeMetadata(data: unknown): unknown {
    if (!data || typeof data !== 'object') return data;

    const sanitized = { ...data as Record<string, unknown> };
    const secretKeys = [
      'jwtAccessSecret', 'jwtRefreshSecret', 'allowedOrigins',
      'dbPassword', 'netlifyAuthToken', 'smtpPass',
      'accessToken', 'apiToken', 'authToken',
      'token', 'secret', 'password', 'key'
    ];

    for (const key of Object.keys(sanitized)) {
      const lowerKey = key.toLowerCase();
      if (secretKeys.some(sk => lowerKey.includes(sk))) {
        sanitized[key] = '[REDACTED]';
      } else if (sanitized[key] && typeof sanitized[key] === 'object') {
        sanitized[key] = this.sanitizeMetadata(sanitized[key]);
      }
    }

    return sanitized;
  }

  private async executeStep(stepDef: DeploymentStepDefinition, context: EngineContext): Promise<AdapterResult> {
    const { adapter: adapterName } = stepDef;

    switch (adapterName) {
      case 'supabase':
        return this.executeSupabaseStep(stepDef, context);
      case 'render':
        return this.executeRenderStep(stepDef, context);
      case 'netlify':
        return this.executeNetlifyStep(stepDef, context);
      default:
        return { success: false, error: `Unknown adapter: ${adapterName}` };
    }
  }

  private async executeSupabaseStep(stepDef: DeploymentStepDefinition, context: EngineContext): Promise<AdapterResult> {
    const adapter = await this.getSupabaseAdapter();
    const { config, secrets } = context;

    switch (stepDef.name) {
      case 'supabase_create': {
        const dbPassword = secrets.dbPassword;
        if (!dbPassword) {
          return { success: false, error: 'dbPassword é obrigatório para supabase_create' };
        }

        // Validate supabaseProjectRef if provided - must be EXACTLY 20 chars, only [a-z0-9]
        const rawProjectRef = config.supabaseProjectRef;
        if (rawProjectRef !== undefined) {
          if (typeof rawProjectRef !== 'string' || rawProjectRef.trim() === '') {
            return { success: false, error: 'supabaseProjectRef informado mas inválido (vazio ou apenas espaços)' };
          }
          // Supabase project refs MUST be exactly 20 characters, lowercase alphanumeric only
          const trimmedRef = rawProjectRef.trim();
          if (trimmedRef.length !== 20 || /[^a-z0-9]/.test(trimmedRef)) {
            return { success: false, error: 'supabaseProjectRef inválido: deve conter exatamente 20 caracteres, apenas letras minúsculas e números' };
          }
        }
        const existingProjectRef = rawProjectRef?.trim();

        const region = (config.supabaseRegion as string) ?? 'sa-east-1';
        return this.retry(
          () => adapter.createProject(context, { slug: config.slug as string, region, dbPassword, existingProjectRef }),
          'supabase_create',
          context
        );
      }
      case 'supabase_migrate_seed': {
        const databaseUrl = config.databaseUrl as string;
        const directUrl = config.directUrl as string;
        if (!databaseUrl || !directUrl) {
          return { success: false, error: 'databaseUrl e directUrl são obrigatórios para migração' };
        }
        const migrateResult = await this.retry(
          () => adapter.applyMigrations(context, { databaseUrl, directUrl }),
          'supabase_migrate_seed',
          context
        );
        if (!migrateResult.success) return migrateResult;
        return this.retry(
          () => adapter.runSeed(context, { databaseUrl }),
          'supabase_seed',
          context
        );
      }
      default:
        return { success: false, error: `Unknown Supabase step: ${stepDef.name}` };
    }
  }

  private async executeRenderStep(stepDef: DeploymentStepDefinition, context: EngineContext): Promise<AdapterResult> {
    const adapter = await this.getRenderAdapter();
    const { config, secrets } = context;

    switch (stepDef.name) {
      case 'render_create': {
        return this.retry(
          () =>
            adapter.createWebService(context, {
              name: `apollofit-api-${config.slug}`,
              repo: config.repo as string,
              branch: config.branch as string,
              dockerfilePath: config.dockerfilePath as string,
            }),
          'render_create',
          context
        );
      }
      case 'render_configure': {
        const serviceId = config.renderServiceId as string;
        const jwtAccessSecret = secrets.jwtAccessSecret;
        const jwtRefreshSecret = secrets.jwtRefreshSecret;
        const allowedOrigins = config.allowedOrigins as string;

        if (!jwtAccessSecret || !jwtRefreshSecret || !allowedOrigins) {
          return { success: false, error: 'JWT secrets e allowedOrigins são obrigatórios para render_configure' };
        }

        const envVars = {
          DATABASE_URL: config.databaseUrl as string,
          DIRECT_URL: config.directUrl as string,
          JWT_ACCESS_SECRET: jwtAccessSecret,
          JWT_REFRESH_SECRET: jwtRefreshSecret,
          ALLOWED_ORIGINS: allowedOrigins,
          PUBLIC_API_URL: config.publicApiUrl as string,
          NODE_ENV: 'production',
          PORT: '3333',
        };
        return this.retry(
          () => adapter.configureEnvVars(context, { serviceId, envVars }),
          'render_configure',
          context
        );
      }
      default:
        return { success: false, error: `Unknown Render step: ${stepDef.name}` };
    }
  }

  private async executeNetlifyStep(stepDef: DeploymentStepDefinition, context: EngineContext): Promise<AdapterResult> {
    const adapter = await this.getNetlifyAdapter();
    const { config } = context;

    switch (stepDef.name) {
      case 'netlify_deploy': {
        // Step 5: Associate branch domain to shared Matrix Netlify site
        // Does NOT trigger build - only adds domain alias to existing site
        const siteId = config.netlifySiteId as string;
        const domain = config.customDomain ? (config.domain as string) : `${config.slug}.apollofit.com.br`;

        context.logger.info('[Engine] Starting Netlify domain association', { siteId, domain, slug: config.slug });

        // Add domain alias (production domain) - IDEMPOTENT
        // POST /sites/{site_id}/domains - verificado na OpenAPI oficial
        const aliasResult = await this.retry(
          () => adapter.addDomainAlias(context, { siteId, domain }),
          'netlify_add_domain',
          context
        );
        if (!aliasResult.success) return aliasResult;

        // Return result with domain info for metadata
        return {
          success: true,
          data: {
            siteId,
            domain,
            domainAdded: aliasResult.data?.aliasAdded,
          },
        };
      }
      default:
        return { success: false, error: `Unknown Netlify step: ${stepDef.name}` };
    }
  }

  async resumeDeployment(deploymentId: string): Promise<void> {
    const deployment = await deploymentRepository.findById(deploymentId);
    if (!deployment) throw new DeploymentError('Deployment not found', deploymentId, 0);

    if (deployment.status === 'COMPLETED') {
      throw new StateTransitionError('Deployment already completed', 'COMPLETED', 'IN_PROGRESS');
    }
    if (deployment.status === 'IN_PROGRESS') {
      throw new StateTransitionError('Deployment already in progress', 'IN_PROGRESS', 'IN_PROGRESS');
    }
    if (deployment.status === 'VALIDATING') {
      throw new StateTransitionError('Deployment already validating', 'VALIDATING', 'IN_PROGRESS');
    }
    if (deployment.status === 'WAITING_EXTERNAL') {
      throw new StateTransitionError('Deployment waiting for external', 'WAITING_EXTERNAL', 'IN_PROGRESS');
    }
    if (deployment.status === 'ROLLED_BACK') {
      // Allow resuming from ROLLED_BACK
    }
    // Allow resuming from PENDING or FAILED

    // Use ONLY stored config from deployment.config - no reconstruction, no fake values
    if (!deployment.config) {
      throw new DeploymentError('Deployment config não encontrada para retomada', deploymentId, 0);
    }

    // Validate required config is present (operational config only)
    this.validateRequiredConfig(deployment.config as unknown as Record<string, unknown>, deploymentId);

    // Read database URLs from step 1 metadata (supabase_create)
    const step1 = deployment.steps?.find(s => s.stepNumber === 1);
    const step1Metadata = step1?.metadata as any;
    const databaseUrl = step1Metadata?.connectionStrings?.databaseUrl;
    const directUrl = step1Metadata?.connectionStrings?.directUrl;

    // Read render service ID from step 3 metadata (render_create)
    const step3 = deployment.steps?.find(s => s.stepNumber === 3);
    const step3Metadata = step3?.metadata as any;
    const renderServiceId = step3Metadata?.serviceId;

    // Build config from persisted data only (operational config, NO secrets)
    const config = {
      slug: deployment.slug,
      repo: deployment.config.repo,
      branch: deployment.config.branch,
      dockerfilePath: deployment.config.dockerfilePath,
      supabaseRegion: deployment.config.supabaseRegion,
      // databaseUrl, directUrl from step 1 metadata
      databaseUrl,
      directUrl,
      publicApiUrl: deployment.config.publicApiUrl,
      // renderServiceId from step 3 metadata or config
      renderServiceId: renderServiceId || deployment.config.renderServiceId,
      netlifySiteId: deployment.config.netlifySiteId,
      customDomain: deployment.config.customDomain,
      allowedOrigins: deployment.config.allowedOrigins,
    };

    // Atomically acquire deployment for execution - resume from currentStep
    const acquired = await deploymentRepository.tryAcquireForExecution(
      deploymentId,
      deployment.version,
      ['PENDING', 'FAILED', 'ROLLED_BACK'],
      'VALIDATING',
      deployment.currentStep
    );

    if (!acquired) {
      throw new StateTransitionError(
        'Deployment modificado concorrentemente ou status inválido para retomada',
        deployment.status,
        'VALIDATING'
      );
    }

    await this.runDeploymentWithConfig(deploymentId, config);
  }

  async getDeploymentStatus(deploymentId: string) {
    return deploymentRepository.findById(deploymentId);
  }
}

/**
 * Creates a DeploymentEngine with mock adapters (default for development/tests).
 * This is the default factory used by API routes when no explicit configuration is provided.
 */
export function createDeploymentEngine(secretStore?: ReturnType<typeof createSecretStore>): DeploymentEngine {
  return new DeploymentEngine({
    adapterFactory: createMockAdapterFactory(),
    secretStore: secretStore ?? createSecretStore(),
  });
}

/**
 * Creates a DeploymentEngine configured for production with real Supabase and Netlify adapters.
 * Uses DurableSecretStore for persistent encrypted secret storage.
 * Retrieves Supabase PAT from SecretStore via getGlobalSecret('supabase.accessToken').
 * Retrieves Netlify auth token and site ID from SecretStore via getGlobalSecret.
 *
 * @param prisma - PrismaClient instance for DurableSecretStore
 * @returns DeploymentEngine with real Supabase and Netlify adapters
 *
 * Requires SECRETS_MASTER_KEY environment variable for encryption.
 * Requires supabase.accessToken secret to be provisioned in SecretStore (global scope).
 * Requires netlify.authToken and netlify.siteId secrets to be provisioned in SecretStore (global scope).
 * netlify.siteId should be the shared Matrix site ID in Netlify.
 */
export async function createProductionDeploymentEngine(
  prisma: PrismaClient
): Promise<DeploymentEngine> {
  // Create durable secret store for production
  const secretStore = await createDurableSecretStore(prisma);

  // Create adapter factory with real Supabase and Netlify adapters
  // Secrets are retrieved from SecretStore at initialization, never exposed in logs
  const adapterFactory = createAdapterFactory({
    useRealAdapters: true,
    supabaseConfig: {
      getGlobalSecret: async (key) => {
        if (key === 'supabase.accessToken') {
          return secretStore.getGlobal('global', 'supabase.accessToken');
        }
        return null;
      },
    },
    netlifyConfig: {
      getGlobalSecret: async (key) => {
        if (key === 'netlify.authToken' || key === 'netlify.siteId') {
          return secretStore.getGlobal('global', key);
        }
        return null;
      },
    },
  });

  return new DeploymentEngine({
    adapterFactory,
    secretStore,
    maxRetries: 3,
    retryDelayMs: 5000,
  });
}