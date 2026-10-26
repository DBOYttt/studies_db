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

const require = createRequire(import.meta.url);
const pdfjsVersion = (require('pdfjs-dist/package.json') as { version: string })
  .version;

describe('pdf.js worker caching', () => {
  it('the worker file name carries the pdf.js version', () => {
    expect(pdfWorkerFile(pdfjsVersion)).toBe(
      `pdf.worker.${pdfjsVersion}.min.mjs`,
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
