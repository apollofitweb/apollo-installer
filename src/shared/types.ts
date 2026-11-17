/**
 * Shared types for Apollo Installer
 * Independent from Apollo Fit Web - no cross-references
 */

import type { JsonValue as PrismaJsonValue } from '@prisma/client/runtime/library';

export type JsonValue = PrismaJsonValue;

// Prisma types are now generated with the new fields
// We use them directly from @prisma/client

export interface FilialInput {
  slug: string;
  name: string;
  domain?: string;
  adminEmail: string;
  adminName: string;
  adminPassword?: string;
  customDomain?: boolean;
  mercadoPagoEnabled?: boolean;
  mercadoPagoMode?: 'sandbox' | 'production';
  smtpConfig?: SmtpConfigInput;
}

export interface SmtpConfigInput {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrorDetail[];
}

export interface ValidationErrorDetail {
  field: string;
  message: string;
  code: string;
}

export type DeploymentStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'IN_PROGRESS'
  | 'WAITING_EXTERNAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'ROLLED_BACK';

export type StepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED';

export interface DeploymentStepDefinition {
  stepNumber: number;
  name: string;
  description: string;
  adapter?: string; // e.g., 'supabase', 'render', 'netlify'
  estimatedDurationMs?: number;
}

export const DEPLOYMENT_STEPS: DeploymentStepDefinition[] = [
  {
    stepNumber: 1,
    name: 'supabase_create',
    description: 'Criar projeto Supabase dedicado e obter connection strings',
    adapter: 'supabase',
    estimatedDurationMs: 60000,
  },
  {
    stepNumber: 2,
    name: 'supabase_migrate_seed',
    description: 'Aplicar migrations e seed no banco da filial',
    adapter: 'supabase',
    estimatedDurationMs: 120000,
  },
  {
    stepNumber: 3,
    name: 'render_create',
    description: 'Criar web service Render apontando para o banco',
    adapter: 'render',
    estimatedDurationMs: 180000,
  },
  {
    stepNumber: 4,
    name: 'render_configure',
    description: 'Configurar variáveis de ambiente no Render',
    adapter: 'render',
    estimatedDurationMs: 60000,
  },
  {
    stepNumber: 5,
    name: 'netlify_deploy',
    description: 'Deploy do frontend no Netlify (site compartilhado)',
    adapter: 'netlify',
    estimatedDurationMs: 180000,
  },
];

export interface EngineContext {
  deploymentId: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  logger: Logger;
}

export interface AdapterResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: JsonValue;
}

export interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
}

// Prisma model types (duplicated here to avoid import cycles)
export interface Deployment {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  adminEmail: string;
  adminName: string;
  status: DeploymentStatus;
  currentStep: number;
  totalSteps: number;
  errorMessage: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  steps?: DeploymentStep[];
  config?: DeploymentConfig | null;
}

export interface DeploymentStep {
  id: string;
  deploymentId: string;
  stepNumber: number;
  name: string;
  description: string | null;
  status: StepStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  metadata: JsonValue | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeploymentConfig {
  id: string;
  deploymentId: string;
  supabaseProjectRef: string | null;
  supabaseRegion: string | null;
  renderServiceId: string | null;
  netlifySiteId: string | null;
  customDomain: string | null;
  // Operational config (non-sensitive)
  repo: string | null;
  branch: string | null;
  dockerfilePath: string | null;
  publicApiUrl: string | null;
  allowedOrigins: string | null;
  mercadoPagoEnabled: boolean;
  mercadoPagoMode: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpFrom: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Adapter factory interface
export interface AdapterFactory {
  createSupabaseAdapter(config: Record<string, unknown>): SupabaseAdapter | Promise<SupabaseAdapter>;
  createRenderAdapter(config: Record<string, unknown>): RenderAdapter | Promise<RenderAdapter>;
  createNetlifyAdapter(config: Record<string, unknown>): NetlifyAdapter | Promise<NetlifyAdapter>;
}

// Base adapter interface
export interface Adapter {
  readonly name: string;
  readonly version: string;

  isReady(context: EngineContext): Promise<boolean>;
  validateConfig(config: Record<string, unknown>): Promise<AdapterResult>;
  healthCheck(context: EngineContext): Promise<AdapterResult>;
}

// Supabase adapter interface
export interface SupabaseAdapter extends Adapter {
  name: 'supabase';

  createProject(
    context: EngineContext,
    params: { slug: string; region: string; dbPassword: string; existingProjectRef?: string }
  ): Promise<AdapterResult<{ projectRef: string; connectionStrings: { databaseUrl: string; directUrl: string } }>>;

  applyMigrations(context: EngineContext, params: { databaseUrl: string; directUrl: string }): Promise<AdapterResult>;

  runSeed(context: EngineContext, params: { databaseUrl: string }): Promise<AdapterResult>;

  validateConnection(context: EngineContext, params: { databaseUrl: string }): Promise<AdapterResult>;
}

// Render adapter interface
export interface RenderAdapter extends Adapter {
  name: 'render';

  createWebService(
    context: EngineContext,
    params: { name: string; repo: string; branch: string; dockerfilePath: string }
  ): Promise<AdapterResult<{ serviceId: string; serviceUrl: string }>>;

  configureEnvVars(
    context: EngineContext,
    params: { serviceId: string; envVars: Record<string, string> }
  ): Promise<AdapterResult>;

  setupHealthCheck(context: EngineContext, params: { serviceId: string; path: string }): Promise<AdapterResult>;

  validateDeployment(context: EngineContext, params: { serviceUrl: string }): Promise<AdapterResult>;
}

// Netlify adapter interface
export interface NetlifyAdapter extends Adapter {
  name: 'netlify';

  deploySite(
    context: EngineContext,
    params: { repo: string; branch: string; buildCommand: string; publishDir: string }
  ): Promise<AdapterResult<{ siteId: string; siteUrl: string }>>;

  addDomainAlias(
    context: EngineContext,
    params: { siteId: string; domain: string }
  ): Promise<AdapterResult<{ aliasAdded: boolean; domain: string }>>;

  validateDeployment(context: EngineContext, params: { siteUrl: string }): Promise<AdapterResult<{ healthy: boolean }>>;
}