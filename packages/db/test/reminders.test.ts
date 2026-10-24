import { eq } from 'drizzle-orm';
import type mysql from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/client.js';
import {
  disableReminders,
  dueDigest,
  dueDms,
  dueEntryQuizzes,
  getReminderPrefs,
  markSent,
  setReminderPrefs,
} from '../src/reminders.js';
import {
  adminAudit,
  classes,
  classGroups,
  classMarkSkips,
  classMarks,
  classSessions,
  events,
  reminderLog,
  reminderPrefs,
  subjects,
  userGroups,
  users,
} from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

const W = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi));

describe('reminders', () => {
  let db: Db;
  let pool: mysql.Pool;
  const id: Record<string, number> = {};

  const user = async (name: string, banned = false) =>
    (
      await db
        .insert(users)
        .values({
          discordUserId: `d-${name}`,
          displayName: name,
          isBanned: banned,
        })
        .$returningId()
    )[0].id;
  const event = async (
    startsAt: Date,
    o: Partial<typeof events.$inferInsert> = {},
  ) =>
    (
      await db
        .insert(events)
        .values({ kind: 'kolokwium', title: 'Kolos', startsAt, ...o })
        .$returningId()
    )[0].id;

  beforeAll(async () => {
    db = await resetTestDb();
    pool = createDb(process.env.TEST_DATABASE_URL as string).pool;
    const [s] = await db
      .insert(subjects)
      .values({ code: 'BD', name: 'Bazy', semester: 1, ects: 5 })
      .$returningId();
    id.sub = s.id;
    const [c] = await db
      .insert(classes)
      .values({ subjectId: s.id, kind: 'laboratorium', name: 'Lab' })
      .$returningId();
    id.cls = c.id;
    const grp = async (n: number) =>
      (
        await db
          .insert(classGroups)
          .values({ classId: c.id, number: n, name: `Gr. ${n}` })
          .$returningId()
      )[0].id;
    id.g1 = await grp(1);
    id.g2 = await grp(2);
  });
  beforeEach(async () => {
    await db.delete(reminderLog);
    await db.delete(reminderPrefs);
    await db.delete(userGroups);
    await db.delete(events);
    await db.delete(adminAudit);
    await db.delete(users);
    id.u = await user('Ala');
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb(db);
  });

  const on = (userId = id.u, day = true, hour = true) =>
    setReminderPrefs(db, userId, { dayBefore: day, hourBefore: hour }, 'web');

  describe('prefs', () => {
    it('defaults to off, saves, audits and clears the disabled reason', async () => {
      expect(await getReminderPrefs(db, id.u)).toEqual({
        dayBefore: false,
        hourBefore: false,
        disabledReason: null,
      });
      await disableReminders(db, id.u, 'DMs closed');
      expect(await getReminderPrefs(db, id.u)).toEqual({
        dayBefore: false,
        hourBefore: false,
        disabledReason: 'DMs closed',
      });
      await setReminderPrefs(
        db,
        id.u,
        { dayBefore: true, hourBefore: false },
        'discord',
      );
      expect(await getReminderPrefs(db, id.u)).toEqual({
        dayBefore: true,
        hourBefore: false,
        disabledReason: null,
      });
      const [a] = await db
        .select()
        .from(adminAudit)
        .where(eq(adminAudit.action, 'reminders.update'));
      expect(a.userId).toBe(id.u);
      expect(a.details).toMatchObject({ source: 'discord', dayBefore: true });
    });
  });

  describe('dueDms', () => {
    const start = W(2026, 10, 20, 10);
    it('is due once at 24 h and not again after markSent', async () => {
      await on();
      const e = await event(start);
      const now = W(2026, 10, 19, 10);
      const due = await dueDms(db, pool, now);
      expect(due).toHaveLength(1);
      expect(due[0]).toMatchObject({
        userId: id.u,
        discordUserId: 'd-Ala',
        kind: 'day',
      });
      expect(due[0].event.id).toBe(e);
      await markSent(db, [
        { eventId: e, userId: id.u, kind: 'day', forStartsAt: start },
      ]);
      await markSent(db, [
        { eventId: e, userId: id.u, kind: 'day', forStartsAt: start },
      ]);
      expect(await dueDms(db, pool, now)).toEqual([]);
    });
    it('hour reminder at 1 h before', async () => {
      await on();
      await event(start);
      const due = await dueDms(db, pool, W(2026, 10, 20, 9));
      expect(due.map((d) => d.kind)).toEqual(['hour']);
    });
    it('a moved event is due again for its new time', async () => {
      await on();
      const e = await event(start);
      await markSent(db, [
        { eventId: e, userId: id.u, kind: 'day', forStartsAt: start },
      ]);
      const moved = W(2026, 10, 20, 12);
      await db.update(events).set({ startsAt: moved }).where(eq(events.id, e));
      const due = await dueDms(db, pool, W(2026, 10, 19, 12));
      expect(due).toHaveLength(1);
      expect(due[0].event.startsAt).toEqual(moved);
    });
    it('40 min late is not due, 20 min late is', async () => {
      await on();
      await event(start);
      expect(await dueDms(db, pool, W(2026, 10, 19, 10, 40))).toEqual([]);
      expect(await dueDms(db, pool, W(2026, 10, 19, 10, 20))).toHaveLength(1);
    });
    it('not due before the window', async () => {
      await on();
      await event(start);
      expect(await dueDms(db, pool, W(2026, 10, 19, 9, 59))).toEqual([]);
    });
    it('respects Moje grupy; no picks means everything', async () => {
      const other = await user('Bartek');
      await on();
      await on(other);
      await db
        .insert(userGroups)
        .values({ userId: id.u, classId: id.cls, groupId: id.g1 });
      await event(start, {
        subjectId: id.sub,
        classId: id.cls,
        groupId: id.g2,
      });
      const due = await dueDms(db, pool, W(2026, 10, 19, 10));
      expect(due.map((d) => d.userId)).toEqual([other]);
    });
    it('skips banned users and opted-out users, honours each pref', async () => {
      const banned = await user('Zban', true);
      const off = await user('Off');
      const dayOnly = await user('Dzien');
      await on(banned);
      await on(off, false, false);
      await on(dayOnly, true, false);
      await event(start);
      const day = await dueDms(db, pool, W(2026, 10, 19, 10));
      expect(day.map((d) => d.userId)).toEqual([dayOnly]);
      expect(await dueDms(db, pool, W(2026, 10, 20, 9))).toEqual([]);
    });
    it('ignores deleted events', async () => {
      await on();
      await event(start, { deletedAt: W(2026, 10, 1) });
      expect(await dueDms(db, pool, W(2026, 10, 19, 10))).toEqual([]);
    });
    it('all-day: day reminder at 18:00 the day before, no hour reminder', async () => {
      await on();
      await event(W(2026, 10, 20), { allDay: true });
      expect(await dueDms(db, pool, W(2026, 10, 19, 17, 59))).toEqual([]);
      const due = await dueDms(db, pool, W(2026, 10, 19, 18));
      expect(due.map((d) => d.kind)).toEqual(['day']);
      expect(await dueDms(db, pool, W(2026, 10, 19, 18, 40))).toEqual([]);
      expect(await dueDms(db, pool, W(2026, 10, 19, 23))).toEqual([]);
    });
  });

  describe('dueDigest', () => {
    it('is due only 18:00-18:30 and only once', async () => {
      const t = W(2026, 10, 20, 10);
      const e1 = await event(t);
      const e2 = await event(W(2026, 10, 20), { allDay: true });
      await event(W(2026, 10, 21, 10));
      expect(await dueDigest(pool, W(2026, 10, 19, 17, 59))).toEqual([]);
      expect(await dueDigest(pool, W(2026, 10, 19, 18, 30))).toEqual([]);
      const due = await dueDigest(pool, W(2026, 10, 19, 18, 5));
      expect(due.map((e) => e.id).sort()).toEqual([e1, e2].sort());
      await markSent(
        db,
        due.map((e) => ({
          eventId: e.id,
          userId: 0,
          kind: 'digest' as const,
          forStartsAt: e.startsAt,
        })),
      );
      expect(await dueDigest(pool, W(2026, 10, 19, 18, 10))).toEqual([]);
    });

    it('returns only events without a digest row for their start', async () => {
      const e1 = await event(W(2026, 10, 20, 10));
      const due = await dueDigest(pool, W(2026, 10, 19, 18, 5));
      await markSent(
        db,
        due.map((e) => ({
          eventId: e.id,
          userId: 0,
          kind: 'digest' as const,
          forStartsAt: e.startsAt,
        })),
      );
      const e2 = await event(W(2026, 10, 20, 12));
      const again = await dueDigest(pool, W(2026, 10, 19, 18, 10));
      expect(again.map((e) => e.id)).toEqual([e2]);
      expect(e1).not.toBe(e2);
    });
  });

  describe('dueEntryQuizzes', () => {
    let n = 0;
    const session = (
      start: Date,
      o: Partial<typeof classSessions.$inferInsert> = {},
    ) =>
      db.insert(classSessions).values({
        uid: `q${++n}`,
        occurrenceStart: start,
        startsAt: start,
        endsAt: new Date(start.getTime() + 90 * 60_000),
        label: 'L',
        subjectId: id.sub,
        classId: id.cls,
        groupId: id.g1,
        ...o,
      });
    const mark = async (groupId: number | null, deleted = false) =>
      (
        await db
          .insert(classMarks)
          .values({
            classId: id.cls,
            groupId,
            kind: 'wejsciowka',
            deletedAt: deleted ? new Date() : null,
          })
          .$returningId()
      )[0].id;
    beforeEach(async () => {
      await db.delete(classMarks);
      await db.delete(classSessions);
    });

    it("lists tomorrow's marked sessions, 18:00-18:30 only", async () => {
      await session(W(2026, 10, 20, 8));
      await session(W(2026, 10, 20, 10), { groupId: id.g2 });
      await session(W(2026, 10, 21, 8));
      await mark(id.g1);
      expect(await dueEntryQuizzes(pool, W(2026, 10, 19, 17, 59))).toEqual([]);
      expect(await dueEntryQuizzes(pool, W(2026, 10, 19, 18, 30))).toEqual([]);
      expect(await dueEntryQuizzes(pool, W(2026, 10, 19, 18, 5))).toEqual([
        { subjectName: 'Bazy', className: 'Lab', groupName: 'Gr. 1' },
      ]);
    });

    it('an all-groups mark lists each group once; cancelled, exam, skipped and deleted are left out', async () => {
      await session(W(2026, 10, 20, 8));
      await session(W(2026, 10, 20, 12));
      await session(W(2026, 10, 20, 10), { groupId: id.g2 });
      await session(W(2026, 10, 20, 14), {
        groupId: id.g2,
        status: 'cancelled',
      });
      const m = await mark(null);
      await mark(id.g2, true);
      expect(await dueEntryQuizzes(pool, W(2026, 10, 19, 18, 5))).toEqual([
        { subjectName: 'Bazy', className: 'Lab', groupName: 'Gr. 1' },
        { subjectName: 'Bazy', className: 'Lab', groupName: 'Gr. 2' },
      ]);
      await db
        .insert(classMarkSkips)
        .values({ markId: m, onDate: '2026-10-20' });
      expect(await dueEntryQuizzes(pool, W(2026, 10, 19, 18, 5))).toEqual([]);
      await db.delete(classMarkSkips);
      await db.delete(classSessions);
      await session(W(2026, 10, 20, 8), { kind: 'exam' });
      expect(await dueEntryQuizzes(pool, W(2026, 10, 19, 18, 5))).toEqual([]);
    });
  });
});
