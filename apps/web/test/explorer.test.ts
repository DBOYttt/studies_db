import { describe, expect, it } from 'vitest';
import {
  explorerHref,
  parseExplorerFilters,
  parseExplorerPaging,
  parseExplorerParams,
  subjectTabHref,
  withResolvedSelection,
} from '../lib/explorer';

describe('parseExplorerParams', () => {
  it('defaults', () => {
    expect(parseExplorerParams({})).toEqual({
      classKind: null,
      group: null,
      topic: null,
      file: null,
      tab: 'explorer',
    });
  });
  it('parses valid values', () => {
    expect(
      parseExplorerParams({
        class: 'cwiczenia',
        group: '2',
        topic: '7',
        file: '9',
        tab: 'map',
      }),
    ).toEqual({
      classKind: 'cwiczenia',
      group: 2,
      topic: 7,
      file: 9,
      tab: 'map',
    });
    expect(parseExplorerParams({ class: 'none' }).classKind).toBe('none');
  });
  it('ignores junk', () => {
    expect(
      parseExplorerParams({
        class: 'foo',
        group: 'abc',
        topic: '0',
        file: '-1',
        tab: 'zzz',
      }),
    ).toEqual({
      classKind: null,
      group: null,
      topic: null,
      file: null,
      tab: 'explorer',
    });
    expect(
      parseExplorerParams({ class: ['wyklad'], group: ['1', '2'] }),
    ).toMatchObject({ classKind: null, group: null });
    expect(
      parseExplorerParams({ group: '1e3', file: '99999999999' }),
    ).toMatchObject({ group: null, file: null });
  });
});

describe('explorerHref', () => {
  it('omits null and default params, stable order', () => {
    expect(explorerHref('A B', {})).toBe('/subjects/A%20B');
    expect(
      explorerHref('FIZ', {
        tab: 'schema',
        file: 5,
        topic: 3,
        group: 2,
        classKind: 'wyklad',
      }),
    ).toBe('/subjects/FIZ?class=wyklad&group=2&topic=3&file=5&tab=schema');
    expect(explorerHref('FIZ', { classKind: null, tab: 'explorer' })).toBe(
      '/subjects/FIZ',
    );
  });
  it('round-trips', () => {
    const p = {
      classKind: 'none' as const,
      group: null,
      topic: 4,
      file: 8,
      tab: 'map' as const,
    };
    const qs = explorerHref('X', p).split('?')[1];
    const sp = Object.fromEntries(new URLSearchParams(qs));
    expect(parseExplorerParams(sp)).toEqual(p);
  });
});

describe('parseExplorerFilters', () => {
  it('defaults', () => {
    expect(parseExplorerFilters({})).toEqual({
      tag: null,
      q: '',
      sort: null,
      dir: null,
    });
  });
  it('parses valid values', () => {
    expect(
      parseExplorerFilters({
        tag: '4',
        q: '  tarcie ',
        sort: 'uploader',
        dir: 'desc',
      }),
    ).toEqual({ tag: 4, q: 'tarcie', sort: 'uploader', dir: 'desc' });
  });
  it('whitelists sort and dir at runtime', () => {
    expect(
      parseExplorerFilters({ sort: 'constructor', dir: 'sideways', tag: 'x' }),
    ).toEqual({ tag: null, q: '', sort: null, dir: null });
    expect(parseExplorerFilters({ sort: '__proto__' }).sort).toBeNull();
    expect(parseExplorerFilters({ sort: ['topic'] }).sort).toBeNull();
  });
  it('caps q length', () => {
    expect(parseExplorerFilters({ q: 'a'.repeat(500) }).q).toHaveLength(100);
  });
});

describe('explorerHref with filters', () => {
  it('appends tag, q, sort, dir in stable order after tab', () => {
    expect(
      explorerHref(
        'FIZ',
        { classKind: 'wyklad', file: 5 },
        { dir: 'desc', sort: 'topic', q: 'a b', tag: 3 },
      ),
    ).toBe('/subjects/FIZ?class=wyklad&file=5&tag=3&q=a+b&sort=topic&dir=desc');
  });
  it('omits empty filters', () => {
    expect(
      explorerHref('FIZ', {}, { tag: null, q: '', sort: null, dir: null }),
    ).toBe('/subjects/FIZ');
  });
  it('round-trips filters', () => {
    const f = {
      tag: 2,
      q: 'x&y',
      sort: 'created' as const,
      dir: 'asc' as const,
    };
    const qs = explorerHref('X', {}, f).split('?')[1];
    expect(
      parseExplorerFilters(Object.fromEntries(new URLSearchParams(qs))),
    ).toEqual(f);
  });
});

