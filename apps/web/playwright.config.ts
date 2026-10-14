import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { defineConfig } from '@playwright/test';

try {
  loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // CI may provide TEST_DATABASE_URL directly
}

const PORT = 3100;
export const E2E_STORAGE_DIR = join(tmpdir(), 'studies-db-e2e-storage');
const { testRoUrl, testRwUrl } = await import('@studies/db/testing');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  timeout: 60_000,
  // `next dev` compiles each route on its first visit, which can take >5 s.
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, locale: 'pl-PL' },
  webServer: {
    // same as `pnpm dev`, but on the e2e port
    command: `node scripts/copy-pdf-worker.mjs && next dev --webpack -p ${PORT}`,
    url: `http://localhost:${PORT}/login-info`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_DIST_DIR: '.next-e2e',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      DATABASE_RO_URL: testRoUrl(),
      DATABASE_RW_URL: testRwUrl(),
      STORAGE_DIR: E2E_STORAGE_DIR,
      DISCORD_GUILD_ID: 'e2eguild',
    },
  },
});
