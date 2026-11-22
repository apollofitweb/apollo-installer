/**
 * Deployment repository - data access layer for deployments
 */

import { prisma } from './prisma.js';
import type {
  Deployment,
  DeploymentStep,
  DeploymentConfig,
  DeploymentStatus,
  StepStatus,
  JsonValue,
} from '../shared/types.js';
import { DeploymentVersionConflictError } from '../shared/errors.js';

export interface CreateDeploymentData {
  slug: string;
  name: string;
  domain?: string;
  adminEmail: string;
  adminName: string;
  totalSteps?: number;
}

export interface UpdateDeploymentData {
  status?: DeploymentStatus;
  currentStep?: number;
  errorMessage?: string;
  completedAt?: Date | null;
  version?: number;
}

export interface CreateStepData {
  deploymentId: string;
  stepNumber: number;
  name: string;
  description?: string;
}

export interface UpdateStepData {
  status?: StepStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
  errorMessage?: string | null;
  metadata?: JsonValue;
  expectedVersion?: number;
}

export class DeploymentRepository {
  async create(data: CreateDeploymentData): Promise<Deployment> {
    return prisma.deployment.create({
      data: {
        slug: data.slug,
        name: data.name,
        domain: data.domain,
        adminEmail: data.adminEmail,
        adminName: data.adminName,
        totalSteps: data.totalSteps ?? 5,
        steps: {
          create: [
            { stepNumber: 1, name: 'supabase_create', description: 'Criar projeto Supabase dedicado', version: 1 },
            { stepNumber: 2, name: 'supabase_migrate_seed', description: 'Aplicar migrations e seed', version: 1 },
            { stepNumber: 3, name: 'render_create', description: 'Criar web service Render', version: 1 },
            { stepNumber: 4, name: 'render_configure', description: 'Configurar variáveis no Render', version: 1 },
            { stepNumber: 5, name: 'netlify_deploy', description: 'Deploy frontend no Netlify', version: 1 },
          ],
        },
      },
      include: { steps: true },
    });
  }

  async findById(id: string): Promise<Deployment | null> {
    return prisma.deployment.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepNumber: 'asc' } }, config: true },
    });
  }

  async findBySlug(slug: string): Promise<Deployment | null> {
    return prisma.deployment.findUnique({
      where: { slug },
      include: { steps: { orderBy: { stepNumber: 'asc' } }, config: true },
    });
  }

  async findAll(): Promise<Deployment[]> {
    return prisma.deployment.findMany({
      orderBy: { createdAt: 'desc' },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
    });
  }

  async update(id: string, data: UpdateDeploymentData): Promise<Deployment> {
    const { version, ...updateData } = data;
    // Only use version in where clause if explicitly provided for optimistic locking
    // For updates after tryAcquireForExecution, don't use version check since we already own the lock
    const where: any = { id };
    if (version !== undefined) {
      where.version = version;
    }
    const updatePayload: any = { ...updateData };
    if (version !== undefined) {
      updatePayload.version = { increment: 1 };
    }
    return prisma.deployment.update({
      where,
      data: updatePayload,
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
    });
  }

  /**
   * Atomically acquire deployment for execution.
   * Returns updated deployment if successful, null if version mismatch or status not allowed.
   */
  async tryAcquireForExecution(
    id: string,
    expectedVersion: number,
    allowedStatuses: DeploymentStatus[],
    newStatus: DeploymentStatus,
    newCurrentStep: number
  ): Promise<Deployment | null> {
    return prisma.deployment.update({
      where: {
        id,
        version: expectedVersion,
        status: { in: allowedStatuses },
      },
      data: {
        status: newStatus,
        currentStep: newCurrentStep,
        errorMessage: null,
        version: { increment: 1 },
      },
      include: { steps: { orderBy: { stepNumber: 'asc' } }, config: true },
    }).catch(() => null);
  }

  async updateStep(deploymentId: string, stepNumber: number, data: UpdateStepData): Promise<DeploymentStep> {
    const { expectedVersion, ...updateData } = data;
    // Prisma's Json field expects InputJsonValue | null, use type assertion
    try {
      return await prisma.deploymentStep.update({
        where: {
          deploymentId_stepNumber: { deploymentId, stepNumber },
          ...(expectedVersion !== undefined ? { version: expectedVersion } : {}),
        },
        data: {
          ...updateData,
          version: { increment: 1 },
        } as any,
      });
    } catch (error: any) {
      if (error.code === 'P2025') { // Record not found (version mismatch)
        const current = await prisma.deploymentStep.findUnique({
          where: { deploymentId_stepNumber: { deploymentId, stepNumber } },
        });
        throw new DeploymentVersionConflictError(
          'DeploymentStep',
          `${deploymentId}:${stepNumber}`,
          expectedVersion ?? 0,
          current?.version ?? 0
        );
      }
      throw error;
    }
  }

  async createConfig(deploymentId: string, config: Partial<DeploymentConfig>): Promise<DeploymentConfig> {
    return prisma.deploymentConfig.create({
      data: { deploymentId, ...config },
    });
  }

  async updateConfig(deploymentId: string, config: Partial<DeploymentConfig>): Promise<DeploymentConfig> {
    return prisma.deploymentConfig.upsert({
      where: { deploymentId },
      create: { deploymentId, ...config },
      update: config,
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.deployment.delete({ where: { id } });
  }
}

export const deploymentRepository = new DeploymentRepository();