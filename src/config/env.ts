/**
 * Environment configuration for Apollo Installer
 * Validates required variables at startup
 */

import 'dotenv/config';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function parseIntSafe(value: string | undefined, defaultValue: number): number {
  if (!value || value.trim() === '') return defaultValue;
  const parsed = parseInt(value.trim(), 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

const isProduction = process.env.NODE_ENV === 'production';

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  port: parseIntSafe(process.env.PORT, 3334),
  appUrl: process.env.APP_URL || `http://localhost:${parseIntSafe(process.env.PORT, 3334)}`,

  databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
  directUrl: process.env.DIRECT_URL,

  jwtAccessSecret: isProduction
    ? requireEnv('JWT_ACCESS_SECRET')
    : process.env.JWT_ACCESS_SECRET || 'dev-access-secret-min-32-chars-long',
  jwtRefreshSecret: isProduction
    ? requireEnv('JWT_REFRESH_SECRET')
    : process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-min-32-chars-long',
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  corsOrigin: process.env.ALLOWED_ORIGINS || 'http://localhost:5174,http://localhost:3000',

  publicApiUrl: process.env.PUBLIC_API_URL || `http://localhost:${parseIntSafe(process.env.PORT, 3334)}`,

  logLevel: process.env.LOG_LEVEL || 'info',

  // Adapter placeholders - interfaces only in OS-002
  supabaseAccessToken: process.env.SUPABASE_ACCESS_TOKEN,
  renderApiToken: process.env.RENDER_API_TOKEN,
  netlifyAuthToken: process.env.NETLIFY_AUTH_TOKEN,
};

if (isProduction) {
  if (!env.jwtAccessSecret || env.jwtAccessSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 characters in production');
  }
  if (!env.jwtRefreshSecret || env.jwtRefreshSecret.length < 32) {
    throw new Error('JWT_REFRESH_SECRET must be at least 32 characters in production');
  }
  if (env.corsOrigin === '*' || env.corsOrigin.trim() === '') {
    throw new Error('ALLOWED_ORIGINS must be explicit list in production');
  }
}