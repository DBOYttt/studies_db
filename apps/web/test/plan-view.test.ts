import { describe, expect, it } from 'vitest';
import {
  annotateWeek,
  filterMyGroups,
  type PlanBadge,
  type PlanSession,
} from '../lib/plan';
import {
  badgeLabel,
  badgeTitle,
  blockKind,
  dayHeader,
  entryQuizEditHref,
  formatSyncTime,
  fromWeekSession,
  markActionError,
  nextSessionWhat,
  SAVE_FAILED,
  sessionLinks,
  skipLabel,
  syncFailed,
  toWeekSession,
  wallLongDate,
  wallShortDate,
  wallSqlText,
  wallTime,
  weekHeading,
  weekNav,
} from '../lib/plan-view';
import type { LinkContext } from '../lib/view-links';

const W = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi));

const session: PlanSession = {
  type: 'class',
  id: 7,
  startsAt: W(2026, 10, 13, 8, 0),
  endsAt: W(2026, 10, 13, 9, 30),
  subjectId: 1,
  subjectName: 'Bazy danych',
  subjectCode: 'BD',
  classId: 2,
  classKind: 'laboratorium',
  className: 'Laboratorium',
  groupId: 3,
  groupName: 'Grupa 2',
  lecturerId: 4,
  lecturerName: 'dr Anna Nowak',
  room: 'D17 1.38',
  label: 'Bazy danych - Laboratorium',
  status: 'confirmed',
};

const ctx: LinkContext = {
  subjects: new Map([[1, 'BD']]),
  classes: new Map([[2, { code: 'BD', kind: 'laboratorium' }]]),
  groups: new Map([[3, { code: 'BD', kind: 'laboratorium', number: 2 }]]),
};

describe('sessionLinks', () => {
  it('links the group, the lecturer and the SQL console', () => {
    expect(sessionLinks(session, ctx)).toEqual({
      subject: '/subjects/BD?class=laboratorium&group=2',
      lecturer: '/lecturers/4',
      sql: `/sql?q=${encodeURIComponent('SELECT * FROM v_class_sessions WHERE id = 7')}`,
    });
  });
  it('falls back to the class, then the subject code', () => {
    expect(sessionLinks({ ...session, groupId: null }, ctx).subject).toBe(
      '/subjects/BD?class=laboratorium',
    );
    const bare = { ...session, classId: null, groupId: null, lecturerId: null };
    expect(sessionLinks(bare).subject).toBe('/subjects/BD');
    expect(sessionLinks(bare).lecturer).toBeNull();
  });
});

describe('sessionLinks (simple view)', () => {
  it('points the subject at /s/subjects with class and group, no lecturer', () => {
    const l = sessionLinks(session, ctx, true);
    expect(l.subject).toBe('/s/subjects/BD?class=laboratorium&group=2');
    expect(l.lecturer).toBeNull();
    expect(
      sessionLinks({ ...session, groupId: null, classKind: null }, ctx, true)
        .subject,
    ).toBe('/s/subjects/BD');
  });
});

describe('WeekSession round trip', () => {
  it('keeps wall dates unchanged through ISO strings', () => {
    const dto = toWeekSession(session, ctx);
    expect(dto.startsAt).toBe('2026-10-13T08:00:00.000Z');
    const back = fromWeekSession(JSON.parse(JSON.stringify(dto)));
    expect(back.startsAt.getTime()).toBe(session.startsAt.getTime());
    expect(back.endsAt.getTime()).toBe(session.endsAt.getTime());
    expect(back.links.lecturer).toBe('/lecturers/4');
  });
});

describe('weekNav', () => {
  it('builds prev / current / next links keeping extra params first', () => {
    expect(
      weekNav('/plan', { year: 2026, week: 1 }, { year: 2026, week: 42 }),
    ).toEqual({
      prev: '/plan?week=2025-W52',
      today: '/plan?week=2026-W42',
      next: '/plan?week=2026-W02',
    });
    expect(
      weekNav(
        '/subjects/BD',
        { year: 2026, week: 42 },
        { year: 2026, week: 42 },
        { tab: 'plan' },
      ).next,
    ).toBe('/subjects/BD?tab=plan&week=2026-W43');
  });
});

