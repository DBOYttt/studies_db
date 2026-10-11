import { describe, expect, it } from 'vitest';
import {
  explorerHref,
  parseExplorerFilters,
  parseExplorerPaging,
  parseExplorerParams,
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
    expect(parseExplorerParams({ tab: 'bogus' }).tab).toBe('explorer');
  });
});
