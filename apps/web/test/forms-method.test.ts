import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
// Its GET fallback is intended (see the header comment of the file).
const EXEMPT = new Set(['components/ViewSearchForm.tsx']);

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Opening `<form …>` tags: ends at the first `>` outside braces/quotes. */
function formTags(src: string): string[] {
  const tags: string[] = [];
  const re = /<form(?=[\s>])/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + 5;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || (depth > 0 && (c === "'" || c === '`'))) {
        quote = c;
      } else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    tags.push(src.slice(m.index, i + 1));
    m = re.exec(src);
  }
  return tags;
}

describe('client-handled forms', () => {
  it('post instead of falling back to GET before hydration', () => {
    const bad: string[] = [];
    for (const dir of ['components', 'app']) {
      for (const file of tsxFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (EXEMPT.has(rel)) continue;
        for (const tag of formTags(readFileSync(file, 'utf8'))) {
          if (/\bonSubmit=/.test(tag) && !/\bmethod="post"/.test(tag))
            bad.push(rel);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
