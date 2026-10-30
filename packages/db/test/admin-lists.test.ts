import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getLecturerAdmin,
  getSubjectAdmin,
  listLecturersAdmin,
  listSubjectsAdmin,
  listUsersAdmin,
} from '../src/admin-lists.js';
import type { Db } from '../src/client.js';
import {
  classes,
  classGroups,
  classLecturers,
  lecturers,
  subjects,
  users,
} from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

let db: Db;

beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
  await db.insert(subjects).values([
    {
      name: 'Algorytmy',
      code: 'ASD',
      semester: 1,
      ects: 5,
      discordChannelId: 'ch1',
    },
    { name: 'Analiza', code: 'AM', semester: 2, ects: 6 },
  ]);
  const [s] = await db.select().from(subjects).where(eq(subjects.code, 'ASD'));
  const [lec] = await db.insert(classes).values({
    subjectId: s.id,
    kind: 'laboratorium',
    name: 'Lab',
  });
  await db.insert(classes).values({
    subjectId: s.id,
    kind: 'wyklad',
    name: 'Wyk',
  });
  const labId = lec.insertId;
  await db
    .insert(classGroups)
    .values({ classId: labId, number: 1, name: 'Gr. 1' });
  await db.insert(lecturers).values([
    { name: 'Zed', title: 'dr' },
    { name: 'Abc', email: 'a@b.c' },
  ]);
  const lects = await db.select().from(lecturers);
  const [g] = await db.select().from(classGroups);
  const zed = lects.find((l) => l.name === 'Zed');
  const abc = lects.find((l) => l.name === 'Abc');
  await db.insert(classLecturers).values([
    { classId: labId, lecturerId: zed?.id ?? 0, groupId: g.id },
    { classId: labId, lecturerId: abc?.id ?? 0, groupId: null },
  ]);
  await db.insert(users).values([
    { discordUserId: '111', displayName: 'Ann 50% off' },
    { discordUserId: '222', displayName: 'Bob' },
    { discordUserId: '333', displayName: 'Cid_x' },
  ]);
});
afterAll(async () => {
  await closeTestDb(db);
});

describe('admin lists', () => {
  it('lists subjects by code with forumLinked and classCount', async () => {
    const rows = await listSubjectsAdmin(db);
    expect(rows.map((r) => r.code)).toEqual(['AM', 'ASD']);
    expect(rows[0]).toMatchObject({ forumLinked: false, classCount: 0 });
    expect(rows[1]).toMatchObject({ forumLinked: true, classCount: 2 });
  });

  it('gets a subject case-insensitively after trim', async () => {
    const s = await getSubjectAdmin(db, ' asd ');
    expect(s?.code).toBe('ASD');
    expect(s?.forumLinked).toBe(true);
    expect(s?.classes.map((c) => c.kind)).toEqual(['wyklad', 'laboratorium']);
    const lab = s?.classes[1];
    expect(lab?.groups).toHaveLength(1);
    const byName = Object.fromEntries(
      (lab?.lecturers ?? []).map((l) => [l.name, l.groupName]),
    );
    expect(byName).toEqual({ Zed: 'Gr. 1', Abc: null });
    // Each assignment carries its class_lecturers id (the Remove button).
    const ids = (await db.select().from(classLecturers)).map((r) => r.id);
    expect((lab?.lecturers ?? []).map((l) => l.id).sort()).toEqual(ids.sort());
    expect(await getSubjectAdmin(db, 'nope')).toBeNull();
  });

  it('lists and gets lecturers', async () => {
    const rows = await listLecturersAdmin(db);
    expect(rows.map((r) => r.name)).toEqual(['Abc', 'Zed']);
    expect((await getLecturerAdmin(db, rows[1].id))?.title).toBe('dr');
    expect(await getLecturerAdmin(db, 9999)).toBeNull();
  });

  it('searches users with escaped LIKE and pages with total', async () => {
    const lit = await listUsersAdmin(db, { q: '50%', limit: 10, offset: 0 });
    expect(lit.total).toBe(1);
    expect(lit.rows[0].discordUserId).toBe('111');
    const us = await listUsersAdmin(db, { q: '_x', limit: 10, offset: 0 });
    expect(us.rows.map((r) => r.displayName)).toEqual(['Cid_x']);
    const byId = await listUsersAdmin(db, { q: '222', limit: 10, offset: 0 });
    expect(byId.rows[0].displayName).toBe('Bob');
    const page = await listUsersAdmin(db, { limit: 2, offset: 2 });
    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(1);
  });
});
