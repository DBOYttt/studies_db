import { describe, expect, it } from 'vitest';
import {
  chipHref,
  fileIcon,
  formatGroupNumbers,
  groupLecturers,
  highlightParts,
  parseFileParam,
  parsePageParam,
  parseSearchQuery,
  parseSimpleFilters,
  REPORT_LABELS,
  REPORT_META,
  statusBadge,
  withParam,
} from '../lib/simple';

describe('highlightParts', () => {
  it('folds case, accents and ł', () => {
    expect(highlightParts('Wykład ŁÓDŹ', 'lodz')).toEqual([
      { t: 'Wykład ', hit: false },
      { t: 'ŁÓDŹ', hit: true },
    ]);
  });
  it('treats regex metacharacters literally', () => {
    expect(highlightParts('a(b)a', '(b')).toEqual([
      { t: 'a', hit: false },
      { t: '(b', hit: true },
      { t: ')a', hit: false },
    ]);
    for (const q of ['[', '\\', '*', '%', '_', '(', '.*'])
      expect(() => highlightParts('x[y]\\*', q)).not.toThrow();
  });
  it('marks every occurrence', () => {
    expect(highlightParts('abab', 'ab').map((p) => [p.t, p.hit])).toEqual([
      ['ab', true],
      ['ab', true],
    ]);
  });
  it('returns one plain part without a match or with an empty query', () => {
    expect(highlightParts('abc', 'zzz')).toEqual([{ t: 'abc', hit: false }]);
    expect(highlightParts('abc', '')).toEqual([{ t: 'abc', hit: false }]);
    expect(highlightParts('abc', '  ')).toEqual([{ t: 'abc', hit: false }]);
  });
});

describe('static maps', () => {
  it('has three reports and the column labels', () => {
    expect(REPORT_META.map((r) => r.icon)).toEqual(['Books', 'Medal', 'Exam']);
    expect(REPORT_LABELS.liczba_plikow).toBe('Files');
    expect(REPORT_LABELS.created_at).toBe('Added');
  });
  it('fileIcon and statusBadge', () => {
    expect(
      fileIcon({ mimeType: 'application/pdf', filename: 'a.pdf' }),
    ).toEqual({ icon: 'FilePdf', tone: 'red' });
    expect(fileIcon({ mimeType: 'image/png', filename: 'a.png' }).icon).toBe(
      'FileImage',
    );
    expect(fileIcon({ mimeType: 'text/plain', filename: 'a.txt' })).toEqual({
      icon: 'FileText',
      tone: 'accent',
    });
    expect(fileIcon({ mimeType: 'text/x-python', filename: 'a.py' }).icon).toBe(
      'FileCode',
    );
    expect(
      fileIcon({
        mimeType: 'application/octet-stream',
        filename: 'x.zip',
        previewKind: 'none',
      }),
    ).toEqual({ icon: 'File', tone: 'muted' });
    // a Word file rendered to PDF for preview is still a Word file
    expect(
      fileIcon({
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'notatki.docx',
        previewKind: 'pdf',
      }),
    ).toEqual({ icon: 'FileDoc', tone: 'accent' });
    expect(
      fileIcon({ mimeType: 'application/octet-stream', filename: 'S.PPTX' }),
    ).toEqual({ icon: 'FilePpt', tone: 'warn' });
    expect(fileIcon({ filename: 'dane.xlsx', previewKind: 'pdf' })).toEqual({
      icon: 'FileXls',
      tone: 'green',
    });
    expect(fileIcon({ filename: 'a.odt' }).icon).toBe('FileDoc');
    expect(statusBadge('ready')).toBeNull();
    expect(statusBadge('pending')).toEqual({
      label: 'Processing…',
      tone: 'warn',
    });
    expect(statusBadge('failed')).toEqual({
      label: 'Preview unavailable',
      tone: 'err',
    });
  });
});

