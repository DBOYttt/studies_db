import { describe, expect, it } from 'vitest';
import { searchCounts, searchCountText } from '../lib/search-count';
import { advancedSearchHref } from '../lib/simple';

describe('searchCounts', () => {
  it('counts each shown file once and topic-only hits as topics', () => {
    expect(
      searchCounts([
        { materialId: 1, topicId: 10 },
        { materialId: 2, topicId: 10 },
        { materialId: 1, topicId: 10 },
        { materialId: null, topicId: 10 },
        { materialId: null, topicId: 11 },
        { materialId: null, topicId: 11 },
      ]),
    ).toEqual({ files: 2, topics: 2 });
    expect(searchCounts([])).toEqual({ files: 0, topics: 0 });
  });
  it('gives both modes the same count for the same shown files', () => {
    // Advanced passes search hits, simple its file list (id as materialId).
    const advanced = [
      { materialId: 7, topicId: 1 },
      { materialId: 9, topicId: 2 },
      { materialId: null, topicId: 3 },
    ];
    const simple = [7, 9].map((id) => ({ materialId: id, topicId: 0 }));
    expect(searchCounts(advanced).files).toBe(searchCounts(simple).files);
  });
});

describe('searchCountText', () => {
  it('states files and topics, the same in both modes', () => {
    expect(searchCountText(4, 1)).toBe('4 files, 1 topic');
    expect(searchCountText(1, 0)).toBe('1 file, 0 topics');
    expect(searchCountText(0, 2)).toBe('0 files, 2 topics');
  });
  it('leaves the topics out when they are not listed', () => {
    expect(searchCountText(4)).toBe('4 files');
    expect(searchCountText(1)).toBe('1 file');
    expect(searchCountText(100, undefined, 100)).toBe(
      '100 files (the first 100 results; there may be more)',
    );
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
