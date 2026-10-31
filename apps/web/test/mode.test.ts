import { describe, expect, it } from 'vitest';
import { EXAMPLE_QUERIES } from '@/lib/example-queries';
import { modeTarget, parseMode, safeNext } from '@/lib/mode';
import { sqlHref } from '@/lib/sql-editor';

describe('parseMode', () => {
  it('defaults to simple', () => {
    expect(parseMode(undefined)).toBe('simple');
    expect(parseMode('x')).toBe('simple');
    expect(parseMode('')).toBe('simple');
  });
  it('accepts advanced', () => {
    expect(parseMode('advanced')).toBe('advanced');
    expect(parseMode('simple')).toBe('simple');
  });
});

describe('safeNext', () => {
  it('accepts same-origin relative paths', () => {
    expect(safeNext('/s/subjects/PJP?class=wyklad')).toBe(
      '/s/subjects/PJP?class=wyklad',
    );
    expect(safeNext('/')).toBe('/');
  });
  it.each([
    '//evil.com',
    '/\\evil.com',
    'https://evil.com',
    'evil',
    '/%0d%0aX',
    '/a\r\nb',
    '/a\tb',
    '',
    '%2F%2Fevil',
  ])('rejects %j', (v) => {
    expect(safeNext(v)).toBeNull();
  });
  // Each normalises to the scheme-relative `//evil.com`.
  const DOT_SEGMENTS = [
    '/.//evil.com',
    '/..//evil.com',
    '/%2e//evil.com',
    '/a/..//evil.com',
    '/./\\evil.com',
    '/s/..//evil.com',
    '/s/.%2E/x',
    '/s/%2e%2e/plan',
    '/s/plan/.',
    '/s\\plan',
  ];
  it.each(DOT_SEGMENTS)('rejects the dot-segment or backslash path %j', (v) => {
    expect(safeNext(v)).toBeNull();
  });
  it('keeps dots inside names and backslashes in the query', () => {
    expect(safeNext('/s/subjects/a.b')).toBe('/s/subjects/a.b');
    expect(safeNext('/s/search?q=..%5C..')).toBe('/s/search?q=..%5C..');
    expect(safeNext('/search?q=a\\b')).toBe('/search?q=a\\b');
  });
  it.each(DOT_SEGMENTS)('modeTarget never passes %j on', (v) => {
    for (const to of ['simple', 'advanced'] as const) {
      const out = modeTarget(to, v);
      expect(out === '/' || out === '/s', `${to}: ${out}`).toBe(true);
    }
  });
  it('rejects null/undefined', () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });
});

describe('modeTarget simple -> advanced', () => {
  const t = (n: string | null) => modeTarget('advanced', n);
  it('maps paths', () => {
    expect(t('/s')).toBe('/');
    expect(t(null)).toBe('/');
    expect(t('/s/subjects/PJP?class=wyklad&group=3&tag=5&file=9')).toBe(
      '/subjects/PJP?class=wyklad&group=3',
    );
    expect(t('/s/subjects/PJP?tag=5')).toBe('/subjects/PJP');
    expect(t('/s/plan?week=2026-10-12')).toBe('/plan?week=2026-10-12');
    expect(t('/s/plan')).toBe('/plan');
    expect(t('/s/search?q=abc%20d')).toBe('/search?q=abc+d');
    expect(t('/s/search')).toBe('/search');
    expect(t('/s/other')).toBe('/');
  });
  it('keeps the place when already in advanced mode', () => {
    expect(t('/zzz')).toBe('/zzz');
    expect(t('/sql?q=SELECT%201')).toBe('/sql?q=SELECT%201');
    expect(t('/search?q=abc')).toBe('/search?q=abc');
  });
  it('never passes unsafe paths through', () => {
    expect(t('/%2F%2Fevil.com')).toBe('/');
    expect(t('//evil.com')).toBe('/');
  });
  it('keeps admin pages in advanced mode', () => {
    expect(t('/admin')).toBe('/admin');
    expect(t('/admin/sql')).toBe('/admin/sql');
    expect(t('/admin/audit?user=3&page=2')).toBe('/admin/audit?user=3&page=2');
  });
  it('maps reports to SQL console', () => {
    expect(t('/s/reports?r=1')).toBe(sqlHref('/sql', EXAMPLE_QUERIES[1].sql));
  });
  it('out of range / bad report index -> /', () => {
    expect(t(`/s/reports?r=${EXAMPLE_QUERIES.length}`)).toBe('/');
    expect(t('/s/reports?r=-1')).toBe('/');
    expect(t('/s/reports?r=abc')).toBe('/');
    expect(t('/s/reports')).toBe('/');
  });
  it('encodes unknown code chars', () => {
    expect(t('/s/subjects/A%20B%2FC?class=x')).toBe(
      '/subjects/A%20B%2FC?class=x',
    );
  });
});

