import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, repoRoot, ''),
    fileParallelism: false,
    // Some tests run real soffice; a cold start can exceed the 5 s default.
    testTimeout: 60_000,
  },
}));
