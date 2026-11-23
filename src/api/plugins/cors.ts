/**
 * CORS plugin for Apollo Installer API
 *
 * Required when the admin UI is hosted on a different origin (e.g. Netlify)
 * than the API (e.g. Render). The allowed origins come from ALLOWED_ORIGINS,
 * which is validated as an explicit list in production (never '*').
 */

import cors from '@fastify/cors';
import fp from 'fastify-plugin';
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

// fastify-plugin é necessário para que o hook do @fastify/cors seja registrado no
// escopo raiz. Sem ele, o plugin fica encapsulado: o preflight (OPTIONS) era
// respondido com os headers corretos, mas as requisições reais (POST/GET) não
// recebiam Access-Control-Allow-Origin e o navegador reportava "Network Error".
export const corsPlugin = fp(async (app: FastifyInstance): Promise<void> => {
  await app.register(cors, {
    origin: getAllowedOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
});
