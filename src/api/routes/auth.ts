/**
 * Administrative authentication routes
 * Issues short-lived JWTs for the admin UI based on the configured admin account.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { timingSafeEqual } from 'crypto';
import { env } from '../../config/env.js';
import { InstallerError } from '../../shared/errors.js';

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(256),
});

async function verifyPassword(password: string): Promise<boolean> {
  if (env.adminPasswordHash) {
    try {
      return await bcrypt.compare(password, env.adminPasswordHash);
    } catch {
      return false;
    }
  }

  if (env.adminPassword) {
    const provided = Buffer.from(password);
    const expected = Buffer.from(env.adminPassword);
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  }

  return false;
}

function issueToken(email: string): { token: string; expiresIn: string } {
  const token = jwt.sign(
    { sub: 'installer-admin', email, role: 'admin' },
    env.jwtAccessSecret,
    { expiresIn: env.adminSessionTtl as jwt.SignOptions['expiresIn'] }
  );
  return { token, expiresIn: env.adminSessionTtl };
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: z.infer<typeof loginSchema> }>(
    '/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new InstallerError('Credenciais inválidas', 'UNAUTHORIZED', 401);
      }

      const emailMatches =
        parsed.data.email.trim().toLowerCase() === env.adminEmail.trim().toLowerCase();

      if (!emailMatches || !(await verifyPassword(parsed.data.password))) {
        throw new InstallerError('Credenciais inválidas', 'UNAUTHORIZED', 401);
      }

      const { token, expiresIn } = issueToken(env.adminEmail);
      return reply.send({
        success: true,
        data: {
          token,
          expiresIn,
          user: { email: env.adminEmail, role: 'admin' },
        },
      });
    }
  );

  app.get('/auth/me', async (request, reply) => {
    if (!request.user) {
      throw new InstallerError('Authentication required', 'UNAUTHORIZED', 401);
    }
    return reply.send({
      success: true,
      data: { email: request.user.email, role: request.user.role },
    });
  });
}