describe('labels', () => {
  it('formats wall time from UTC fields', () => {
    expect(wallTime(W(2026, 10, 13, 7, 5))).toBe('07:05');
    // Late evening wall time keeps its own day.
    expect(wallShortDate(W(2026, 10, 21, 23, 30))).toBe('Wed 21 Oct');
    expect(wallSqlText('2026-10-13T08:00:00.000Z')).toBe('2026-10-13 08:00:00');
    expect(dayHeader(W(2026, 10, 13))).toEqual({
      name: 'Tue',
      date: '13 Oct',
    });
    expect(dayHeader(W(2026, 10, 18)).name).toBe('Sun');
    expect(dayHeader(W(2026, 9, 15)).date).toBe('15 Sep');
    expect(wallLongDate(W(2026, 10, 13, 23, 30))).toBe(
      'Tuesday, 13 October 2026',
    );
  });
  it('heads the week with its number and shown days', () => {
    expect(
      weekHeading({ year: 2026, week: 42 }, [W(2026, 10, 12), W(2026, 10, 16)]),
    ).toBe('Week 42 · 12–16 Oct 2026');
    expect(
      weekHeading({ year: 2026, week: 53 }, [W(2026, 12, 28), W(2027, 1, 3)]),
    ).toBe('Week 53 · 28 Dec 2026 – 3 Jan 2027');
  });
  it('collapses a shared month and keeps month changes', () => {
    expect(
      weekHeading({ year: 2026, week: 43 }, [W(2026, 10, 19), W(2026, 10, 25)]),
    ).toBe('Week 43 · 19–25 Oct 2026');
    expect(
      weekHeading({ year: 2026, week: 40 }, [W(2026, 9, 28), W(2026, 10, 4)]),
    ).toBe('Week 40 · 28 Sep – 4 Oct 2026');
    expect(
      weekHeading({ year: 2026, week: 1 }, [W(2025, 12, 29), W(2026, 1, 4)]),
    ).toBe('Week 1 · 29 Dec 2025 – 4 Jan 2026');
  });
  it('shows sync instants in Warsaw time', () => {
    // 2026-10-12 10:15 UTC = 12:15 in Warsaw (CEST).
    expect(formatSyncTime(new Date('2026-10-12T10:15:00Z'))).toContain('12:15');
  });
  it('spells September "Sep" in sync times', () => {
    const s = formatSyncTime(new Date('2026-09-05T10:15:00Z'));
    expect(s).toContain('5 Sep 2026');
    expect(s).not.toContain('Sept');
  });
});

describe('syncFailed', () => {
  const t = (s: string) => new Date(s);
  it('is false without an error', () => {
    expect(
      syncFailed({ lastRunAt: null, lastOkAt: null, lastError: null }),
    ).toBe(false);
  });
  it('is true for an error newer than the last success (or no success)', () => {
    expect(
      syncFailed({
        lastRunAt: t('2026-10-12'),
        lastOkAt: null,
        lastError: 'x',
      }),
    ).toBe(true);
    expect(
      syncFailed({
        lastRunAt: t('2026-10-12T10:00Z'),
        lastOkAt: t('2026-10-12T09:00Z'),
        lastError: 'x',
      }),
    ).toBe(true);
    expect(
      syncFailed({
        lastRunAt: t('2026-10-12T09:00Z'),
        lastOkAt: t('2026-10-12T09:00Z'),
        lastError: 'x',
      }),
    ).toBe(false);
  });
});

describe('timetable badges', () => {
  const test1: PlanBadge = {
    kind: 'test',
    eventIds: [5],
    titles: ['Kolokwium 1'],
  };
  const test2: PlanBadge = {
    kind: 'test',
    eventIds: [5, 6],
    titles: ['Kolokwium 1', 'Poprawa'],
  };
  const quiz: PlanBadge = {
    kind: 'entry_quiz',
    markId: 9,
    note: 'Rozdział 3',
    allGroups: false,
  };

  it('"Not this week" says when it skips every group', () => {
    expect(skipLabel(quiz)).toBe('Not this week');
    expect(skipLabel({ ...quiz, allGroups: true })).toBe(
      'Not this week (all groups)',
    );
  });

  it('a next session line: the class and group, or "Exam"', () => {
    expect(nextSessionWhat(session)).toBe('Laboratorium, Grupa 2');
    expect(
      nextSessionWhat({ ...session, className: null, groupName: null }),
    ).toBe('Bazy danych - Laboratorium');
    expect(
      nextSessionWhat({
        ...session,
        sessionKind: 'exam',
        className: null,
        groupName: null,
        label: 'Egzamin 1',
      }),
    ).toBe('Exam');
  });

  it('labels one test, several tests and an entry quiz', () => {
    expect(badgeLabel(test1)).toBe('Test');
    expect(badgeLabel(test2)).toBe('2 tests');
    expect(badgeLabel(quiz)).toBe('Entry quiz');
  });

  it('names the tests in the accessible title', () => {
    expect(badgeTitle(test1)).toBe('Test: Kolokwium 1');
    expect(badgeTitle(test2)).toBe('2 tests: Kolokwium 1, Poprawa');
    expect(badgeTitle(quiz)).toBe('Entry quiz: Rozdział 3');
    expect(badgeTitle({ ...quiz, note: null })).toBe('Entry quiz');
  });

  it('links Edit to the entry quiz section of the subject page', () => {
    expect(entryQuizEditHref(sessionLinks(session, ctx))).toBe(
      '/subjects/BD?class=laboratorium&group=2#entry-quiz',
    );
    expect(entryQuizEditHref(sessionLinks(session, ctx, true))).toBe(
      '/s/subjects/BD?class=laboratorium&group=2#entry-quiz',
    );
  });

  it('toWeekSession carries badges, session kind and the linked event', () => {
    const dto = toWeekSession(
      {
        ...session,
        badges: [test2, quiz],
        sessionKind: 'exam',
        linkedEventId: 12,
      },
      ctx,
    );
    expect(dto.badges).toEqual([test2, quiz]);
    expect(dto.sessionKind).toBe('exam');
    expect(dto.linkedEventId).toBe(12);
    const back = fromWeekSession(JSON.parse(JSON.stringify(dto)));
    expect(back.badges).toEqual([test2, quiz]);
  });
});

