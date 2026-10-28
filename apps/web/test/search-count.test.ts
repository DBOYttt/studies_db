import { describe, expect, it } from 'vitest';
import { searchCountText } from '../lib/search-count';
import { advancedSearchHref } from '../lib/simple';

describe('searchCountText', () => {
  it('states files and topics, the same in both modes', () => {
    expect(searchCountText(4, 1)).toBe('4 files, 1 topic');
    expect(searchCountText(1, 0)).toBe('1 file, 0 topics');
    expect(searchCountText(0, 2)).toBe('0 files, 2 topics');
  });
  it('says when the list stops at the cap', () => {
    expect(searchCountText(100, 3, 100)).toBe(
      '100 files, 3 topics (the first 100 results; there may be more)',
    );
    expect(searchCountText(60, 40, 100)).toBe(
      '60 files, 40 topics (the first 100 results; there may be more)',
    );
  });
});

describe('advancedSearchHref', () => {
  it('switches to Advanced on the same search', () => {
    expect(advancedSearchHref('kolokwium 1')).toBe(
      '/mode?to=advanced&next=%2Fsearch%3Fq%3Dkolokwium%25201',
    );
  });
});
