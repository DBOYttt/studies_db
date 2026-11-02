// pdf.js worker is served as a static file: next.config sets
// `module.parser.javascript.url = false` (needed for packages/db), which also
// disables webpack's `new URL('pdfjs-dist/...', import.meta.url)` handling.
// It is the legacy build, like the pdf.js that next.config aliases (older
// Safari lacks APIs the modern build uses).
// The copy is named after the pdf.js version (pdf.worker.<version>-legacy.min.mjs,
// see lib/cache-headers.ts) so browsers can cache it as immutable; copies of
// other versions are removed.
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const src = require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
const { version } = JSON.parse(
  readFileSync(require.resolve('pdfjs-dist/package.json'), 'utf8'),
);
const name = `pdf.worker.${version}-legacy.min.mjs`;
const pub = join(root, 'public');
mkdirSync(pub, { recursive: true });
for (const f of readdirSync(pub)) {
  if (/^pdf\.worker\..*mjs$/.test(f) && f !== name) rmSync(join(pub, f));
}
copyFileSync(src, join(pub, name));
