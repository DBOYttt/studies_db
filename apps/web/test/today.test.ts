import {
  classes,
  classGroups,
  classSessions,
  type Db,
  setMyGroup,
  subjects,
  users,
} from '@studies/db';
import { toWall } from '@studies/db/plan';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RO_POOL_OPTIONS } from '../lib/db';
import { loadMyGroups } from '../lib/my-groups-load';
import { filterMyGroups } from '../lib/plan';
import { listFrom, todayForUser, wallDay } from '../lib/today';

/** Wall Date: UTC fields equal the Warsaw wall clock. */
const W = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi));

let db: Db;
let ro: mysql.Pool;
const id: Record<string, number> = {};
let n = 0;

async function mkSession(
  key: string,
  start: Date,
  o: {
    classId?: number | null;
    groupId?: number | null;
    status?: 'confirmed' | 'cancelled';
  } = {},
) {
  n++;
  const [r] = await db
    .insert(classSessions)
    .values({
      uid: `today${n}`,
      occurrenceStart: start,
      startsAt: start,
      endsAt: new Date(start.getTime() + 45 * 60_000),
      label: key,
      subjectId: id.fiz,
      classId: o.classId ?? null,
      groupId: o.groupId ?? null,
      room: `s${n}`,
      status: o.status ?? 'confirmed',
    })
    .$returningId();
  id[key] = r.id;
}

beforeAll(async () => {
  db = await resetTestDb();
  ro = mysql.createPool({
    ...RO_POOL_OPTIONS,
    uri: testRoUrl(),
    connectionLimit: 2,
  });
  id.fiz = (
    await db
      .insert(subjects)
      .values({ name: 'Fizyka', code: 'FIZ', semester: 1, ects: 5 })
      .$returningId()
  )[0].id;
  id.lec = (
    await db
      .insert(classes)
      .values({ subjectId: id.fiz, kind: 'wyklad', name: 'Wykład' })
      .$returningId()
  )[0].id;
  id.ex = (
    await db
      .insert(classes)
      .values({ subjectId: id.fiz, kind: 'cwiczenia', name: 'Ćwiczenia' })
      .$returningId()
  )[0].id;
  const mkGroup = async (number: number) =>
    (
      await db
        .insert(classGroups)
        .values({ classId: id.ex, number, name: `Gr. ${number}` })
        .$returningId()
    )[0].id;
  id.g1 = await mkGroup(1);
  id.g2 = await mkGroup(2);
  const mkUser = async (d: string) =>
    (
      await db
        .insert(users)
        .values({ discordUserId: d, displayName: d })
        .$returningId()
    )[0].id;
  id.picked = await mkUser('today-picked');
  id.none = await mkUser('today-none');
  await setMyGroup(db, id.picked, id.ex, id.g1);

  // DST ends in Warsaw on Sun 25.10.2026 (03:00 CEST -> 02:00 CET).
  await mkSession('late24', W(2026, 10, 24, 23, 0), { classId: id.lec });
  await mkSession('c2', W(2026, 10, 25, 10, 0), {
    classId: id.ex,
    groupId: id.g2,
  });
  await mkSession('c1', W(2026, 10, 25, 10, 0), {
    classId: id.ex,
    groupId: id.g1,
  });
  await mkSession('mid25', W(2026, 10, 25, 0, 0), { classId: id.lec });
  await mkSession('mid26', W(2026, 10, 26, 0, 0), { classId: id.lec });
  await mkSession('cancel27', W(2026, 10, 27, 9, 0), {
    classId: id.lec,
    status: 'cancelled',
  });
  await mkSession('next2', W(2026, 10, 28, 8, 0), {
    classId: id.ex,
    groupId: id.g2,
  });
  await mkSession('next1', W(2026, 10, 29, 8, 0), {
    classId: id.ex,
    groupId: id.g1,
  });
});

afterAll(async () => {
  await ro?.end();
  await closeTestDb(db);
});

const ids = (s: { id: number }[]) => s.map((x) => x.id);

