import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
  resolve: {
    alias: [
      // Test-only shim: guarantees a single React instance shared with
      // react-dom (see src/test/react-shim.ts).
      { find: /^react$/, replacement: path.resolve(__dirname, './src/test/react-shim.ts') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
});
