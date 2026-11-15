import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['tests/**', 'dist/**', 'node_modules/**'],
    },
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@engine': path.resolve(__dirname, './src/engine'),
      '@adapters': path.resolve(__dirname, './src/adapters'),
      '@persistence': path.resolve(__dirname, './src/persistence'),
      '@config': path.resolve(__dirname, './src/config'),
      '@admin': path.resolve(__dirname, './src/admin'),
    },
  },
});