describe('parseSimpleFilters', () => {
  const kinds = ['wyklad', 'cwiczenia'] as const;
  // group numbers per kind (not ids)
  const groups = { wyklad: [], cwiczenia: [1, 2] };
  const k = [...kinds];
  it('accepts valid values', () => {
    expect(
      parseSimpleFilters(
        { class: 'cwiczenia', group: '1', tag: '9' },
        k,
        groups,
        [9],
      ),
    ).toEqual({ kind: 'cwiczenia', group: 1, tag: 9 });
  });
  it('drops unknown kind, foreign group and foreign tag', () => {
    expect(
      parseSimpleFilters(
        { class: 'lab', group: '1', tag: '3' },
        k,
        groups,
        [9],
      ),
    ).toEqual({ kind: null, group: null, tag: null });
    expect(
      parseSimpleFilters({ class: 'wyklad', group: '1' }, k, groups, []),
    ).toEqual({ kind: 'wyklad', group: null, tag: null });
    expect(parseSimpleFilters({ group: '1' }, k, groups, []).group).toBeNull();
  });
  it('ignores junk and arrays', () => {
    expect(
      parseSimpleFilters(
        { class: ['cwiczenia', 'x'], group: ['2'], tag: 'abc' },
        k,
        groups,
        [9],
      ),
    ).toEqual({ kind: 'cwiczenia', group: 2, tag: null });
    expect(
      parseSimpleFilters({ class: 'cwiczenia', group: '1.5' }, k, groups, [])
        .group,
    ).toBeNull();
  });
});

describe('simple page params', () => {
  it('parses ?file= as a positive id only', () => {
    expect(parseFileParam({ file: '42' })).toBe(42);
    expect(parseFileParam({ file: ['7', '8'] })).toBe(7);
    for (const v of ['0', '-1', 'abc', '1.5', '', undefined])
      expect(parseFileParam({ file: v })).toBeNull();
  });
  it('clamps ?page= to 1..max', () => {
    expect(parsePageParam({}, 5)).toBe(1);
    expect(parsePageParam({ page: 'x' }, 5)).toBe(1);
    expect(parsePageParam({ page: '3' }, 5)).toBe(3);
    expect(parsePageParam({ page: '99' }, 5)).toBe(5);
    expect(parsePageParam({ page: '2' }, 0)).toBe(1);
  });
  it('appends a param with the right separator', () => {
    expect(withParam('/s', 'file', 3)).toBe('/s?file=3');
    expect(withParam('/s/recent?page=2', 'file', 3)).toBe(
      '/s/recent?page=2&file=3',
    );
  });
});

describe('chipHref', () => {
  const cur = { kind: 'cwiczenia', group: 2, tag: 5 } as const;
  it('builds the subject URL with class, group and tag in that order', () => {
    expect(chipHref('PJP', cur, {})).toBe(
      '/s/subjects/PJP?class=cwiczenia&group=2&tag=5',
    );
    expect(chipHref('PJP', { kind: null, group: null, tag: null }, {})).toBe(
      '/s/subjects/PJP',
    );
  });
  it('drops the group when the kind changes', () => {
    expect(chipHref('PJP', cur, { kind: 'wyklad' })).toBe(
      '/s/subjects/PJP?class=wyklad&tag=5',
    );
    expect(chipHref('PJP', cur, { kind: null })).toBe('/s/subjects/PJP?tag=5');
  });
  it('keeps the group when the same kind is chosen again', () => {
    expect(chipHref('PJP', cur, { kind: 'cwiczenia' })).toBe(
      '/s/subjects/PJP?class=cwiczenia&group=2&tag=5',
    );
  });
  it('"Wszystkie" (null) removes the param, others replace it', () => {
    expect(chipHref('PJP', cur, { group: null })).toBe(
      '/s/subjects/PJP?class=cwiczenia&tag=5',
    );
    expect(chipHref('PJP', cur, { tag: null })).toBe(
      '/s/subjects/PJP?class=cwiczenia&group=2',
    );
    expect(chipHref('PJP', cur, { group: 3, tag: 9 })).toBe(
      '/s/subjects/PJP?class=cwiczenia&group=3&tag=9',
    );
  });
  it('encodes the subject code', () => {
    expect(chipHref('A B/ż', { kind: null, group: null, tag: null }, {})).toBe(
      '/s/subjects/A%20B%2F%C5%BC',
    );
  });
});

