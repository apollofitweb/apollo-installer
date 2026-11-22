/**
 * CORS plugin for Apollo Installer API
 *
 * Required when the admin UI is hosted on a different origin (e.g. Netlify)
 * than the API (e.g. Render). The allowed origins come from ALLOWED_ORIGINS,
 * which is validated as an explicit list in production (never '*').
 */

import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';

/** Parse a comma-separated origin list into a clean array. */
export function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function getAllowedOrigins(): string[] {
  return parseAllowedOrigins(env.corsOrigin);
}

export async function corsPlugin(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: getAllowedOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}
