/**
 * Migration and Seed SQL Loader
 * Loads Prisma migration files and seed SQL for Supabase Management API execution
 * Does NOT include unsafe SQL interpolation utilities
 * Management API does not support parameterized queries; raw SQL must be pre-validated
 */

import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';

export interface MigrationFile {
  name: string;
  sql: string;
  order: number;
}

/**
 * Load all migration SQL files from the prisma migrations directory
 * Returns them sorted by migration name (which includes timestamp for ordering)
 */
export function loadMigrations(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const migrationDirs = entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name)); // Sort by name (timestamp prefix)

  const migrations: MigrationFile[] = [];

  for (const dir of migrationDirs) {
    const migrationPath = path.join(migrationsDir, dir.name, 'migration.sql');
    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      migrations.push({
        name: dir.name,
        sql: sql.trim(),
        order: migrations.length + 1,
      });
    }
  }

  return migrations;
}

/**
 * Load seed SQL from a file
 */
export function loadSeedSql(seedPath: string): string {
  if (!fs.existsSync(seedPath)) {
    throw new Error(`Seed file not found: ${seedPath}`);
  }
  return fs.readFileSync(seedPath, 'utf-8').trim();
}

/**
 * Calculate SHA-256 checksum of migration SQL (matching Prisma behavior)
 */
export function calculateChecksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/**
 * Generate RFC4122 v4 UUID for migration record ID
 */
export function generateMigrationId(): string {
  return randomUUID();
}

/**
 * Validate bcrypt hash format (RFC 2307)
 * Expected: $2[abxy]$cost$hash (60 chars for cost 10)
 */
export function validateBcryptHash(hash: string): boolean {
  // $2a$, $2b$, $2x$, $2y$ followed by 2-digit cost, $, 53-char hash
  return /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);
}

/**
 * Default paths relative to project root
 */
export const DEFAULT_MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../../../apps/api/prisma/migrations'
);

export const DEFAULT_SEED_SQL_PATH = path.resolve(
  __dirname,
  '../../../../apps/api/prisma/seed.sql'
);