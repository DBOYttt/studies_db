// pdf.js worker is served as a static file: next.config sets
// `module.parser.javascript.url = false` (needed for packages/db), which also
// disables webpack's `new URL('pdfjs-dist/...', import.meta.url)` handling.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = createRequire(join(root, 'package.json')).resolve(
  'pdfjs-dist/build/pdf.worker.min.mjs',
);
mkdirSync(join(root, 'public'), { recursive: true });
copyFileSync(src, join(root, 'public', 'pdf.worker.min.mjs'));
