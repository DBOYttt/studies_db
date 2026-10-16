import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Load the repo-root .env (Next only reads apps/web/.env). Real env vars win.
// (--env-file-if-exists can't be used: Next forwards it into worker NODE_OPTIONS.)
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // e2e / side-by-side dev servers set NEXT_DIST_DIR so they don't fight over the .next lock.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: 'standalone',
  // The proxy buffers request bodies (default 10 MB, silently truncating).
  // Event uploads are up to 10 files x 10 MB plus multipart overhead.
  experimental: { proxyClientMaxBodySize: '102mb' },
  transpilePackages: ['@studies/db'],
  serverExternalPackages: ['mysql2'],
  // packages/db imports its own TS files with `.js` extensions (NodeNext style).
  webpack(cfg) {
    cfg.resolve.extensionAlias = {
      ...cfg.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    // packages/db computes the repo root with `new URL('../../..', import.meta.url)`;
    // webpack would otherwise try to resolve that as an asset and fail the build.
    cfg.module.parser = {
      ...cfg.module.parser,
      javascript: { ...cfg.module.parser?.javascript, url: false },
    };
    return cfg;
  },
};

export default config;
