import { readFileSync } from 'node:fs';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import {
  classes,
  classGroups,
  classLecturers,
  classSessions,
  lecturers,
  subjects,
} from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';
import { expandOccurrences, parseIcs } from '../src/unitime/ics.js';
import {
  getPlanSyncStatus,
  recordPlanSync,
  requestPlanSync,
} from '../src/unitime/status.js';
import { syncTimetable } from '../src/unitime/sync.js';

const FIXTURE = readFileSync(
  new URL('./fixtures/unitime.ics', import.meta.url),
  'utf8',
);

function occurrences(text: string, uid?: string): number {
  return parseIcs(text)
    .events.filter((e) => uid === undefined || e.uid === uid)
    .reduce((n, e) => n + expandOccurrences(e).length, 0);
}

/** Applies `fn` to the VEVENT block with the given UID (null removes it). */
function editEvent(
  text: string,
  uid: string,
  fn: (block: string) => string | null,
): string {
  const re = /BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT\r?\n/g;
  let hit = false;
  const out = text.replace(re, (block) => {
    if (!new RegExp(`^UID:${uid}\\r?$`, 'm').test(block)) return block;
    hit = true;
    return fn(block) ?? '';
  });
  if (!hit) throw new Error(`no event ${uid}`);
  return out;
}

async function count(db: Db, table: MySqlTable): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(table);
  return Number(row?.n ?? 0);
}

async function snapshot(db: Db) {
  return {
    subjects: await db.select().from(subjects).orderBy(asc(subjects.id)),
    lecturers: await db.select().from(lecturers).orderBy(asc(lecturers.id)),
    classes: await db.select().from(classes).orderBy(asc(classes.id)),
    groups: await db.select().from(classGroups).orderBy(asc(classGroups.id)),
    classLecturers: await db
      .select()
      .from(classLecturers)
      .orderBy(asc(classLecturers.id)),
    sessions: await db
      .select()
      .from(classSessions)
      .orderBy(asc(classSessions.id)),
  };
}

const SUBJECT_COUNT = new Set(parseIcs(FIXTURE).events.map((e) => e.summary))
  .size;
const SESSION_COUNT = occurrences(FIXTURE);

