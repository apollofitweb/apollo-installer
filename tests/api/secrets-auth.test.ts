/**
 * Tests for secret management API authentication and authorization
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/api/index.js';
import { env } from '../../src/config/env.js';
import jwt from 'jsonwebtoken';

describe('Secret Management API - Authentication & Authorization', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  // Test tokens for different roles
  const adminToken = jwt.sign(
    { sub: 'user-admin', email: 'admin@test.com', role: 'admin' },
    env.jwtAccessSecret,
    { expiresIn: '1h' }
  );

  const operatorToken = jwt.sign(
    { sub: 'user-operator', email: 'operator@test.com', role: 'operator' },
    env.jwtAccessSecret,
    { expiresIn: '1h' }
  );

  const viewerToken = jwt.sign(
    { sub: 'user-viewer', email: 'viewer@test.com', role: 'viewer' },
    env.jwtAccessSecret,
    { expiresIn: '1h' }
  );

  const invalidToken = 'invalid-token';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const secretRoutes = [
    { method: 'POST', url: '/api/deployments/test-id/secrets', payload: { key: 'test', value: 'test', expectedVersion: 0 } },
    { method: 'GET', url: '/api/deployments/test-id/secrets/test-key', payload: undefined },
    { method: 'GET', url: '/api/deployments/test-id/secrets/test-key/meta', payload: undefined },
    { method: 'GET', url: '/api/deployments/test-id/secrets', payload: undefined },
    { method: 'DELETE', url: '/api/deployments/test-id/secrets/test-key', payload: { expectedVersion: 0 } },
    { method: 'POST', url: '/api/secrets/global', payload: { key: 'netlify.authToken', value: 'test', expectedVersion: 0 } },
    { method: 'GET', url: '/api/secrets/global/netlify.authToken', payload: undefined },
    { method: 'GET', url: '/api/secrets/global/netlify.authToken/meta', payload: undefined },
    { method: 'GET', url: '/api/secrets/global', payload: undefined },
    { method: 'DELETE', url: '/api/secrets/global/netlify.authToken', payload: { expectedVersion: 0 } },
  ];

  describe('Unauthenticated access', () => {
    for (const route of secretRoutes) {
      it(`should return 401 for ${route.method} ${route.url} without token`, async () => {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          payload: route.payload,
        });
        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.payload);
        expect(body.success).toBe(false);
        expect(body.code).toBe('UNAUTHORIZED');
      });
    }
  });

  describe('Invalid token', () => {
    for (const route of secretRoutes) {
      it(`should return 401 for ${route.method} ${route.url} with invalid token`, async () => {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          headers: { authorization: `Bearer ${invalidToken}` },
          payload: route.payload,
        });
        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.payload);
        expect(body.success).toBe(false);
        expect(body.code).toBe('UNAUTHORIZED');
      });
    }
  });

  describe('Viewer role (insufficient permissions)', () => {
    for (const route of secretRoutes) {
      it(`should return 403 for ${route.method} ${route.url} with viewer role`, async () => {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          headers: { authorization: `Bearer ${viewerToken}` },
          payload: route.payload,
        });
        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.payload);
        expect(body.success).toBe(false);
        expect(body.code).toBe('FORBIDDEN');
      });
    }
  });

  describe('Operator role (authorized)', () => {
    for (const route of secretRoutes) {
      it(`should not return 401/403 for ${route.method} ${route.url} with operator role`, async () => {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          headers: { authorization: `Bearer ${operatorToken}` },
          payload: route.payload,
        });
        // Should not be auth errors (may be 404, 400, etc. due to missing data, but not 401/403)
        expect(response.statusCode).not.toBe(401);
        expect(response.statusCode).not.toBe(403);
      });
    }
  });

  describe('Admin role (authorized)', () => {
    for (const route of secretRoutes) {
      it(`should not return 401/403 for ${route.method} ${route.url} with admin role`, async () => {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: route.payload,
        });
        // Should not be auth errors
        expect(response.statusCode).not.toBe(401);
        expect(response.statusCode).not.toBe(403);
      });
    }
  });

  describe('Health check (public)', () => {
    it('should allow unauthenticated access to /health', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.status).toBe('ok');
    });
  });

  describe('Deployment CRUD (now requires auth)', () => {
    it('should return 401 for create deployment without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/deployments',
        payload: {
          slug: 'auth-test-filial',
          name: 'Auth Test Filial',
          adminEmail: 'admin@test.com',
          adminName: 'Admin Test',
        },
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for list deployments without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/deployments',
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('should allow authenticated access to create deployment', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/deployments',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          slug: 'auth-test-filial-admin',
          name: 'Auth Test Filial Admin',
          adminEmail: 'admin@test.com',
          adminName: 'Admin Test',
        },
      });
      // Should not be 401/403 (may be 201 or 409 if exists)
      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).not.toBe(403);
    });

    it('should allow authenticated access to list deployments', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/deployments',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).not.toBe(403);
    });
  });
});