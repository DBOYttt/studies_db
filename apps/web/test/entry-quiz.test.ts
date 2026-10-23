import type { ClassMark } from '@studies/db';
import { describe, expect, it } from 'vitest';
import { entryQuizView, skipDateLabel } from '../lib/entry-quiz';

const lab = {
  id: 3,
  name: 'Laboratorium',
  groups: [
    { id: 11, name: 'Gr. 1' },
    { id: 12, name: 'Gr. 2' },
  ],
};
const mark = (o: Partial<ClassMark>): ClassMark => ({
  id: 1,
  classId: 3,
  groupId: null,
  kind: 'wejsciowka',
  note: null,
  version: 0,
  skips: [],
  deletedAt: null,
  updatedByName: null,
  ...o,
});
const today = '2026-10-21';

describe('entryQuizView', () => {
  it('lists active marks, all groups first, with upcoming skipped dates', () => {
    const [c] = entryQuizView(
      [lab],
      [
        mark({ id: 2, groupId: 12, note: 'Rozdział 2', version: 3 }),
        mark({ id: 1, skips: ['2026-10-14', '2026-10-21', '2026-10-28'] }),
        mark({ id: 5, classId: 4 }),
      ],
      { isAdmin: false, today },
    );
    expect(c.marks).toEqual([
      {
        id: 1,
        version: 0,
        groupId: null,
        groupLabel: 'All groups',
        note: '',
        skips: [
          { date: '2026-10-21', label: 'Wed 21 Oct' },
          { date: '2026-10-28', label: 'Wed 28 Oct' },
        ],
      },
      {
        id: 2,
        version: 3,
        groupId: 12,
        groupLabel: 'Gr. 2',
        note: 'Rozdział 2',
        skips: [],
      },
    ]);
    expect(c.restorable).toEqual([]);
  });

  it('admins get the newest turned-off mark of each group that is off', () => {
    const off = new Date('2026-10-20T10:00:00Z');
    const [c] = entryQuizView(
      [lab],
      [
        mark({ id: 1, groupId: 11, deletedAt: off }),
        mark({ id: 4, groupId: 11, deletedAt: off }),
        mark({ id: 2, deletedAt: off }),
        mark({ id: 3 }),
      ],
      { isAdmin: true, today },
    );
    expect(c.marks.map((m) => m.id)).toEqual([3]);
    expect(c.restorable.map((m) => [m.id, m.groupLabel])).toEqual([
      [4, 'Gr. 1'],
    ]);

    const [student] = entryQuizView(
      [lab],
      [mark({ id: 4, groupId: 11, deletedAt: off })],
      { isAdmin: false, today },
    );
    expect(student.restorable).toEqual([]);
  });
});

describe('skipDateLabel', () => {
  it('formats a date key', () => {
    expect(skipDateLabel('2026-11-02')).toBe('Mon 2 Nov');
  });
});
