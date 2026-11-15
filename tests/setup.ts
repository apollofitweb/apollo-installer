import { vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use unique database per test file using process ID
const testDbPath = `file:./test-${process.pid}.db`;
process.env.DATABASE_URL = testDbPath;

// Run prisma db push to create schema in the test database
try {
  execSync('pnpm prisma db push --skip-generate', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'ignore'
  });
} catch {
  // Ignore errors if schema already exists
}

// Global test timeout
vi.setConfig({ testTimeout: 30000 });