describe('wallDay', () => {
  it('is the Warsaw day of the instant, across the DST change', () => {
    // 00:30 CEST on 25.10 is still 22:30 UTC on 24.10.
    expect(wallDay(new Date('2026-10-24T22:30:00Z'))).toEqual({
      start: W(2026, 10, 25),
      end: W(2026, 10, 26),
    });
    expect(wallDay(new Date('2026-10-24T21:59:59Z')).start).toEqual(
      W(2026, 10, 24),
    );
    // After the change Warsaw is UTC+1: 23:30 UTC is already 00:30 on 26.10.
    expect(wallDay(new Date('2026-10-25T22:59:59Z')).start).toEqual(
      W(2026, 10, 25),
    );
    expect(wallDay(new Date('2026-10-25T23:30:00Z')).start).toEqual(
      W(2026, 10, 26),
    );
    // Spring forward (29.03.2026): 00:30 CET is 23:30 UTC the day before.
    expect(wallDay(new Date('2026-03-28T23:30:00Z')).start).toEqual(
      W(2026, 3, 29),
    );
  });
});

describe('todayForUser', () => {
  it('lists the Warsaw day in time order, all groups without My groups', async () => {
    const t = await todayForUser(
      db,
      ro,
      id.none,
      new Date('2026-10-24T22:30:00Z'),
    );
    expect(t.day).toEqual(W(2026, 10, 25));
    expect(ids(t.sessions)).toEqual([id.mid25, id.c2, id.c1]);
    expect(t.groupsPicked).toBe(false);
    expect(t.next).toBeNull();
  });

  it('keeps only the picked group with My groups', async () => {
    const t = await todayForUser(
      db,
      ro,
      id.picked,
      new Date('2026-10-25T12:00:00Z'),
    );
    expect(ids(t.sessions)).toEqual([id.mid25, id.c1]);
    expect(t.groupsPicked).toBe(true);
  });

  it('uses the Warsaw midnight bounds on both sides of the day', async () => {
    const before = await todayForUser(
      db,
      ro,
      id.none,
      new Date('2026-10-24T21:59:59Z'),
    );
    expect(ids(before.sessions)).toEqual([id.late24]);
    const last = await todayForUser(
      db,
      ro,
      id.none,
      new Date('2026-10-25T22:59:59Z'),
    );
    expect(ids(last.sessions)).toEqual([id.mid25, id.c2, id.c1]);
    const after = await todayForUser(
      db,
      ro,
      id.none,
      new Date('2026-10-25T23:30:00Z'),
    );
    expect(ids(after.sessions)).toEqual([id.mid26]);
  });

  it('gives the next confirmed class of My groups when today has none', async () => {
    const now = new Date('2026-10-27T08:00:00Z');
    const none = await todayForUser(db, ro, id.none, now);
    // A cancelled class is shown, but it is not a class to go to.
    expect(ids(none.sessions)).toEqual([id.cancel27]);
    expect(none.next?.id).toBe(id.next2);
    const picked = await todayForUser(db, ro, id.picked, now);
    expect(picked.next?.id).toBe(id.next1);
  });

  it('has no next class when nothing is scheduled any more', async () => {
    const t = await todayForUser(
      db,
      ro,
      id.none,
      new Date('2027-01-10T10:00:00Z'),
    );
    expect(t.sessions).toEqual([]);
    expect(t.next).toBeNull();
  });

  it('does not look up a next class on a day with classes', async () => {
    const t = await todayForUser(
      db,
      ro,
      id.picked,
      new Date('2026-10-26T10:00:00Z'),
    );
    expect(ids(t.sessions)).toEqual([id.mid26]);
    expect(t.next).toBeNull();
  });
});

