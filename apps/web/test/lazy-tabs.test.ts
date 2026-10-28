import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CodeMirror (SqlConsole), React Flow + dagre (DataMap) and the schema
// designer are heavy client bundles. Pages that show them on one tab only
// must load them through components/lazy-tabs.tsx (next/dynamic), or every
// tab of the route ships them in its first load (perf audit H1).
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const HEAVY = [
  '@/components/SqlConsole',
  '@/components/explorer/DataMap',
  '@/components/DesignerDiagram',
];

describe('tabbed pages load heavy client components lazily', () => {
  for (const page of [
    'app/(app)/subjects/[code]/page.tsx',
    'app/(app)/tables/[view]/page.tsx',
  ]) {
    it(`${page} has no static import of a heavy component`, () => {
      const src = read(page);
      for (const mod of HEAVY) {
        expect(src).not.toContain(`from '${mod}'`);
      }
      expect(src).toContain("from '@/components/lazy-tabs'");
    });
  }

  it('lazy-tabs is a client module that uses next/dynamic', () => {
    const src = read('components/lazy-tabs.tsx');
    expect(src.startsWith("'use client';")).toBe(true);
    expect(src).toContain("from 'next/dynamic'");
    for (const mod of HEAVY) {
      expect(src).not.toMatch(new RegExp(`^import .* from '${mod}'`, 'm'));
      expect(src).toContain(`import('${mod}')`);
    }
  });
});