describe('blockKind', () => {
  const event: PlanSession = {
    ...session,
    type: 'event',
    id: 40,
    eventKind: 'egzamin',
    eventTitle: 'Egzamin',
    allDay: false,
  };
  it('draws exam sessions and timed egzamin events as exam blocks', () => {
    expect(blockKind(session)).toBe('class');
    expect(blockKind({ ...session, sessionKind: 'exam' })).toBe('exam');
    expect(blockKind(event)).toBe('exam');
    expect(blockKind({ ...event, eventKind: 'kolokwium' })).toBe('event');
    expect(blockKind({ ...event, allDay: true })).toBe('event');
  });
});

describe('annotate, then My groups', () => {
  const g1: PlanSession = {
    ...session,
    id: 1,
    groupId: 31,
    groupName: 'Gr. 1',
  };
  const g2: PlanSession = {
    ...session,
    id: 2,
    groupId: 32,
    groupName: 'Gr. 2',
    startsAt: W(2026, 10, 13, 10, 0),
    endsAt: W(2026, 10, 13, 11, 30),
  };
  const kolokwium: PlanSession = {
    ...g1,
    type: 'event',
    id: 50,
    eventKind: 'kolokwium',
    eventTitle: 'Kolokwium gr 1',
    allDay: false,
    startsAt: W(2026, 10, 13, 8, 15),
    endsAt: W(2026, 10, 13, 9, 0),
  };

  it('hiding group 1 hides its Test badge and draws no event block', () => {
    const annotated = annotateWeek([g1, g2, kolokwium], []);
    expect(annotated.map((s) => `${s.type}:${s.id}`)).toEqual([
      'class:1',
      'class:2',
    ]);
    const shown = filterMyGroups(annotated, { '2': 32 });
    expect(shown.map((s) => s.id)).toEqual([2]);
    expect(shown.flatMap((s) => s.badges ?? [])).toEqual([]);
    const all = filterMyGroups(annotated, { '2': 31 });
    expect(all.flatMap((s) => s.badges ?? []).map(badgeLabel)).toEqual([
      'Test',
    ]);
  });

  it('a skipped date drops the Entry quiz badge on that day only', () => {
    const next = {
      ...g1,
      id: 3,
      startsAt: W(2026, 10, 20, 8, 0),
      endsAt: W(2026, 10, 20, 9, 30),
    };
    const out = annotateWeek(
      [g1, next],
      [{ id: 9, classId: 2, groupId: null, note: null, skips: ['2026-10-13'] }],
    );
    expect(out.map((s) => (s.badges ?? []).map(badgeLabel))).toEqual([
      [],
      ['Entry quiz'],
    ]);
  });
});

describe('markActionError', () => {
  it('null on success, the refusal, or "Could not save" when the call fails', async () => {
    expect(
      await markActionError(async () => ({ ok: true, message: 'ok' })),
    ).toBeNull();
    expect(
      await markActionError(async () => ({ ok: false, message: 'Nope.' })),
    ).toBe('Nope.');
    expect(
      await markActionError(async () => {
        throw new Error('network');
      }),
    ).toBe(SAVE_FAILED);
    expect(SAVE_FAILED).toBe('Could not save. Try again.');
  });
});
