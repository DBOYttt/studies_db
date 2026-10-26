/**
 * Cache headers for static files in `public/` (next.config.ts `headers()`).
 * Next serves `public/` with `max-age=0`; the pdf.js worker (1.3 MB) carries
 * its version in the file name (scripts/copy-pdf-worker.mjs), so a browser
 * may keep it until pdf.js is upgraded.
 */
export const PDF_WORKER_CACHE = 'public, max-age=31536000, immutable';

/** `public/` file name of the pdf.js worker for that pdf.js version. */
export const pdfWorkerFile = (version: string) =>
  `pdf.worker.${version}.min.mjs`;

export function cacheHeaderRules(): {
  source: string;
  headers: { key: string; value: string }[];
}[] {
  return [
    {
      source: '/:file(pdf\\.worker\\.[0-9A-Za-z.-]+\\.min\\.mjs)',
      headers: [{ key: 'Cache-Control', value: PDF_WORKER_CACHE }],
    },
  ];
}
