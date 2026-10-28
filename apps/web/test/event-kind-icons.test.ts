import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT_KIND_KEYS } from '@studies/db/constants';
import { describe, expect, it } from 'vitest';
import { EVENT_KIND_ICONS } from '../lib/event-kind-icons';

const web = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('event kind icons', () => {
  it('gives every kind its own icon', () => {
    const icons = EVENT_KIND_KEYS.map((k) => EVENT_KIND_ICONS[k]);
    for (const [i, icon] of icons.entries())
      expect(icon, EVENT_KIND_KEYS[i]).toBeTruthy();
    expect(new Set(icons).size).toBe(EVENT_KIND_KEYS.length);
  });

  it('leaves the emoji symbols to Discord', () => {
    const hits = ['components', 'app'].flatMap((d) =>
      sources(join(web, d)).filter((f) =>
        /\.symbol\b/.test(readFileSync(f, 'utf8')),
      ),
    );
    expect(hits).toEqual([]);
  });
});
