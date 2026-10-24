import {
  classes,
  classGroups,
  classSessions,
  type Db,
  subjects,
} from '@studies/db';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RO_POOL_OPTIONS } from '../lib/db';
import {
  getSessionOption,
  sessionFormFields,
  upcomingSessionOptions,
} from '../lib/session-options';

/** Wall Date: UTC fields equal the Warsaw wall clock. */
const W = (m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(2026, m - 1, d, h, mi));

let db: Db;
let ro: mysql.Pool;
const id: Record<string, number> = {};
let n = 0;

async function mkSession(
  key: string,
  start: Date,
  end: Date,
  o: {
    classId: number | null;
    groupId?: number | null;
    room?: string | null;
    status?: 'confirmed' | 'cancelled';
    kind?: 'class' | 'exam';
  },
) {
  n++;
  const [r] = await db
    .insert(classSessions)
    .values({
      uid: `so${n}`,
      occurrenceStart: start,
      startsAt: start,
      endsAt: end,
      label: key,
      subjectId: id.sub,
      classId: o.classId,
      groupId: o.groupId ?? null,
      room: o.room === undefined ? 'B-2 202' : o.room,
      status: o.status ?? 'confirmed',
      kind: o.kind ?? 'class',
    })
    .$returningId();
  id[key] = r.id;
}

beforeAll(async () => {
  db = await resetTestDb();
  ro = mysql.createPool({
    ...RO_POOL_OPTIONS,
    uri: testRoUrl(),
    connectionLimit: 3,
  });
  id.sub = (
    await db
      .insert(subjects)
      .values({ name: 'Fizyka', code: 'FIZ', semester: 1, ects: 5 })
      .$returningId()
  )[0].id;
  const mkClass = async (kind: 'laboratorium' | 'wyklad', name: string) =>
    (
      await db
        .insert(classes)
        .values({ subjectId: id.sub, kind, name })
        .$returningId()
    )[0].id;
  id.lab = await mkClass('laboratorium', 'Laboratorium');
  id.lec = await mkClass('wyklad', 'Wykład');
  const mkGroup = async (number: number) =>
    (
      await db
        .insert(classGroups)
        .values({ classId: id.lab, number, name: `Gr. ${number}` })
        .$returningId()
    )[0].id;
  id.g1 = await mkGroup(1);
  id.g2 = await mkGroup(2);

  // Wed 21 Oct 2026 is the first upcoming lab session of Gr. 1.
  await mkSession('past', W(10, 14, 10), W(10, 14, 11, 30), {
    classId: id.lab,
    groupId: id.g1,
  });
  await mkSession('sG1', W(10, 21, 10), W(10, 21, 11, 30), {
    classId: id.lab,
    groupId: id.g1,
  });
  await mkSession('cancelled', W(10, 22, 10), W(10, 22, 11, 30), {
    classId: id.lab,
    groupId: id.g1,
    status: 'cancelled',
  });
  await mkSession('exam', W(10, 23, 9), W(10, 23, 11), {
    classId: id.lab,
    groupId: id.g1,
    kind: 'exam',
  });
  await mkSession('sG2', W(10, 22, 12), W(10, 22, 13, 30), {
    classId: id.lab,
    groupId: id.g2,
    room: 'B-2 203',
  });
  await mkSession('whole', W(10, 26, 8), W(10, 26, 9, 30), {
    classId: id.lab,
    room: null,
  });
  await mkSession('lecture', W(10, 21, 8), W(10, 21, 9, 30), {
    classId: id.lec,
  });
  await mkSession('sG1later', W(10, 28, 10), W(10, 28, 11, 30), {
    classId: id.lab,
    groupId: id.g1,
  });
});

afterAll(async () => {
  await ro.end();
  await closeTestDb(db);
});

const FROM = W(10, 21, 0);

describe('upcomingSessionOptions', () => {
  it('lists the confirmed class sessions of the group (and the whole class) after fromWall', async () => {
    const opts = await upcomingSessionOptions(ro, id.lab, id.g1, FROM);
    expect(opts.map((o) => Number(o.value))).toEqual([
      id.sG1,
      id.whole,
      id.sG1later,
    ]);
    expect(opts[0]).toEqual({
      value: String(id.sG1),
      label: 'Wed 21 Oct, 10:00–11:30 · B-2 202',
      date: '2026-10-21',
      from: '10:00',
      to: '11:30',
      room: 'B-2 202',
    });
    // No room: no trailing separator.
    expect(opts[1].label).toBe('Mon 26 Oct, 08:00–09:30');
    expect(opts[1].room).toBeNull();
  });

  it('every group of the class when no group is given, with the group name', async () => {
    const opts = await upcomingSessionOptions(ro, id.lab, null, FROM);
    expect(opts.map((o) => Number(o.value))).toEqual([
      id.sG1,
      id.sG2,
      id.whole,
      id.sG1later,
    ]);
    expect(opts[1].label).toBe('Thu 22 Oct, 12:00–13:30 · B-2 203 · Gr. 2');
  });

  it('respects the limit', async () => {
    const opts = await upcomingSessionOptions(ro, id.lab, null, FROM, 2);
    expect(opts.map((o) => Number(o.value))).toEqual([id.sG1, id.sG2]);
  });

  it('starts at fromWall (a session starting then is included)', async () => {
    const opts = await upcomingSessionOptions(ro, id.lab, id.g1, W(10, 21, 10));
    expect(Number(opts[0].value)).toBe(id.sG1);
  });
});

describe('getSessionOption', () => {
  it('returns a confirmed class session with its class and group', async () => {
    const s = await getSessionOption(ro, id.past);
    expect(s).toEqual({
      value: String(id.past),
      label: 'Wed 14 Oct, 10:00–11:30 · B-2 202',
      date: '2026-10-14',
      from: '10:00',
      to: '11:30',
      room: 'B-2 202',
      subjectId: id.sub,
      classId: id.lab,
      groupId: id.g1,
    });
  });

  it('null for a cancelled, an exam or a missing session', async () => {
    expect(await getSessionOption(ro, id.cancelled)).toBeNull();
    expect(await getSessionOption(ro, id.exam)).toBeNull();
    expect(await getSessionOption(ro, 999_999)).toBeNull();
  });
});

describe('sessionFormFields', () => {
  it('fills date, times and place; no room empties the place', () => {
    const o = { date: '2026-10-21', from: '10:00', to: '11:30' };
    expect(sessionFormFields({ ...o, room: 'B-2 202' })).toEqual({
      date: '2026-10-21',
      start: '10:00',
      end: '11:30',
      place: 'B-2 202',
    });
    expect(sessionFormFields({ ...o, room: null }).place).toBe('');
  });
});
