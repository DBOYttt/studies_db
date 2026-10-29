import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { cacheHeaderRules } from './lib/cache-headers';
import { onDemandEntriesFromEnv } from './lib/dev-config';
import { securityHeaderRules } from './lib/security-headers';

// Load the repo-root .env (Next only reads apps/web/.env). Real env vars win.
// (--env-file-if-exists can't be used: Next forwards it into worker NODE_OPTIONS.)
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // e2e / side-by-side dev servers set NEXT_DIST_DIR so they don't fight over the .next lock.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: 'standalone',
  transpilePackages: ['@studies/db'],
  serverExternalPackages: ['mysql2'],
  poweredByHeader: false,
  // Dev only: a bigger compiled-page buffer for the QA sandbox (qa-serve.mjs).
  onDemandEntries: onDemandEntriesFromEnv(process.env),
  // Nothing uses next/image; keep /_next/image from fetching or resizing.
  images: { unoptimized: true },
  // "Import from UniTime" accepts a .ics upload of up to 2 MiB (checked again
  // in the action); the default 1 MB would refuse it before the action runs.
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
  async headers() {
    return [
      ...securityHeaderRules(process.env.NODE_ENV),
      ...cacheHeaderRules(),
    ];
  },
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
