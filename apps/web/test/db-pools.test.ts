import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RO_POOL_OPTIONS, RO_QUEUE_LIMIT, VIEWS_POOL_OPTIONS } from '../lib/db';
import { connectionErrorMessage } from '../lib/sql-console';
import { BUSY_ERROR, CONNECT_ERROR } from '../lib/sql-messages';

const root = join(__dirname, '..');

// Only user-supplied SQL (console, table browser filters, reports) may use
// the RO pool; fixed application queries use getViewsPool().
const ALLOWED = [
  'lib/db.ts',
  'app/api/sql/route.ts',
  'app/(app)/tables/[view]/page.tsx',
  'app/(app)/tables/[view]/csv/route.ts',
  'app/(simple)/s/reports/page.tsx',
  'app/(simple)/s/reports/csv/route.ts',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', '.next-e2e', 'test', 'e2e'].includes(name))
      continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('db pools', () => {
  it('getRoPool( is used only by the console modules', () => {
    const users = ['app', 'components', 'lib']
      .flatMap((d) => walk(join(root, d)))
      .filter((f) => readFileSync(f, 'utf8').includes('getRoPool('))
      .map((f) => relative(root, f))
      .sort();
    expect(users.filter((f) => !ALLOWED.includes(f))).toEqual([]);
  });

  it('pool sizes stay within MAX_USER_CONNECTIONS 10 with 2 spare', () => {
    expect(VIEWS_POOL_OPTIONS.connectionLimit).toBe(4);
    expect(RO_POOL_OPTIONS.connectionLimit).toBe(4);
    expect(RO_QUEUE_LIMIT).toBe(8);
  });

  it('a full pool queue maps to BUSY_ERROR', () => {
    expect(connectionErrorMessage(new Error('Queue limit reached.'))).toBe(
      BUSY_ERROR,
    );
    expect(connectionErrorMessage(new Error('boom'))).toBe(CONNECT_ERROR);
  });
});
