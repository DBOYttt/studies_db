import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => ({
  test: {
    // Warsaw local time, so a local-getter slip in wall-time code shows up.
    env: { ...loadEnv(mode, repoRoot, ''), TZ: 'Europe/Warsaw' },
    fileParallelism: false,
  },
}));
