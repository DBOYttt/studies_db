import { describe, expect, it } from 'vitest';
import { parsePreviewId, previewColumn, toCells } from '../lib/cells';

describe('previewColumn', () => {
  it('maps the file views only', () => {
    expect(previewColumn('v_materials')).toBe('id');
    expect(previewColumn('v_files')).toBe('material_id');
    expect(previewColumn('v_subjects')).toBeNull();
    expect(previewColumn('v_topics')).toBeNull();
  });
});

describe('toCells', () => {
  it('without a view behaves as before', () => {
    expect(toCells([[1, 'a', null, { x: 1 }]])).toEqual([
      [1, 'a', null, '{"x":1}'],
    ]);
  });
  it('marks id and filename cells in v_files', () => {
    const cols = ['material_id', 'topic_id', 'filename'];
    expect(
      toCells([[7, 3, 'a.pdf']], { view: 'v_files', columns: cols }),
    ).toEqual([[{ text: '7', preview: 7 }, 3, { text: 'a.pdf', preview: 7 }]]);
  });
  it('marks id and original_filename in v_materials', () => {
    const cols = ['id', 'topic_id', 'original_filename'];
    expect(
      toCells([[5, 3, 'b.pdf']], { view: 'v_materials', columns: cols }),
    ).toEqual([[{ text: '5', preview: 5 }, 3, { text: 'b.pdf', preview: 5 }]]);
  });
  it('leaves other views untouched', () => {
    expect(
      toCells([[1, 'x']], { view: 'v_subjects', columns: ['id', 'filename'] }),
    ).toEqual([[1, 'x']]);
  });
  it('does not mark when the id is not a positive integer', () => {
    const cols = ['id', 'original_filename'];
    expect(
      toCells(
        [
          [null, 'a'],
          [0, 'b'],
          ['x', 'c'],
        ],
        {
          view: 'v_materials',
          columns: cols,
        },
      ),
    ).toEqual([
      [null, 'a'],
      [0, 'b'],
      ['x', 'c'],
    ]);
  });
  it('keeps a null filename as NULL', () => {
    expect(
      toCells([[5, null]], {
        view: 'v_materials',
        columns: ['id', 'original_filename'],
      }),
    ).toEqual([[{ text: '5', preview: 5 }, null]]);
  });
});

describe('parsePreviewId', () => {
  it('accepts positive integers only', () => {
    expect(parsePreviewId('12')).toBe(12);
    for (const bad of [
      undefined,
      '',
      '0',
      '-1',
      '1.5',
      'abc',
      '1e3',
      '12x',
      ' 3',
    ]) {
      expect(parsePreviewId(bad), String(bad)).toBeNull();
    }
    expect(parsePreviewId(['4', '5'])).toBe(4);
    expect(parsePreviewId('99999999999999999999')).toBeNull();
  });
  it('keeps preview cells and links other references', () => {
    const links = {
      subjects: new Map(),
      classes: new Map(),
      groups: new Map(),
    };
    const cols = ['material_id', 'filename'];
    expect(
      toCells([[3, 'a.pdf']], { view: 'v_files', columns: cols, links }),
    ).toEqual([
      [
        { text: '3', preview: 3 },
        { text: 'a.pdf', preview: 3 },
      ],
    ]);
    expect(
      toCells([[4, 'Ann']], {
        view: 'v_users',
        columns: ['id', 'display_name'],
        links,
      }),
    ).toEqual([
      [
        { text: '4', href: '/users/4' },
        { text: 'Ann', href: '/users/4' },
      ],
    ]);
  });
});