describe('parseSearchQuery', () => {
  it('trims, takes the first value and caps at 200 chars', () => {
    expect(parseSearchQuery({ q: '  sieci ' })).toBe('sieci');
    expect(parseSearchQuery({ q: ['a', 'b'] })).toBe('a');
    expect(parseSearchQuery({ q: '   ' })).toBe('');
    expect(parseSearchQuery({})).toBe('');
    expect(parseSearchQuery({ q: 'x'.repeat(250) })).toHaveLength(200);
  });
});

describe('formatGroupNumbers', () => {
  it('compresses consecutive runs into ranges', () => {
    expect(formatGroupNumbers([1, 2, 3, 4, 5, 6, 7, 8])).toBe('Gr. 1–8');
    expect(formatGroupNumbers([5, 1, 3, 2])).toBe('Gr. 1–3, 5');
    expect(formatGroupNumbers([2])).toBe('Gr. 2');
    expect(formatGroupNumbers([1, 2, 4, 5, 7])).toBe('Gr. 1, 2, 4, 5, 7');
    expect(formatGroupNumbers([3, 3, 1, 2, 2])).toBe('Gr. 1–3');
    expect(formatGroupNumbers([1, 3, 4, 5, 9])).toBe('Gr. 1, 3–5, 9');
  });
});

describe('groupLecturers', () => {
  const base = {
    title: 'dr',
    email: 'x@agh.edu.pl',
    officeHours: null,
    room: null,
    groupName: null,
  };
  const row = (
    id: number,
    name: string,
    kind: 'wyklad' | 'laboratorium' | 'cwiczenia',
    className: string,
    groupNumber: number | null,
  ) => ({ ...base, id, name, kind, className, groupNumber });

  it('merges one card per lecturer with a line per class in kind order', () => {
    const got = groupLecturers([
      row(7, 'P. Malinowski', 'laboratorium', 'Laboratorium', 3),
      row(7, 'P. Malinowski', 'laboratorium', 'Laboratorium', 1),
      row(7, 'P. Malinowski', 'laboratorium', 'Laboratorium', 2),
      row(4, 'W. Bauer', 'wyklad', 'Wykład', 1),
      row(7, 'P. Malinowski', 'wyklad', 'Wykład', null),
    ]);
    expect(got.map((l) => l.id)).toEqual([7, 4]);
    expect(got[0]).toMatchObject({
      id: 7,
      name: 'dr P. Malinowski',
      email: 'x@agh.edu.pl',
      classes: [
        { kind: 'wyklad', label: 'Wykład · all groups' },
        { kind: 'laboratorium', label: 'Laboratorium · Gr. 1–3' },
      ],
    });
    expect(got[1].classes).toEqual([
      { kind: 'wyklad', label: 'Wykład · Gr. 1' },
    ]);
  });

  it('a whole-class assignment wins over group rows of that class', () => {
    const got = groupLecturers([
      row(1, 'A. Nowak', 'cwiczenia', 'Ćwiczenia', 2),
      row(1, 'A. Nowak', 'cwiczenia', 'Ćwiczenia', null),
      row(1, 'A. Nowak', 'cwiczenia', 'Ćwiczenia', 4),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0].classes).toEqual([
      { kind: 'cwiczenia', label: 'Ćwiczenia · all groups' },
    ]);
  });

  it('keeps contact fields and drops an empty title', () => {
    const [l] = groupLecturers([
      {
        ...row(2, 'J. Kowal', 'wyklad', 'Wykład', null),
        title: null,
        email: null,
        officeHours: 'wt 10-11',
        room: 'D-10 205',
      },
    ]);
    expect(l).toEqual({
      id: 2,
      name: 'J. Kowal',
      email: null,
      officeHours: 'wt 10-11',
      room: 'D-10 205',
      classes: [{ kind: 'wyklad', label: 'Wykład · all groups' }],
    });
  });
});
