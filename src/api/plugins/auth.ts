import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../../config/env.js';
import { InstallerError } from '../../shared/errors.js';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

export interface JWTPayload {
  sub: string;
  email: string;
  role: 'admin' | 'operator' | 'viewer';
  iat?: number;
  exp?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}

// Roles that can manage secrets
export const SECRET_MANAGEMENT_ROLES = ['admin', 'operator'] as const;
type SecretManagementRole = typeof SECRET_MANAGEMENT_ROLES[number];

export function isSecretManagementRole(role: string): role is SecretManagementRole {
  return SECRET_MANAGEMENT_ROLES.includes(role as SecretManagementRole);
}

async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const decoded = jwt.verify(token, env.jwtAccessSecret) as JWTPayload;
    return decoded;
  } catch {
    return null;
  }
}

function isProtectedDeploymentRoute(url: string, method: string): boolean {
  // Secret routes
  if (url.includes('/secrets')) return true;
  // Start/resume deployment
  if (url.includes('/start') || url.includes('/resume')) return true;
  // Update config
  if (url.includes('/config')) return true;
  // Delete deployment
  if (method === 'DELETE' && url.startsWith('/api/deployments/')) return true;
  // Get by slug is public (for public verification/lookup)
  if (url.match(/\/api\/deployments\/slug\/[^/]+$/)) return false;
  // All other deployment routes require authentication
  // This includes: POST /api/deployments, GET /api/deployments, GET /api/deployments/:id
  if (url.startsWith('/api/deployments')) return true;
  return false;
}

// Global auth hook - to be added to root app
export const globalAuthHook = async (request: FastifyRequest, reply: FastifyReply) => {
  // Only API routes are protected. Static admin UI files and SPA routes are public.
  if (!request.url.startsWith('/api/')) {
    return;
  }

  // Login is the only public API route (besides the public slug lookup)
  if (request.url.startsWith('/api/auth/login')) {
    return;
  }

  // Public deployment routes (no auth required)
  // Only GET /api/deployments/slug/:slug is public
  const isPublicDeploymentRoute =
    (request.url.startsWith('/api/deployments/') && !isProtectedDeploymentRoute(request.url, request.method));

  if (isPublicDeploymentRoute) {
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new InstallerError('Missing or invalid Authorization header', 'UNAUTHORIZED', 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token);

  if (!payload) {
    throw new InstallerError('Invalid or expired token', 'UNAUTHORIZED', 401);
  }

  request.user = payload;
};

// Specific helper for secret management - exported for use in routes
export const requireSecretManagement = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!request.user) {
    throw new InstallerError('Authentication required', 'UNAUTHORIZED', 401);
  }
  if (!isSecretManagementRole(request.user.role)) {
    throw new InstallerError('Insufficient permissions for secret management', 'FORBIDDEN', 403);
  }
};

export async function authPlugin(app: FastifyInstance) {
  // Authentication decorator
  app.decorateRequest('user', undefined);

  // Role-based authorization helper
  app.decorate('requireRole', (...allowedRoles: string[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        throw new InstallerError('Authentication required', 'UNAUTHORIZED', 401);
      }
      if (!allowedRoles.includes(request.user.role)) {
        throw new InstallerError('Insufficient permissions', 'FORBIDDEN', 403);
      }
    };
  });

  // Decorate app with requireSecretManagement for backward compatibility
  app.decorate('requireSecretManagement', requireSecretManagement);
}