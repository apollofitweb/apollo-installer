/**
 * Tests for deployment API routes
 * Integration-style tests using Fastify inject
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../../src/api/index.js';
import { env } from '../../src/config/env.js';
import jwt from 'jsonwebtoken';

describe('Deployment API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  // Test token for authenticated requests
  const adminToken = jwt.sign(
    { sub: 'user-admin', email: 'admin@test.com', role: 'admin' },
    env.jwtAccessSecret,
    { expiresIn: '1h' }
  );

  const authHeaders = { authorization: `Bearer ${adminToken}` };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up test deployments
    // In real implementation, use test database
  });

  it('should return 401 for create deployment without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/deployments',
      payload: {
        slug: 'test-filial-auth',
        name: 'Test Filial Auth',
        adminEmail: 'admin@test.com',
        adminName: 'Admin',
      },
    });
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('should return 400 for invalid slug with auth', async () => {
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
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
  });

  it('should return 400 for invalid email with auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/deployments',
      headers: authHeaders,
      payload: {
        slug: 'test-filial-email',
        name: 'Test Filial',
        adminEmail: 'not-an-email',
        adminName: 'Admin',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('should return 400 for missing required fields with auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/deployments',
      headers: authHeaders,
      payload: {
        slug: 'test-filial-missing',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('should return 201 for valid input with auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/deployments',
      headers: authHeaders,
      payload: {
        slug: 'test-filial-api-auth',
        name: 'Test Filial API Auth',
        adminEmail: 'admin@test.com',
        adminName: 'Admin Test',
      },
    });
    // May be 201 or 409 if slug exists from previous test
    expect([201, 409]).toContain(response.statusCode);
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

  it('should list deployments with auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/deployments',
      headers: authHeaders,
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('should return health check without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('apollo-installer');
  });
});