describe('modeTarget advanced -> simple', () => {
  const t = (n: string | null) => modeTarget('simple', n);
  it('maps paths', () => {
    expect(t('/')).toBe('/s');
    expect(t(null)).toBe('/s');
    expect(t('/subjects/PJP?class=wyklad&group=3&tab=files&preview=4')).toBe(
      '/s/subjects/PJP?class=wyklad&group=3',
    );
    expect(t('/subjects/PJP')).toBe('/s/subjects/PJP');
    expect(t('/plan?week=2026-10-12')).toBe('/s/plan?week=2026-10-12');
    expect(t('/search?q=abc')).toBe('/s/search?q=abc');
    expect(t('/sql?q=SELECT')).toBe('/s');
    expect(t('/tables/v_tags')).toBe('/s');
  });
  it('sends admin pages to the simple start (no simple admin pages)', () => {
    expect(t('/admin')).toBe('/s');
    expect(t('/admin/audit')).toBe('/s');
    expect(t('/admin/audit/7')).toBe('/s');
    expect(t('/admin/sql?q=x')).toBe('/s');
  });
  it('keeps the place when already in simple mode', () => {
    expect(t('/s')).toBe('/s');
    expect(t('/s/subjects/PJP?tag=5&file=9')).toBe(
      '/s/subjects/PJP?tag=5&file=9',
    );
    expect(t('/s/reports?r=2')).toBe('/s/reports?r=2');
    expect(t('/s?file=3')).toBe('/s?file=3');
  });
  it('never passes unsafe paths through', () => {
    expect(t('/%5Cevil.com')).toBe('/s');
    expect(t('/s/%2F%2Fx')).toBe('/s/%2F%2Fx');
    expect(t('//evil.com')).toBe('/s');
  });
  it('encodes unknown code chars', () => {
    expect(t('/subjects/A%20B%2FC')).toBe('/s/subjects/A%20B%2FC');
  });
});

describe('modeTarget event pages', () => {
  it('maps between /s/wydarzenia and /wydarzenia', () => {
    expect(modeTarget('advanced', '/s/wydarzenia/nowe')).toBe(
      '/wydarzenia/nowe',
    );
    expect(modeTarget('advanced', '/s/wydarzenia/12')).toBe('/wydarzenia/12');
    expect(modeTarget('advanced', '/s/wydarzenia/12/edytuj')).toBe(
      '/wydarzenia/12/edytuj',
    );
    expect(modeTarget('simple', '/wydarzenia/12')).toBe('/s/wydarzenia/12');
    expect(modeTarget('simple', '/wydarzenia/nowe')).toBe('/s/wydarzenia/nowe');
    expect(modeTarget('simple', '/wydarzenia/12/edytuj')).toBe(
      '/s/wydarzenia/12/edytuj',
    );
  });
  it('maps the events index with its page', () => {
    expect(modeTarget('advanced', '/s/wydarzenia')).toBe('/wydarzenia');
    expect(modeTarget('simple', '/wydarzenia')).toBe('/s/wydarzenia');
    expect(modeTarget('advanced', '/s/wydarzenia?page=3&x=1')).toBe(
      '/wydarzenia?page=3',
    );
    expect(modeTarget('simple', '/wydarzenia?page=2')).toBe(
      '/s/wydarzenia?page=2',
    );
  });
  it('falls back for unknown event paths', () => {
    expect(modeTarget('advanced', '/s/wydarzenia/x/y')).toBe('/');
    expect(modeTarget('simple', '/wydarzenia/abc')).toBe('/s');
  });
});

describe('modeTarget keeps a valid sem on every target', () => {
  it('keeps sem on the start-page fallbacks', () => {
    expect(modeTarget('advanced', '/s?sem=2')).toBe('/?sem=2');
    expect(modeTarget('advanced', '/s/recent?sem=all')).toBe('/?sem=all');
    expect(modeTarget('simple', '/?sem=5')).toBe('/s?sem=5');
    expect(modeTarget('simple', '/admin/sync?sem=3')).toBe('/s?sem=3');
    expect(modeTarget('advanced', '/s/wydarzenia/x/y?sem=4')).toBe('/?sem=4');
  });
  it('keeps sem on event pages', () => {
    expect(modeTarget('advanced', '/s/wydarzenia/12?sem=3')).toBe(
      '/wydarzenia/12?sem=3',
    );
    expect(modeTarget('simple', '/wydarzenia/nowe?sem=7')).toBe(
      '/s/wydarzenia/nowe?sem=7',
    );
  });
  it('drops an invalid sem', () => {
    expect(modeTarget('advanced', '/s?sem=8')).toBe('/');
    expect(modeTarget('simple', '/?sem=1%0a')).toBe('/s');
  });
});
