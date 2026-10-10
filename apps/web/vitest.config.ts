import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => ({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts'],
    env: loadEnv(mode, repoRoot, ''),
    fileParallelism: false,
  },
}));
