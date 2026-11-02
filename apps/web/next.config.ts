import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { cacheHeaderRules } from './lib/cache-headers';
import { onDemandEntriesFromEnv } from './lib/dev-config';
import { securityHeaderRules } from './lib/security-headers';

// Load the repo-root .env (Next only reads apps/web/.env). Real env vars win.
// (--env-file-if-exists can't be used: Next forwards it into worker NODE_OPTIONS.)
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const require = createRequire(import.meta.url);

const config: NextConfig = {
  // e2e / side-by-side dev servers set NEXT_DIST_DIR so they don't fight over the .next lock.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: 'standalone',
  transpilePackages: ['@studies/db'],
  serverExternalPackages: ['mysql2'],
  poweredByHeader: false,
  // Dev only: a bigger compiled-page buffer for the QA sandbox (qa-serve.mjs).
  onDemandEntries: onDemandEntriesFromEnv(process.env),
  // Dev only: extra hostnames (comma-separated, e.g. a LAN IP) that may load
  // dev assets, so the dev server can be opened from a phone on the network.
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(',')
    .map((h) => h.trim())
    .filter(Boolean),
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
    // The modern pdf.js build reads the global `Iterator` as soon as it loads
    // (Safari 18.4+), which crashed the whole page on older iPhones. The legacy
    // build polyfills it; react-pdf imports `pdfjs-dist` and gets it too. The
    // worker copy is the legacy one as well (scripts/copy-pdf-worker.mjs).
    cfg.resolve.alias = {
      ...cfg.resolve.alias,
      'pdfjs-dist$': require.resolve('pdfjs-dist/legacy/build/pdf.mjs'),
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