describe('syncTimetable on the fixture', () => {
  let db: Db;
  beforeAll(async () => {
    db = await resetTestDb();
  });
  afterAll(async () => {
    await closeTestDb(db);
  });

  it('first run creates subjects, sessions, groups and assignments', async () => {
    const stats = await syncTimetable(db, FIXTURE);
    expect(stats.created).toBe(SESSION_COUNT);
    expect(stats.updated).toBe(0);
    expect(stats.deleted).toBe(0);
    expect(stats.unchanged).toBe(0);
    expect(await count(db, subjects)).toBe(SUBJECT_COUNT);
    expect(await count(db, classSessions)).toBe(SESSION_COUNT);

    const s = await snapshot(db);
    for (const subj of s.subjects) {
      expect(subj.discordChannelId).toBeNull();
      expect(subj.ects).toBe(0);
      expect(subj.semester).toBe(1);
    }
    const algebra = s.subjects.find(
      (x) => x.unitimeName === 'Algebra liniowa (1rok)',
    );
    expect(algebra).toMatchObject({ name: 'Algebra liniowa', code: 'AL' });

    const groupNames = s.groups.map((g) => g.name);
    for (const n of ['K-127', 'M-128', 'M-129', 'M-130'])
      expect(groupNames).toContain(n);

    const [wfLecturer] = await db
      .select()
      .from(lecturers)
      .where(eq(lecturers.email, 'lecturer11@example.edu'));
    expect(wfLecturer).toBeDefined();
    const wfAssignments = s.classLecturers.filter(
      (cl) => cl.lecturerId === wfLecturer?.id,
    );
    expect(wfAssignments).toHaveLength(4);
    for (const a of wfAssignments) expect(a.groupId).not.toBeNull();

    const [cancelled] = await db
      .select()
      .from(classSessions)
      .where(eq(classSessions.uid, '900000001'));
    expect(cancelled?.status).toBe('cancelled');

    const [unknown] = await db
      .select()
      .from(classSessions)
      .where(eq(classSessions.uid, '900000002'));
    expect(unknown?.classId).toBeNull();
    expect(unknown?.groupId).toBeNull();
    expect(unknown?.label).toBe('Konsultacje 1');
    expect(stats.warnings).toEqual(['Nieznany typ zajęć: Konsultacje 1']);

    // Lecturer e-mails are stored lower-cased; titles parsed.
    const [piek] = await db
      .select()
      .from(lecturers)
      .where(eq(lecturers.email, 'lecturer1@example.edu'));
    expect(piek).toMatchObject({ name: 'J. Piekło', title: 'dr hab. inż.' });

    // Wall times round-trip unchanged.
    const [one] = await db
      .select()
      .from(classSessions)
      .where(eq(classSessions.uid, '2145955391'));
    expect(one?.startsAt.toISOString()).toBe('2026-10-06T16:45:00.000Z');
    expect(one?.endsAt.toISOString()).toBe('2026-10-06T18:15:00.000Z');
  });

  it('second run on the same feed changes nothing', async () => {
    const before = await snapshot(db);
    const stats = await syncTimetable(db, FIXTURE);
    expect(stats).toMatchObject({
      created: 0,
      updated: 0,
      deleted: 0,
      unchanged: SESSION_COUNT,
    });
    expect(await snapshot(db)).toEqual(before);
  });

  it('applies an edited feed: changed, removed and cancelled events', async () => {
    const subjectsBefore = await count(db, subjects);
    const lecturersBefore = await count(db, lecturers);
    let edited = editEvent(FIXTURE, '2145947913', (b) =>
      b.replace(/^LOCATION:.*$/m, 'LOCATION:D-1 999'),
    );
    edited = editEvent(edited, '2145955391', () => null);
    edited = editEvent(edited, '2145954910', (b) =>
      b.replace(/^STATUS:CONFIRMED/m, 'STATUS:CANCELLED'),
    );
    const changed =
      occurrences(FIXTURE, '2145947913') + occurrences(FIXTURE, '2145954910');
    const removed = occurrences(FIXTURE, '2145955391');

    const stats = await syncTimetable(db, edited);
    expect(stats.created).toBe(0);
    expect(stats.updated).toBe(changed);
    expect(stats.deleted).toBe(removed);
    expect(stats.unchanged).toBe(SESSION_COUNT - changed - removed);
    expect(await count(db, subjects)).toBe(subjectsBefore);
    expect(await count(db, lecturers)).toBe(lecturersBefore);
    expect(await count(db, classSessions)).toBe(SESSION_COUNT - removed);

    const moved = await db
      .select()
      .from(classSessions)
      .where(eq(classSessions.uid, '2145947913'));
    expect(moved.length).toBeGreaterThan(1);
    for (const m of moved) expect(m.room).toBe('D-1 999');
    const [c] = await db
      .select()
      .from(classSessions)
      .where(eq(classSessions.uid, '2145954910'));
    expect(c?.status).toBe('cancelled');

    // And running the edited feed again is a no-op.
    const again = await syncTimetable(db, edited);
    expect(again).toMatchObject({ created: 0, updated: 0, deleted: 0 });
  });

  it('garbage input throws and leaves the DB unchanged', async () => {
    const before = await snapshot(db);
    await expect(syncTimetable(db, 'not a calendar')).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
  });

  it('refuses a calendar without events and deletes nothing', async () => {
    const sessions = await count(db, classSessions);
    expect(sessions).toBeGreaterThan(0);
    await expect(
      syncTimetable(db, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'),
    ).rejects.toThrow(
      'Plan nie zawiera żadnych zajęć — pomijam synchronizację',
    );
    expect(await count(db, classSessions)).toBe(sessions);
  });

  it('rolls back everything when an insert fails mid-transaction', async () => {
    const before = await snapshot(db);
    // New subject and class are inserted first; the organizer e-mail is
    // longer than lecturers.email (varchar 200), so that insert fails at the DB.
    const bad = [
      'BEGIN:VEVENT',
      'DTSTART;TZID=Europe/Warsaw:20261110T080000',
      'DTEND;TZID=Europe/Warsaw:20261110T093000',
      'LOCATION:D-1 101',
      'STATUS:CONFIRMED',
      'SEQUENCE:0',
      'UID:900000099',
      'SUMMARY:Przedmiot do wycofania',
      'DESCRIPTION:Wykład 1',
      `ORGANIZER;CN="dr Nowy, N":mailto:${'x'.repeat(250)}@example.edu`,
      'END:VEVENT',
      '',
    ].join('\r\n');
    const feed = FIXTURE.replace(/END:VCALENDAR/, `${bad}END:VCALENDAR`);
    const err = await syncTimetable(db, feed).then(
      () => null,
      (e: unknown) => e as Error & { cause?: Error },
    );
    expect(err?.message).toMatch(/insert into `lecturers`/);
    expect(err?.cause?.message).toMatch(/too long/i);
    expect(await snapshot(db)).toEqual(before);
  });
});

describe('syncTimetable with pre-existing rows', () => {
  let db: Db;
  beforeAll(async () => {
    db = await resetTestDb();
  });
  afterAll(async () => {
    await closeTestDb(db);
  });

  it('reuses lecturers and Discord subjects, avoids code collisions', async () => {
    const [lec] = await db
      .insert(lecturers)
      .values({ name: 'Jarosław Piekło', email: 'LECTURER1@example.edu' })
      .$returningId();
    await db
      .insert(subjects)
      .values({ name: 'Inny przedmiot', code: 'AL', semester: 3, ects: 5 });
    await db.insert(subjects).values({
      name: 'Chemia',
      code: 'CHEM',
      semester: 1,
      ects: 6,
      discordChannelId: '123456789',
      unitimeName: 'Chemia ogólna (1rok)',
    });
    const [chemBefore] = await db
      .select()
      .from(subjects)
      .where(eq(subjects.code, 'CHEM'));

    await syncTimetable(db, FIXTURE);

    const piekla = await db
      .select()
      .from(lecturers)
      .where(eq(lecturers.email, 'lecturer1@example.edu'));
    expect(piekla).toHaveLength(1);
    expect(piekla[0]).toMatchObject({ id: lec?.id, name: 'Jarosław Piekło' });
    expect(piekla[0]?.title).toBeNull();

    const [algebra] = await db
      .select()
      .from(subjects)
      .where(eq(subjects.unitimeName, 'Algebra liniowa (1rok)'));
    expect(algebra?.code).toBe('AL-2');

    const [chemAfter] = await db
      .select()
      .from(subjects)
      .where(eq(subjects.code, 'CHEM'));
    expect(chemAfter).toEqual(chemBefore);
    const chemSessions = await db
      .select()
      .from(classSessions)
      .where(eq(classSessions.subjectId, chemBefore?.id ?? -1));
    expect(chemSessions.length).toBeGreaterThan(0);

    // Whole-class assignment (no group) for the lecture is created once.
    const lectureAssignments = await db
      .select()
      .from(classLecturers)
      .where(eq(classLecturers.lecturerId, lec?.id ?? -1));
    expect(lectureAssignments.length).toBeGreaterThan(0);
    await syncTimetable(db, FIXTURE);
    const nullGroupRows = await db
      .select()
      .from(classLecturers)
      .where(isNull(classLecturers.groupId));
    const keys = nullGroupRows.map((r) => `${r.classId}:${r.lecturerId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('plan sync status', () => {
  let db: Db;
  beforeAll(async () => {
    db = await resetTestDb();
  });
  afterAll(async () => {
    await closeTestDb(db);
  });

  it('starts empty', async () => {
    expect(await getPlanSyncStatus(db)).toEqual({
      requestedAt: null,
      lastRunAt: null,
      lastOkAt: null,
      lastError: null,
      stats: null,
    });
  });

  it('requestPlanSync sets requestedAt', async () => {
    const at = new Date('2026-10-12T08:00:00Z');
    await requestPlanSync(db, at);
    expect((await getPlanSyncStatus(db)).requestedAt).toEqual(at);
  });

  it('records success and failure', async () => {
    const stats = {
      created: 3,
      updated: 1,
      deleted: 2,
      unchanged: 7,
      warnings: ['Nieznany typ zajęć: X'],
    };
    const ok = new Date('2026-10-12T09:00:00Z');
    await recordPlanSync(db, { at: ok, ok: true, stats });
    let s = await getPlanSyncStatus(db);
    expect(s).toMatchObject({
      lastRunAt: ok,
      lastOkAt: ok,
      lastError: null,
      stats,
    });
    expect(s.requestedAt).toEqual(new Date('2026-10-12T08:00:00Z'));

    const bad = new Date('2026-10-12T10:00:00Z');
    await recordPlanSync(db, { at: bad, ok: false, error: 'x'.repeat(5000) });
    s = await getPlanSyncStatus(db);
    expect(s.lastRunAt).toEqual(bad);
    expect(s.lastOkAt).toEqual(ok);
    expect(s.lastError).toHaveLength(1000);
    expect(s.stats).toEqual(stats);

    await recordPlanSync(db, { at: ok, ok: true, stats });
    expect((await getPlanSyncStatus(db)).lastError).toBeNull();
  });
});
