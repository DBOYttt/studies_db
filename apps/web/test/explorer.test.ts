import { describe, expect, it } from 'vitest';
import { explorerHref, parseExplorerParams } from '../lib/explorer';

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