describe('todayForUser with a semester', () => {
  it("keeps only the semester's sessions, today and next", async () => {
    const [{ id: sem3 }] = await db
      .insert(subjects)
      .values({ name: 'Optyka', code: 'OPT', semester: 3, ects: 2 })
      .$returningId();
    const mk = async (uid: string, start: Date) =>
      (
        await db
          .insert(classSessions)
          .values({
            uid,
            occurrenceStart: start,
            startsAt: start,
            endsAt: new Date(start.getTime() + 45 * 60_000),
            label: uid,
            subjectId: sem3,
            status: 'confirmed',
          })
          .$returningId()
      )[0].id;
    const today3 = await mk('sem3-today', W(2026, 10, 25, 11, 0));
    const next3 = await mk('sem3-next', W(2026, 10, 30, 9, 0));
    try {
      const day = new Date('2026-10-25T12:00:00Z');
      const s3 = await todayForUser(db, ro, id.none, day, { semester: 3 });
      expect(ids(s3.sessions)).toEqual([today3]);
      const s1 = await todayForUser(db, ro, id.none, day, { semester: 1 });
      expect(ids(s1.sessions)).toEqual([id.mid25, id.c2, id.c1]);
      const all = await todayForUser(db, ro, id.none, day);
      expect(ids(all.sessions)).toEqual([id.mid25, id.c2, id.c1, today3]);

      const later = new Date('2026-10-27T08:00:00Z');
      const n3 = await todayForUser(db, ro, id.none, later, { semester: 3 });
      expect(n3.sessions).toEqual([]);
      expect(n3.next?.id).toBe(next3);
      const n1 = await todayForUser(db, ro, id.none, later, { semester: 1 });
      expect(n1.next?.id).toBe(id.next2);
    } finally {
      await db.delete(classSessions).where(eq(classSessions.subjectId, sem3));
      await db.delete(subjects).where(eq(subjects.id, sem3));
    }
  });
});

describe('listFrom', () => {
  it('starts the List at today 00:00 Warsaw unless past is asked for', () => {
    const now = new Date('2026-10-24T22:30:00Z');
    expect(listFrom({}, now)).toEqual(W(2026, 10, 25));
    expect(listFrom({ past: '0' }, now)).toEqual(W(2026, 10, 25));
    expect(listFrom({ past: '1' }, now)).toBeNull();
    expect(listFrom({ past: ['1', '1'] }, now)).toEqual(W(2026, 10, 25));
  });
});

describe('next class behind many hidden sessions', () => {
  beforeAll(async () => {
    // 2027-03: 250 Gr. 2 sessions (hidden for the Gr. 1 pick), then Gr. 1.
    const rows = Array.from({ length: 250 }, (_, i) => {
      const start = W(2027, 3, 1, 8, 0);
      start.setUTCMinutes(i * 60);
      return {
        uid: `hidden${i}`,
        occurrenceStart: start,
        startsAt: start,
        endsAt: new Date(start.getTime() + 30 * 60_000),
        label: `hidden${i}`,
        subjectId: id.fiz,
        classId: id.ex,
        groupId: id.g2,
        status: 'confirmed' as const,
      };
    });
    await db.insert(classSessions).values(rows);
    await mkSession('farG1', W(2027, 4, 1, 9, 0), {
      classId: id.ex,
      groupId: id.g1,
    });
  });

  it('still finds the next class of My groups', async () => {
    const now = new Date('2027-02-20T10:00:00Z');
    const picked = await todayForUser(db, ro, id.picked, now);
    expect(picked.next?.id).toBe(id.farG1);
    const none = await todayForUser(db, ro, id.none, now);
    expect(none.next?.label).toBe('hidden0');
  });

  it('applies the same rule as filterMyGroups', async () => {
    const mine = await loadMyGroups(db, ro, id.picked);
    // Every session from the first DST-test day on, filtered in JS.
    const [all] = await ro.query<mysql.RowDataPacket[]>(
      `SELECT id, class_id, group_id, starts_at FROM v_class_sessions
        WHERE status = 'confirmed' ORDER BY starts_at, ends_at, id`,
    );
    const sessions = all.map((r) => ({
      id: Number(r.id),
      classId: r.class_id == null ? null : Number(r.class_id),
      groupId: r.group_id == null ? null : Number(r.group_id),
      startsAt: toWall(r.starts_at),
    }));
    for (const day of [
      '2026-10-23T10:00:00Z',
      '2026-10-27T10:00:00Z',
      '2027-02-20T10:00:00Z',
    ]) {
      const t = await todayForUser(db, ro, id.picked, new Date(day), {
        mine: Promise.resolve(mine),
      });
      const from = wallDay(new Date(day)).end;
      const expected = filterMyGroups(
        sessions.filter((x) => x.startsAt >= from) as never,
        mine,
      )[0] as { id: number } | undefined;
      expect(t.next?.id ?? null).toBe(expected?.id ?? null);
    }
  });
});
