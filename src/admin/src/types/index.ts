// Type definitions matching the backend API

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
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  steps?: DeploymentStep[];
  config?: DeploymentConfig | null;
}

export type DeploymentStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'IN_PROGRESS'
  | 'WAITING_EXTERNAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'ROLLED_BACK';

export interface DeploymentStep {
  id: string;
  deploymentId: string;
  stepNumber: number;
  name: string;
  description: string | null;
  status: StepStatus;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type StepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface DeploymentConfig {
  id: string;
  deploymentId: string;
  supabaseProjectRef: string | null;
  supabaseRegion: string | null;
  renderServiceId: string | null;
  netlifySiteId: string | null;
  customDomain: string | null;
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
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeploymentInput {
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
  repo?: string;
  branch?: string;
  dockerfilePath?: string;
  publicApiUrl?: string;
}

export interface SmtpConfigInput {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export interface UpdateConfigInput {
  supabaseRegion?: string;
  supabaseProjectRef?: string;
  renderServiceId?: string;
  netlifySiteId?: string;
  netlifyDomain?: string;
  customDomain?: string;
  allowedOrigins?: string;
  repo?: string;
  branch?: string;
  dockerfilePath?: string;
  publicApiUrl?: string;
  mercadoPagoEnabled?: boolean;
  mercadoPagoMode?: 'sandbox' | 'production';
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
}

export interface DeploymentSecretMetadata {
  version: number;
  updatedAt: string;
  updatedBy: string;
  deleted: boolean;
}

export interface GlobalSecretMetadata {
  version: number;
  updatedAt: string;
  updatedBy: string;
  deleted: boolean;
}

export interface SecretValue {
  value: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  errors?: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const DEPLOYMENT_STEPS = [
  { stepNumber: 1, name: 'supabase_create', description: 'Criar projeto Supabase dedicado e obter connection strings', adapter: 'supabase', estimatedDurationMs: 60000 },
  { stepNumber: 2, name: 'supabase_migrate_seed', description: 'Aplicar migrations e seed no banco da filial', adapter: 'supabase', estimatedDurationMs: 120000 },
  { stepNumber: 3, name: 'render_create', description: 'Criar web service Render apontando para o banco', adapter: 'render', estimatedDurationMs: 180000 },
  { stepNumber: 4, name: 'render_configure', description: 'Configurar variáveis de ambiente no Render', adapter: 'render', estimatedDurationMs: 60000 },
  { stepNumber: 5, name: 'netlify_deploy', description: 'Associar domínio da filial ao site compartilhado Netlify', adapter: 'netlify', estimatedDurationMs: 180000 },
] as const;

export const GLOBAL_SECRET_KEYS = [
  'netlify.siteId',
  'netlify.authToken',
  'installer.jwtSigningSecret',
  'supabase.accessToken',
  'render.apiToken',
  'render.installerApiToken',
  'render.ownerId',
] as const;

export type GlobalSecretKey = typeof GLOBAL_SECRET_KEYS[number];