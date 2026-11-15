/**
 * Simple logger implementation for Apollo Installer
 */

import type { Logger } from './types.js';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = typeof LOG_LEVELS[number];

function getLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level && LOG_LEVELS.includes(level as LogLevel)) {
    return level as LogLevel;
  }
  return 'info';
}

function shouldLog(level: LogLevel): boolean {
  const current = getLogLevel();
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(current);
}

function formatMessage(level: string, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

export const logger: Logger = {
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (shouldLog('debug')) console.debug(formatMessage('debug', message, meta));
  },
  info: (message: string, meta?: Record<string, unknown>) => {
    if (shouldLog('info')) console.info(formatMessage('info', message, meta));
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    if (shouldLog('warn')) console.warn(formatMessage('warn', message, meta));
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    if (shouldLog('error')) console.error(formatMessage('error', message, meta));
  },
};

export function createChildLogger(prefix: string): Logger {
  return {
    debug: (message: string, meta?: Record<string, unknown>) => logger.debug(`[${prefix}] ${message}`, meta),
    info: (message: string, meta?: Record<string, unknown>) => logger.info(`[${prefix}] ${message}`, meta),
    warn: (message: string, meta?: Record<string, unknown>) => logger.warn(`[${prefix}] ${message}`, meta),
    error: (message: string, meta?: Record<string, unknown>) => logger.error(`[${prefix}] ${message}`, meta),
  };
}