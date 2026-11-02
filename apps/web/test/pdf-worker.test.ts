import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { describe, expect, it } from 'vitest';
import {
  cacheHeaderRules,
  PDF_WORKER_CACHE,
  pdfWorkerFile,
} from '../lib/cache-headers';
import nextConfig from '../next.config';

const require = createRequire(import.meta.url);
const pdfjsVersion = (require('pdfjs-dist/package.json') as { version: string })
  .version;

describe('pdf.js worker caching', () => {
  it('the worker file name carries the pdf.js version and the build', () => {
    // A new name for the legacy build: a phone that cached the modern worker
    // (immutable) must not keep using it.
    expect(pdfWorkerFile(pdfjsVersion)).toBe(
      `pdf.worker.${pdfjsVersion}-legacy.min.mjs`,
    );
  });

  it('the versioned worker gets a long immutable max-age', () => {
    const rules = cacheHeaderRules();
    expect(rules).toHaveLength(1);
    const [rule] = rules;
    const match = getPathMatch(rule.source, { strict: true });
    expect(match(`/${pdfWorkerFile(pdfjsVersion)}`)).not.toBe(false);
    expect(match('/pdf.worker.min.mjs')).toBe(false);
    expect(match('/other.js')).toBe(false);
    expect(match('/files/pdf.worker.1.min.mjs')).toBe(false);
    expect(rule.headers).toEqual([
      { key: 'Cache-Control', value: PDF_WORKER_CACHE },
    ]);
    expect(PDF_WORKER_CACHE).toBe('public, max-age=31536000, immutable');
  });

  it('PdfViewer loads the worker by the version of the pdf.js it runs', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../components/PdfViewer.tsx', import.meta.url)),
      'utf8',
    );
    expect(src).toContain('pdfWorkerFile(pdfjs.version)');
  });
});

// The modern pdf.js build needs the newest browsers (it reads the global
// `Iterator` as soon as it loads, which Safari has only since 18.4), so an
// older iPhone could not even load the viewer. The legacy build polyfills it.
describe('pdf.js legacy build', () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('webpack resolves pdfjs-dist (also inside react-pdf) to the legacy build', () => {
    const cfg = nextConfig.webpack?.(
      { resolve: {}, module: {} },
      // biome-ignore lint/suspicious/noExplicitAny: the context is unused
      {} as any,
    );
    expect(cfg.resolve.alias['pdfjs-dist$']).toBe(
      require.resolve('pdfjs-dist/legacy/build/pdf.mjs'),
    );
  });

  it('the copied worker is the legacy one', () => {
    expect(read('../scripts/copy-pdf-worker.mjs')).toContain(
      "require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')",
    );
  });

  it('a viewer that throws shows the preview fallback, not the error page', () => {
    const src = read('../components/FilePreview.tsx');
    expect(src).toContain('class PreviewBoundary');
    expect(src).toMatch(/<PreviewBoundary[^>]*>\s*<PdfViewer/);
  });
});
