import { describe, expect, it } from 'vitest';
import type { PlanSession } from '../lib/plan';
import {
  dayHeader,
  formatSyncTime,
  fromWeekSession,
  sessionLinks,
  syncFailed,
  toWeekSession,
  wallLongDate,
  wallSqlText,
  wallTime,
  weekHeading,
  weekNav,
} from '../lib/plan-view';
import type { LinkContext } from '../lib/view-links';

const W = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi));

const session: PlanSession = {
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
    expect(wallSqlText('2026-10-13T08:00:00.000Z')).toBe('2026-10-13 08:00:00');
    expect(dayHeader(W(2026, 10, 13))).toEqual({
      name: 'Wtorek',
      date: '13.10',
    });
    expect(dayHeader(W(2026, 10, 18)).name).toBe('Niedziela');
    expect(wallLongDate(W(2026, 10, 13, 23, 30))).toBe(
      'wtorek, 13 października 2026',
    );
  });
  it('heads the week with its number and shown days', () => {
    expect(
      weekHeading({ year: 2026, week: 42 }, [W(2026, 10, 12), W(2026, 10, 16)]),
    ).toBe('Tydzień 42 · 12 paź – 16 paź 2026');
    expect(
      weekHeading({ year: 2026, week: 53 }, [W(2026, 12, 28), W(2027, 1, 3)]),
    ).toBe('Tydzień 53 · 28 gru 2026 – 3 sty 2027');
  });
  it('shows sync instants in Warsaw time', () => {
    // 2026-10-12 10:15 UTC = 12:15 in Warsaw (CEST).
    expect(formatSyncTime(new Date('2026-10-12T10:15:00Z'))).toContain('12:15');
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
