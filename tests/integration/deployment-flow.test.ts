/**
 * Integration test for complete deployment flow using mock adapters
 * Tests: create, query, state transitions, step recording, error handling, resume
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/api/index.js';
import { deploymentRepository } from '../../src/persistence/deployment.repository.js';
import { createDeploymentEngine, DeploymentEngine } from '../../src/engine/deployment-engine.js';
import { createAdapterFactory } from '../../src/adapters/index.js';
import { DEPLOYMENT_STEPS } from '../../src/shared/types.js';
import { prisma } from '../../src/persistence/prisma.js';
import { createSecretStore } from '../../src/secrets/index.js';
import { resetMockState } from '../../src/adapters/mock.js';
import { env } from '../../src/config/env.js';
import jwt from 'jsonwebtoken';

describe('Deployment Flow Integration', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let engine: ReturnType<typeof createDeploymentEngine>;
  let secretStore: ReturnType<typeof createSecretStore>;
  let deploymentId: string;

  // Mock config WITHOUT secrets (secrets go to SecretStore)
  const mockConfig = {
    slug: 'test-filial',
    repo: 'apollofitweb/apollo-web',
    branch: 'develop',
    dockerfilePath: 'docker/Dockerfile',
    supabaseRegion: 'sa-east-1',
    publicApiUrl: 'https://api.test-filial.apollofit.com.br',
    renderServiceId: 'srv-mock',
    netlifySiteId: 'site-mock',
  };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    secretStore = createSecretStore();
    engine = createDeploymentEngine(secretStore);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean database for test isolation
    await prisma.deploymentStep.deleteMany();
    await prisma.deploymentConfig.deleteMany();
    await prisma.deployment.deleteMany();
    // Reset mock adapter state for idempotency tests
    resetMockState();
    // Clear secret store
    if ('clear' in secretStore) {
      (secretStore as any).clear();
    }
  });

  describe('API - Deployment CRUD', () => {
    // Test token for authenticated requests
    const adminToken = jwt.sign(
      { sub: 'user-admin', email: 'admin@test.com', role: 'admin' },
      env.jwtAccessSecret,
      { expiresIn: '1h' }
    );
    const authHeaders = { authorization: `Bearer ${adminToken}` };

    it('should create a new deployment with auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/deployments',
        headers: authHeaders,
        payload: {
          slug: 'test-filial',
          name: 'Test Filial',
          adminEmail: 'admin@test.com',
          adminName: 'Admin Test',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.slug).toBe('test-filial');
      expect(body.data.status).toBe('PENDING');
      // Steps are not returned in create response, fetch via GET
      deploymentId = body.data.id;

      // Verify steps via GET by ID
      const getResponse = await app.inject({
        method: 'GET',
        url: `/api/deployments/${deploymentId}`,
        headers: authHeaders,
      });
      const getBody = JSON.parse(getResponse.payload);
      expect(getBody.success).toBe(true);
      expect(getBody.data.steps).toHaveLength(5);
    });

    it('should reject invalid slug format with auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/deployments',
        headers: authHeaders,
        payload: {
          slug: 'Invalid Slug',
          name: 'Test',
          adminEmail: 'admin@test.com',
          adminName: 'Admin',
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid email with auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/deployments',
        headers: authHeaders,
        payload: {
          slug: 'test-filial-2',
          name: 'Test',
          adminEmail: 'not-an-email',
          adminName: 'Admin',
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should list deployments with auth', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/deployments',
        headers: authHeaders,
        payload: {
          slug: 'test-list-1',
          name: 'Test List 1',
          adminEmail: 'admin@test.com',
          adminName: 'Admin Test',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/deployments',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('should get deployment by id with auth', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/deployments',
        headers: authHeaders,
        payload: {
          slug: 'test-get-by-id',
          name: 'Test Get By ID',
          adminEmail: 'admin@test.com',
          adminName: 'Admin Test',
        },
      });
      const created = JSON.parse(createResponse.payload).data;

      const response = await app.inject({
        method: 'GET',
        url: `/api/deployments/${created.id}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(created.id);
      expect(body.data.slug).toBe('test-get-by-id');
    });
  });

  describe('Engine - supabaseProjectRef Validation', () => {
    it('should pass valid supabaseProjectRef to adapter in adoption mode', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'adoption-valid-ref',
        name: 'Adoption Valid Ref',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      // Valid project ref format (20-char lowercase alphanumeric like real Supabase refs)
      const validProjectRef = 'lenfghvvaiyqkefzxrmp';
      const config = {
        ...mockConfig,
        slug: 'adoption-valid-ref',
        allowedOrigins: 'https://adoption-valid-ref.apollofit.com.br',
        supabaseProjectRef: validProjectRef
      };
      await engine.startDeployment(deploymentId, config);

      // Verify completion and that step 1 has the adopted projectRef
      const completed = await deploymentRepository.findById(deploymentId);
      expect(completed!.status).toBe('COMPLETED');

      const step1 = completed!.steps!.find(s => s.stepNumber === 1);
      expect(step1!.metadata).toBeDefined();
      expect((step1!.metadata as any).projectRef).toBe(validProjectRef);
    });

    it('should reject empty supabaseProjectRef and not fall back to creation mode', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'adoption-empty-ref',
        name: 'Adoption Empty Ref',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      // Empty project ref should fail validation
      const config = {
        ...mockConfig,
        slug: 'adoption-empty-ref',
        allowedOrigins: 'https://adoption-empty-ref.apollofit.com.br',
        supabaseProjectRef: ''
      };

      await expect(engine.startDeployment(deploymentId, config)).rejects.toThrow();

      const failed = await deploymentRepository.findById(deploymentId);
      expect(failed!.status).toBe('FAILED');
      expect(failed!.errorMessage).toContain('supabaseProjectRef informado mas inválido');
    });

    it('should reject whitespace-only supabaseProjectRef and not fall back to creation mode', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'adoption-whitespace-ref',
        name: 'Adoption Whitespace Ref',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      // Whitespace-only project ref should fail validation
      const config = {
        ...mockConfig,
        slug: 'adoption-whitespace-ref',
        allowedOrigins: 'https://adoption-whitespace-ref.apollofit.com.br',
        supabaseProjectRef: '   '
      };

      await expect(engine.startDeployment(deploymentId, config)).rejects.toThrow();

      const failed = await deploymentRepository.findById(deploymentId);
      expect(failed!.status).toBe('FAILED');
      expect(failed!.errorMessage).toContain('supabaseProjectRef informado mas inválido');
    });

    it('should reject invalid format supabaseProjectRef and not fall back to creation mode', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'adoption-invalid-format',
        name: 'Adoption Invalid Format',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      // Invalid format (uppercase, special chars, too short)
      const config = {
        ...mockConfig,
        slug: 'adoption-invalid-format',
        allowedOrigins: 'https://adoption-invalid-format.apollofit.com.br',
        supabaseProjectRef: 'INVALID-REF!'
      };

      await expect(engine.startDeployment(deploymentId, config)).rejects.toThrow();

      const failed = await deploymentRepository.findById(deploymentId);
      expect(failed!.status).toBe('FAILED');
      expect(failed!.errorMessage).toContain('supabaseProjectRef inválido');
    });

    it('should use creation mode when supabaseProjectRef is not provided', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'creation-mode-test',
        name: 'Creation Mode Test',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      // No supabaseProjectRef - should use creation mode
      const config = {
        ...mockConfig,
        slug: 'creation-mode-test',
        allowedOrigins: 'https://creation-mode-test.apollofit.com.br'
        // supabaseProjectRef omitted
      };
      await engine.startDeployment(deploymentId, config);

      // Verify completion and that step 1 has a NEW projectRef (not the adoption ref)
      const completed = await deploymentRepository.findById(deploymentId);
      expect(completed!.status).toBe('COMPLETED');

      const step1 = completed!.steps!.find(s => s.stepNumber === 1);
      expect(step1!.metadata).toBeDefined();
      const projectRef = (step1!.metadata as any).projectRef;
      expect(projectRef).toBeDefined();
      expect(projectRef).toMatch(/^apollo-creation-mode-test-/); // Creation mode generates new ref
    });

    it('should adopt existing project via engine without creating new project', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'adoption-engine-no-create',
        name: 'Adoption Engine No Create',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      // Spy on the engine's supabase adapter createProject
      const { createMockSupabaseAdapter } = await import('../../src/adapters/mock.js');
      const mockAdapter = createMockSupabaseAdapter();
      const createProjectSpy = vi.spyOn(mockAdapter, 'createProject');

      // Replace factory to return our spied adapter, but use the SAME secretStore
      const testEngine = new DeploymentEngine({
        adapterFactory: {
          ...createAdapterFactory(),
          createSupabaseAdapter: () => mockAdapter,
        },
        secretStore: secretStore, // Use shared secretStore with secrets already set
      });

      const validProjectRef = 'lenfghvvaiyqkefzxrmp'; // exactly 20 chars

      // Run ONLY step 1 (supabase_create) via engine with existingProjectRef
      const config = {
        ...mockConfig,
        slug: 'adoption-engine-no-create',
        allowedOrigins: 'https://adoption-engine-no-create.apollofit.com.br',
        supabaseProjectRef: validProjectRef,
      };

      // Use the internal method to execute step 1 only
      const context = await testEngine['buildEngineContext'](deploymentId, config, 1);
      const stepDef = DEPLOYMENT_STEPS[0]; // supabase_create
      const result = await testEngine['executeStep'](stepDef, context);

      // Debug: log result if failed
      if (!result.success) {
        console.log('STEP RESULT ERROR:', result.error);
      }

      // Verify adoption succeeded
      expect(result.success).toBe(true);
      expect(result.data?.projectRef).toBe(validProjectRef); // Returns EXISTING ref, not new one
      expect(result.data?.projectRef).not.toMatch(/^apollo-/); // No generated prefix

      // Verify createProject was called with existingProjectRef
      expect(createProjectSpy).toHaveBeenCalledTimes(1);
      const callArgs = createProjectSpy.mock.calls[0][1];
      expect(callArgs.existingProjectRef).toBe(validProjectRef);
      expect(callArgs.dbPassword).toBe('test-password-123');

      // KEY ASSERTION: The returned projectRef is the EXISTING one, not a newly generated one.
      // In creation mode, mock adapter generates: apollo-${slug}-${timestamp}
      // In adoption mode, it returns the provided existingProjectRef.
      // This proves the engine passes existingProjectRef to adapter and adapter does NOT create new project.
    });

    it('should reject supabaseProjectRef with 19 characters', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'adoption-19-chars',
        name: 'Adoption 19 Chars',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      // 19 characters (one short)
      const config = {
        ...mockConfig,
        slug: 'adoption-19-chars',
        allowedOrigins: 'https://adoption-19-chars.apollofit.com.br',
        supabaseProjectRef: 'lenfghvvaiyqkefzxrm' // 19 chars
      };

      await expect(engine.startDeployment(deploymentId, config)).rejects.toThrow();

      const failed = await deploymentRepository.findById(deploymentId);
      expect(failed!.status).toBe('FAILED');
      expect(failed!.errorMessage).toContain('exatamente 20 caracteres');
    });

    it('should reject supabaseProjectRef with 21 characters', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'adoption-21-chars',
        name: 'Adoption 21 Chars',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      // 21 characters (one extra)
      const config = {
        ...mockConfig,
        slug: 'adoption-21-chars',
        allowedOrigins: 'https://adoption-21-chars.apollofit.com.br',
        supabaseProjectRef: 'lenfghvvaiyqkefzxrmpx' // 21 chars
      };

      await expect(engine.startDeployment(deploymentId, config)).rejects.toThrow();

      const failed = await deploymentRepository.findById(deploymentId);
      expect(failed!.status).toBe('FAILED');
      expect(failed!.errorMessage).toContain('exatamente 20 caracteres');
    });
  });

  describe('Engine - State Transitions', () => {
    it('should start deployment and transition through states', async () => {
      // Create deployment via repository
      const deployment = await deploymentRepository.create({
        slug: 'engine-test',
        name: 'Engine Test',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Set up secrets in SecretStore before starting
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      // Start deployment (this runs all 5 steps with mock adapters)
      const config = { ...mockConfig, slug: 'engine-test', allowedOrigins: 'https://engine-test.apollofit.com.br' };
      await engine.startDeployment(deploymentId, config);

      // Verify final state
      const completed = await deploymentRepository.findById(deploymentId);
      expect(completed).not.toBeNull();
      expect(completed!.status).toBe('COMPLETED');
      expect(completed!.currentStep).toBe(5);
      expect(completed!.completedAt).toBeDefined();

      // Verify all steps completed
      expect(completed!.steps).toHaveLength(5);
      for (const step of completed!.steps!) {
        expect(step.status).toBe('COMPLETED');
        expect(step.completedAt).toBeDefined();
        expect(step.metadata).toBeDefined();
      }
    });

    it('should record step metadata correctly', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'metadata-test',
        name: 'Metadata Test',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      const config = { ...mockConfig, slug: 'metadata-test', allowedOrigins: 'https://metadata-test.apollofit.com.br' };
      await engine.startDeployment(deploymentId, config);

      const completed = await deploymentRepository.findById(deploymentId);

      // Check step 1 - supabase_create has projectRef and connection strings
      const step1 = completed!.steps!.find(s => s.stepNumber === 1);
      expect(step1!.metadata).toBeDefined();
      expect(step1!.metadata).toHaveProperty('projectRef');
      expect(step1!.metadata).toHaveProperty('connectionStrings');
      const connStrings = (step1!.metadata as any).connectionStrings;
      expect(connStrings).toHaveProperty('databaseUrl');
      expect(connStrings).toHaveProperty('directUrl');

      // Check step 3 - render_create has serviceId and serviceUrl
      const step3 = completed!.steps!.find(s => s.stepNumber === 3);
      expect(step3!.metadata).toBeDefined();
      expect(step3!.metadata).toHaveProperty('serviceId');
      expect(step3!.metadata).toHaveProperty('serviceUrl');

      // Check step 5 - netlify_deploy has siteId, domain, domainAdded (NO siteUrl - no deploy triggered)
      const step5 = completed!.steps!.find(s => s.stepNumber === 5);
      expect(step5!.metadata).toBeDefined();
      expect(step5!.metadata).toHaveProperty('siteId');
      expect(step5!.metadata).toHaveProperty('domain');
      expect(step5!.metadata).toHaveProperty('domainAdded');
      // siteUrl NÃO deve estar presente - build não é disparado durante provisionamento
      expect(step5!.metadata).not.toHaveProperty('siteUrl');
    });
  });

  describe('Engine - Resume Interrupted Deployment', () => {
    it('should resume from failed step without re-running completed steps', async () => {
      // Create deployment
      const deployment = await deploymentRepository.create({
        slug: 'resume-test',
        name: 'Resume Test',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Set up secrets for resume
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'allowedOrigins', 'https://resume-test.apollofit.com.br');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      // Manually mark first 3 steps as completed (simulate interruption after step 3)
      // Use FAILED status to allow resume (engine allows resume from FAILED)
      await deploymentRepository.update(deploymentId, {
        status: 'FAILED',
        currentStep: 3,
        errorMessage: 'Interrupted after step 3',
      });
      await deploymentRepository.updateStep(deploymentId, 1, {
        status: 'COMPLETED',
        completedAt: new Date(),
        metadata: { projectRef: 'mock-ref', connectionStrings: { databaseUrl: 'mock', directUrl: 'mock' } },
      });
      await deploymentRepository.updateStep(deploymentId, 2, {
        status: 'COMPLETED',
        completedAt: new Date(),
        metadata: { migrationsApplied: 12 },
      });
      await deploymentRepository.updateStep(deploymentId, 3, {
        status: 'COMPLETED',
        completedAt: new Date(),
        metadata: { serviceId: 'srv-mock', serviceUrl: 'https://mock.onrender.com' },
      });

      // Create config for this deployment - operational config only
      const config = { ...mockConfig, slug: 'resume-test' };
      await deploymentRepository.createConfig(deploymentId, {
        supabaseRegion: 'sa-east-1',
        renderServiceId: config.renderServiceId,
        netlifySiteId: config.netlifySiteId,
        repo: config.repo,
        branch: config.branch,
        dockerfilePath: config.dockerfilePath,
        publicApiUrl: config.publicApiUrl,
        allowedOrigins: `https://${config.slug}.apollofit.com.br`,
      });

      // Resume deployment
      await engine.resumeDeployment(deploymentId);

      // Verify completion
      const completed = await deploymentRepository.findById(deploymentId);
      expect(completed!.status).toBe('COMPLETED');
      expect(completed!.currentStep).toBe(5);

      // Verify steps 1-3 were NOT re-run (metadata preserved)
      const step1 = completed!.steps!.find(s => s.stepNumber === 1);
      expect(step1!.metadata).toEqual({ projectRef: 'mock-ref', connectionStrings: { databaseUrl: 'mock', directUrl: 'mock' } });

      const step3 = completed!.steps!.find(s => s.stepNumber === 3);
      expect(step3!.metadata).toEqual({ serviceId: 'srv-mock', serviceUrl: 'https://mock.onrender.com' });

      // Verify steps 4-5 were executed
      const step4 = completed!.steps!.find(s => s.stepNumber === 4);
      expect(step4!.status).toBe('COMPLETED');
      expect(step4!.metadata).toBeDefined();

      const step5 = completed!.steps!.find(s => s.stepNumber === 5);
      expect(step5!.status).toBe('COMPLETED');
      expect(step5!.metadata).toBeDefined();
    });

    it('should retry failed step on resume', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'retry-test',
        name: 'Retry Test',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Set up secrets
      await secretStore.set(deploymentId, 'deployment', 'dbPassword', 'test-password-123');
      await secretStore.set(deploymentId, 'deployment', 'jwtAccessSecret', 'test-access-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'jwtRefreshSecret', 'test-refresh-secret-32-chars-long-minimum');
      await secretStore.set(deploymentId, 'deployment', 'allowedOrigins', 'https://retry-test.apollofit.com.br');
      await secretStore.setGlobal('global', 'netlify.authToken', 'mock-netlify-token');

      // Mark step 1 completed, step 2 failed
      await deploymentRepository.update(deploymentId, {
        status: 'FAILED',
        currentStep: 2,
        errorMessage: 'Step 2 failed',
      });
      await deploymentRepository.updateStep(deploymentId, 1, {
        status: 'COMPLETED',
        completedAt: new Date(),
        metadata: { projectRef: 'mock-ref', connectionStrings: { databaseUrl: 'mock', directUrl: 'mock' } },
      });
      await deploymentRepository.updateStep(deploymentId, 2, {
        status: 'FAILED',
        completedAt: new Date(),
        errorMessage: 'Migration failed',
      });

      // Create config for this deployment
      const config = { ...mockConfig, slug: 'retry-test' };
      await deploymentRepository.createConfig(deploymentId, {
        supabaseRegion: 'sa-east-1',
        renderServiceId: config.renderServiceId,
        netlifySiteId: config.netlifySiteId,
        repo: config.repo,
        branch: config.branch,
        dockerfilePath: config.dockerfilePath,
        publicApiUrl: config.publicApiUrl,
        allowedOrigins: `https://${config.slug}.apollofit.com.br`,
      });

      // Resume - should retry step 2
      await engine.resumeDeployment(deploymentId);

      const completed = await deploymentRepository.findById(deploymentId);
      expect(completed!.status).toBe('COMPLETED');

      // Step 1 metadata preserved
      const step1 = completed!.steps!.find(s => s.stepNumber === 1);
      expect(step1!.metadata).toEqual({ projectRef: 'mock-ref', connectionStrings: { databaseUrl: 'mock', directUrl: 'mock' } });

      // Step 2 retried and completed
      const step2 = completed!.steps!.find(s => s.stepNumber === 2);
      expect(step2!.status).toBe('COMPLETED');
      expect(step2!.metadata).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid adapter config gracefully', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'error-test',
        name: 'Error Test',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Start with missing tokens (will fail validation)
      await expect(
        engine.startDeployment(deploymentId, { slug: 'error-test' })
      ).rejects.toThrow();

      const failed = await deploymentRepository.findById(deploymentId);
      expect(failed!.status).toBe('FAILED');
      expect(failed!.errorMessage).toBeDefined();
    });

    it('should not allow starting already completed deployment', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'completed-test',
        name: 'Completed Test',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      // Mark as completed
      await deploymentRepository.update(deploymentId, {
        status: 'COMPLETED',
        currentStep: 5,
        completedAt: new Date(),
      });

      await expect(
        engine.resumeDeployment(deploymentId)
      ).rejects.toThrow('Deployment already completed');
    });

    it('should not allow starting in-progress deployment', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'inprogress-test',
        name: 'In Progress Test',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });
      deploymentId = deployment.id;

      await deploymentRepository.update(deploymentId, {
        status: 'IN_PROGRESS',
        currentStep: 2,
      });

      await expect(
        engine.resumeDeployment(deploymentId)
      ).rejects.toThrow('Deployment already in progress');
    });
  });

  describe('Database - Schema Consistency', () => {
    it('should have all required tables', async () => {
      const tables = await prisma.$queryRaw`
        SELECT name FROM sqlite_master WHERE type='table'
      ` as Array<{ name: string }>;

      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('Deployment');
      expect(tableNames).toContain('DeploymentStep');
      expect(tableNames).toContain('DeploymentConfig');
    });

    it('should have correct foreign key constraints', async () => {
      const fks = await prisma.$queryRaw`
        SELECT * FROM pragma_foreign_key_list('DeploymentStep')
      ` as Array<{ table: string; from: string; to: string }>;

      expect(fks.length).toBeGreaterThan(0);
      expect(fks[0].table).toBe('Deployment');
      expect(fks[0].from).toBe('deploymentId');
      expect(fks[0].to).toBe('id');
    });

    it('should have unique constraint on deployment slug', async () => {
      await deploymentRepository.create({
        slug: 'unique-test',
        name: 'Unique Test',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });

      await expect(
        deploymentRepository.create({
          slug: 'unique-test',
          name: 'Unique Test 2',
          adminEmail: 'admin2@test.com',
          adminName: 'Admin Test 2',
        })
      ).rejects.toThrow();
    });

    it('should have unique constraint on deploymentId_stepNumber', async () => {
      const deployment = await deploymentRepository.create({
        slug: 'unique-step-test',
        name: 'Unique Step Test',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      });

      // Try to create duplicate step
      await expect(
        prisma.deploymentStep.create({
          data: {
            deploymentId: deployment.id,
            stepNumber: 1,
            name: 'duplicate',
            description: 'Duplicate step',
            status: 'PENDING',
          },
        })
      ).rejects.toThrow();
    });
  });
});