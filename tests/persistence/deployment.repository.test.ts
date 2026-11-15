/**
 * Tests for deployment repository
 * Uses SQLite file for fast isolated tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../src/persistence/prisma.js';
import { DeploymentRepository } from '../../src/persistence/deployment.repository.js';

const repo = new DeploymentRepository();

describe('Deployment Repository', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.$executeRaw`PRAGMA foreign_keys = ON`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.deploymentStep.deleteMany();
    await prisma.deploymentConfig.deleteMany();
    await prisma.deployment.deleteMany();
  });

  it('should create deployment with steps', async () => {
    const deployment = await repo.create({
      slug: 'test-filial',
      name: 'Test Filial',
      adminEmail: 'admin@test.com',
      adminName: 'Admin Test',
    });

    expect(deployment).toBeDefined();
    expect(deployment.slug).toBe('test-filial');
    expect(deployment.name).toBe('Test Filial');
    expect(deployment.adminEmail).toBe('admin@test.com');
    expect(deployment.adminName).toBe('Admin Test');
    expect(deployment.totalSteps).toBe(5);
    expect(deployment.status).toBe('PENDING');
    expect(deployment.steps).toHaveLength(5);

    // Verify step names match expected deployment flow
    const stepNames = deployment.steps.map(s => s.name).sort();
    expect(stepNames).toEqual([
      'netlify_deploy',
      'render_configure',
      'render_create',
      'supabase_create',
      'supabase_migrate_seed',
    ]);
  });

  it('should find deployment by id', async () => {
    const created = await repo.create({
      slug: 'test-find-by-id',
      name: 'Test Find By ID',
      adminEmail: 'admin@test.com',
      adminName: 'Admin Test',
    });

    const found = await repo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.slug).toBe('test-find-by-id');
  });

  it('should find deployment by slug', async () => {
    await repo.create({
      slug: 'test-find-by-slug',
      name: 'Test Find By Slug',
      adminEmail: 'admin@test.com',
      adminName: 'Admin Test',
    });

    const found = await repo.findBySlug('test-find-by-slug');
    expect(found).not.toBeNull();
    expect(found!.slug).toBe('test-find-by-slug');
    expect(found!.name).toBe('Test Find By Slug');
  });

  it('should return null for non-existent slug', async () => {
    const found = await repo.findBySlug('non-existent');
    expect(found).toBeNull();
  });

  it('should list deployments ordered by createdAt desc', async () => {
    await repo.create({
      slug: 'test-list-1',
      name: 'Test List 1',
      adminEmail: 'admin@test.com',
      adminName: 'Admin Test',
    });
    await repo.create({
      slug: 'test-list-2',
      name: 'Test List 2',
      adminEmail: 'admin@test.com',
      adminName: 'Admin Test',
    });

    const list = await repo.findAll();
    expect(list.length).toBeGreaterThanOrEqual(2);
    // First should be the most recent
    expect(list[0].slug).toBe('test-list-2');
  });

  it('should update deployment', async () => {
    const created = await repo.create({
      slug: 'test-update',
      name: 'Test Update',
      adminEmail: 'admin@test.com',
      adminName: 'Admin Test',
    });

    const updated = await repo.update(created.id, {
      status: 'IN_PROGRESS',
      currentStep: 2,
      errorMessage: 'Test error',
    });

    expect(updated.status).toBe('IN_PROGRESS');
    expect(updated.currentStep).toBe(2);
    expect(updated.errorMessage).toBe('Test error');
  });

  it('should update step', async () => {
    const created = await repo.create({
      slug: 'test-step-update',
      name: 'Test Step Update',
      adminEmail: 'admin@test.com',
      adminName: 'Admin Test',
    });

    const updatedStep = await repo.updateStep(created.id, 1, {
      status: 'COMPLETED',
      startedAt: new Date(),
      completedAt: new Date(),
    });

    expect(updatedStep.status).toBe('COMPLETED');
    expect(updatedStep.startedAt).toBeDefined();
    expect(updatedStep.completedAt).toBeDefined();
  });

  it('should create and update config', async () => {
    const created = await repo.create({
      slug: 'test-config',
      name: 'Test Config',
      adminEmail: 'admin@test.com',
      adminName: 'Admin Test',
    });

    const config = await repo.createConfig(created.id, {
      supabaseProjectRef: 'abc123',
      supabaseRegion: 'sa-east-1',
      renderServiceId: 'srv-123',
      netlifySiteId: 'site-123',
      repo: 'apollofitweb/apollo-web',
      branch: 'develop',
      dockerfilePath: 'docker/Dockerfile',
      publicApiUrl: 'https://test.apollofit.com.br',
      allowedOrigins: 'https://test.apollofit.com.br',
    });

    expect(config.supabaseProjectRef).toBe('abc123');
    expect(config.renderServiceId).toBe('srv-123');
    expect(config.netlifySiteId).toBe('site-123');
    expect(config.repo).toBe('apollofitweb/apollo-web');

    const updatedConfig = await repo.updateConfig(created.id, {
      supabaseProjectRef: 'updated-ref',
      customDomain: 'test.apollofit.com.br',
    });

    expect(updatedConfig.supabaseProjectRef).toBe('updated-ref');
    expect(updatedConfig.customDomain).toBe('test.apollofit.com.br');
  });

  it('should delete deployment', async () => {
    const created = await repo.create({
      slug: 'test-delete',
      name: 'Test Delete',
      adminEmail: 'admin@test.com',
      adminName: 'Admin Test',
    });

    await repo.delete(created.id);

    const found = await repo.findById(created.id);
    expect(found).toBeNull();
  });
});