describe('parseExplorerPaging', () => {
  it('defaults and whitelists per', () => {
    expect(parseExplorerPaging({})).toEqual({ page: 1, perPage: 25 });
    expect(parseExplorerPaging({ page: '3', per: '50' })).toEqual({
      page: 3,
      perPage: 50,
    });
    expect(parseExplorerPaging({ page: '0', per: '7' })).toEqual({
      page: 1,
      perPage: 25,
    });
  });
  it('parses subject tabs', () => {
    expect(parseExplorerParams({ tab: 'lecturers' }).tab).toBe('lecturers');
    expect(parseExplorerParams({ tab: 'sql' }).tab).toBe('sql');
    expect(parseExplorerParams({ tab: 'plan' }).tab).toBe('plan');
    expect(parseExplorerParams({ tab: 'bogus' }).tab).toBe('explorer');
  });
});

describe('subjectTabHref', () => {
  const sel = { classKind: 'laboratorium' as const, group: 3, topic: null };
  const filters = {
    tag: 7,
    q: 'lab',
    sort: 'filename' as const,
    dir: 'asc' as const,
  };

  it('keeps the selection and the Pliki filters on the other tabs', () => {
    expect(subjectTabHref('MECH', sel, filters, 'explorer')).toBe(
      '/subjects/MECH?class=laboratorium&group=3&tag=7&q=lab&sort=filename&dir=asc',
    );
    expect(subjectTabHref('MECH', sel, filters, 'map')).toBe(
      '/subjects/MECH?class=laboratorium&group=3&tab=map&tag=7&q=lab&sort=filename&dir=asc',
    );
    expect(subjectTabHref('MECH', sel, filters, 'lecturers')).toContain(
      'tab=lecturers',
    );
    expect(subjectTabHref('MECH', sel, filters, 'schema')).toContain(
      'tab=schema',
    );
    expect(subjectTabHref('MECH', sel, filters, 'plan')).toBe(
      '/subjects/MECH?class=laboratorium&group=3&tab=plan&tag=7&q=lab&sort=filename&dir=asc',
    );
  });

  it('never carries the filename filter q (or other filters) to the SQL tab', () => {
    const href = subjectTabHref('MECH', sel, filters, 'sql');
    expect(href).toBe('/subjects/MECH?class=laboratorium&group=3&tab=sql');
    expect(new URL(href, 'http://x').searchParams.has('q')).toBe(false);
  });

  it('keeps the topic and drops a selected file', () => {
    expect(
      subjectTabHref(
        'FIZ',
        { classKind: 'none', group: null, topic: 5 },
        { tag: null, q: '', sort: null, dir: null },
        'sql',
      ),
    ).toBe('/subjects/FIZ?class=none&topic=5&tab=sql');
  });
});

describe('withResolvedSelection', () => {
  const sel = { classKind: 'cwiczenia' as const, group: 3, topic: 7 };
  it('adds the resolved class/group and keeps other params', () => {
    const q = withResolvedSelection({ topic: '7', tag: '2', file: '9' }, sel);
    expect(q?.get('class')).toBe('cwiczenia');
    expect(q?.get('group')).toBe('3');
    expect(q?.get('topic')).toBe('7');
    expect(q?.get('tag')).toBe('2');
    expect(q?.get('file')).toBe('9');
  });
  it('is null when nothing to add', () => {
    expect(
      withResolvedSelection(
        { topic: '7', class: 'cwiczenia', group: '3' },
        sel,
      ),
    ).toBeNull();
    expect(withResolvedSelection({}, { ...sel, topic: null })).toBeNull();
  });
  it('drops a stale group', () => {
    const q = withResolvedSelection(
      { topic: '7', class: 'wyklad', group: '2' },
      { classKind: 'wyklad', group: null, topic: 7 },
    );
    expect(q?.get('class')).toBe('wyklad');
    expect(q?.has('group')).toBe(false);
  });
});
