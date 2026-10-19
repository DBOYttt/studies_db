#!/usr/bin/env node
// Lists lines with Polish diacritics in the UI-facing source. The interface is
// English (docs/glossary.md); content and class-type tags stay Polish.
// Usage: node scripts/check-ui-language.mjs [paths...]   (exit 1 on any hit)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const DEFAULT_SCOPE = [
  'apps/web/app',
  'apps/web/components',
  'apps/web/lib',
  'apps/bot/src',
  'packages/db/src',
];
const EXT = /\.(ts|tsx|mjs|js|jsx)$/;
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const SKIP_LINE = /console\.|localeCompare|toLocale/;

/** Whole files that are content or data, not UI copy. */
const ALLOW_FILES = [
  /(^|\/)test\//, // test files and fixtures
  /\.test\.tsx?$/,
  /^packages\/db\/src\/cli\//, // seed and QA data
  /^packages\/db\/src\/hierarchy\.ts$/, // class-type and group tag regexes
  /^packages\/db\/src\/unitime\/classify\.ts$/, // Polish academic titles (content)
];
/** Individual lines (per file) that are content: class-type tags, folding. */
const ALLOW_LINES = [
  [/^packages\/db\/src\/constants\.ts$/, /Wykład|Ćwiczenia|Zajęcia praktyczne/],
  [/^packages\/db\/src\/search\.ts$/, /replace\(\/[łŁ]\//],
];

function* walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const n of readdirSync(p)) {
      if (n === 'node_modules' || n.startsWith('.')) continue;
      yield* walk(join(p, n));
    }
  } else if (EXT.test(p)) yield p;
}

const isComment = (t) => /^(\/\/|\*|\/\*|\{\/\*)/.test(t);

const targets = (
  process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SCOPE
).map((p) => resolve(process.cwd(), p));

let hits = 0;
for (const t of targets) {
  for (const file of walk(t)) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (ALLOW_FILES.some((re) => re.test(rel))) continue;
    const lineAllow = ALLOW_LINES.filter(([f]) => f.test(rel)).map(
      ([, l]) => l,
    );
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const text = line.trim();
        if (isComment(text) || SKIP_LINE.test(text)) return;
        // A trailing `// comment` is not UI copy.
        const code = text.replace(/\s\/\/.*$/, '');
        if (!POLISH.test(code)) return;
        if (lineAllow.some((re) => re.test(code))) return;
        hits++;
        console.log(`${rel}:${i + 1}: ${text}`);
      });
  }
}
process.exit(hits ? 1 : 0);
