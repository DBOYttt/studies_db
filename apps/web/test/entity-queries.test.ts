import {
  classes,
  classGroups,
  classLecturers,
  type Db,
  insertMaterial,
  lecturers,
  subjects,
  tags,
  topics,
  topicTags,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RO_POOL_OPTIONS } from '../lib/db';
import {
  FILE_COLUMNS,
  fileSort,
  getLecturer,
  getTag,
  getUser,
  lecturerFiles,
  listLecturerAssignments,
  pageSql,
  tagFiles,
  tagTopics,
  userFiles,
  userTopics,
} from '../lib/entity-queries';

let db: Db;
let ro: mysql.Pool;
const id: Record<string, number> = {};
const O = { page: 1, perPage: 25 };
let n = 0;

async function mkTopic(
  key: string,
  subjectId: number,
  classId: number | null,
  groupId: number | null,
  createdBy: number | null = null,
) {
  n++;
  const [r] = await db
    .insert(topics)
    .values({
      subjectId,
      title: `T ${key}`,
      discordThreadId: `th${n}`,
      classId,
      groupId,
      createdBy,
    })
    .$returningId();
  id[`t_${key}`] = r.id;
}
async function mkFile(key: string, topicId: number, uploaderId: number) {
  n++;
  const r = await insertMaterial(
    db,
    {
      topicId,
      uploaderId,
      discordMessageId: `m${n}`,
      discordAttachmentId: `a${n}`,
      originalFilename: `${key}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 10,
      sha256: String(n).padStart(64, '0'),
      storagePath: `p${n}`,
      previewKind: 'pdf',
    },
    [],
  );
  id[`f_${key}`] = r.materialId;
}
const names = (p: { columns: string[]; rows: unknown[][] }) =>
  p.rows.map((r) => r[p.columns.indexOf('filename')]).sort();

beforeAll(async () => {
  db = await resetTestDb();
  ro = mysql.createPool({
    ...RO_POOL_OPTIONS,
    uri: testRoUrl(),
    connectionLimit: 3,
  });
  const [{ id: sid }] = await db
    .insert(subjects)
    .values({
      name: 'Mechanika',
      code: 'MECH',
      semester: 1,
      ects: 5,
      discordChannelId: 'c1',
    })
    .$returningId();
  id.sid = sid;
  const [{ id: cw }] = await db
    .insert(classes)
    .values({ subjectId: sid, kind: 'cwiczenia', name: 'Ćwiczenia' })
    .$returningId();
  const [{ id: wyk }] = await db
    .insert(classes)
    .values({ subjectId: sid, kind: 'wyklad', name: 'Wykład' })
    .$returningId();
  const g: Record<number, number> = {};
  for (const num of [2, 3, 4]) {
    [{ id: g[num] }] = await db
      .insert(classGroups)
      .values({ classId: cw, number: num, name: `Gr. ${num}` })
      .$returningId();
  }
  const mkLect = async (name: string) =>
    (await db.insert(lecturers).values({ name }).$returningId())[0].id;
  id.A = await mkLect('A');
  id.B = await mkLect('B');
  id.C = await mkLect('C');
  id.D = await mkLect('D');
  await db.insert(classLecturers).values([
    { classId: cw, lecturerId: id.A, groupId: g[2] },
    { classId: cw, lecturerId: id.A, groupId: g[3] },
    { classId: cw, lecturerId: id.B, groupId: g[4] },
    { classId: wyk, lecturerId: id.C },
  ]);
  const mkUser = (d: string) =>
    upsertUser(db, { discordUserId: d, displayName: d, avatarUrl: null });
  id.U1 = await mkUser('U1');
  id.U2 = await mkUser('U2');
  id.U3 = await mkUser('U3');
  await mkTopic('gr2', sid, cw, g[2], id.U1);
  await mkTopic('gr4', sid, cw, g[4], id.U2);
  await mkTopic('cwng', sid, cw, null, id.U1);
  await mkTopic('wyk', sid, wyk, null);
  await mkTopic('none', sid, null, null);
  await mkFile('gr2', id.t_gr2, id.U1);
  await mkFile('gr4', id.t_gr4, id.U2);
  await mkFile('cwng', id.t_cwng, id.U1);
  await mkFile('wyk', id.t_wyk, id.U1);
  await mkFile('none', id.t_none, id.U1);
  [{ id: id.tag }] = await db
    .insert(tags)
    .values({ subjectId: sid, name: 'Kolokwium', discordTagId: 'tg1' })
    .$returningId();
  [{ id: id.tag0 }] = await db
    .insert(tags)
    .values({ subjectId: sid, name: 'Pusty', discordTagId: 'tg2' })
    .$returningId();
  await db.insert(topicTags).values([
    { topicId: id.t_gr2, tagId: id.tag },
    { topicId: id.t_wyk, tagId: id.tag },
  ]);
});

afterAll(async () => {
  await ro.end();
  await closeTestDb(db);
});

describe('lecturerFiles', () => {
  it('A: own groups plus class-wide topics, not other groups/kinds/no class', async () => {
    expect(names(await lecturerFiles(ro, id.A, O))).toEqual([
      'cwng.pdf',
      'gr2.pdf',
    ]);
  });
  it('B: own group plus class-wide', async () => {
    expect(names(await lecturerFiles(ro, id.B, O))).toEqual([
      'cwng.pdf',
      'gr4.pdf',
    ]);
  });
  it('C: whole-class lecturer sees lecture only', async () => {
    expect(names(await lecturerFiles(ro, id.C, O))).toEqual(['wyk.pdf']);
  });
  it('D: nothing', async () => {
    expect((await lecturerFiles(ro, id.D, O)).total).toBe(0);
  });
  it('exposes FILE_COLUMNS and the SQL text', async () => {
    const p = await lecturerFiles(ro, id.A, O);
    expect(p.columns).toEqual(FILE_COLUMNS);
    expect(p.sql).toContain('LIMIT 0, 25');
    expect(p.sql).toContain(`cl.lecturer_id = ${id.A}`);
  });
});

describe('listLecturerAssignments', () => {
  it('A: groups 2 and 3 only', async () => {
    const a = await listLecturerAssignments(ro, id.A);
    expect(a.map((x) => [x.groupNumber, x.groupName, x.wholeClass])).toEqual([
      [2, 'Gr. 2', false],
      [3, 'Gr. 3', false],
    ]);
    expect(a[0]).toMatchObject({
      subjectCode: 'MECH',
      subjectName: 'Mechanika',
      classKind: 'cwiczenia',
      className: 'Ćwiczenia',
      fileCount: 1,
    });
    expect(a[1].fileCount).toBe(0);
  });
  it('C: whole-class row, no groups exist', async () => {
    const a = await listLecturerAssignments(ro, id.C);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      classKind: 'wyklad',
      wholeClass: true,
      groupNumber: null,
      groupName: null,
      fileCount: 1,
    });
  });
  it('D: empty', async () => {
    expect(await listLecturerAssignments(ro, id.D)).toEqual([]);
  });
  it('whole-class + group rows expand and deduplicate', async () => {
    const [{ id: lid }] = await db
      .insert(lecturers)
      .values({ name: 'E' })
      .$returningId();
    const [g2] = await db
      .select()
      .from(classGroups)
      .where(eq(classGroups.number, 2));
    await db.insert(classLecturers).values([
      { classId: g2.classId, lecturerId: lid },
      { classId: g2.classId, lecturerId: lid, groupId: g2.id },
    ]);
    const a = await listLecturerAssignments(ro, lid);
    expect(a[0].wholeClass).toBe(true);
    const nums = a.slice(1).map((x) => x.groupNumber);
    expect(nums).toEqual([2, 3, 4]);
    expect(a.slice(1).every((x) => !x.wholeClass)).toBe(true);
  });
});

describe('users', () => {
  it('userFiles U2', async () => {
    expect(names(await userFiles(ro, id.U2, O))).toEqual(['gr4.pdf']);
  });
  it('userFiles empty', async () => {
    const p = await userFiles(ro, id.U3, O);
    expect(p.total).toBe(0);
    expect(p.page).toBe(1);
  });
  it('userTopics', async () => {
    const p = await userTopics(ro, id.U1, O);
    expect(p.columns).toEqual([
      'id',
      'title',
      'subject_name',
      'class_id',
      'group_id',
      'created_at',
      'subject_id',
    ]);
    expect(p.total).toBe(2);
  });
  it('getUser', async () => {
    expect((await getUser(ro, id.U1))?.display_name).toBe('U1');
    expect(await getUser(ro, 999)).toBeNull();
  });
});

describe('tags', () => {
  it('tagTopics / tagFiles', async () => {
    expect((await tagTopics(ro, id.tag, O)).total).toBe(2);
    expect(names(await tagFiles(ro, id.tag, O))).toEqual([
      'gr2.pdf',
      'wyk.pdf',
    ]);
  });
  it('untagged', async () => {
    expect((await tagTopics(ro, id.tag0, O)).total).toBe(0);
    expect((await tagFiles(ro, id.tag0, O)).total).toBe(0);
  });
  it('getTag', async () => {
    expect(await getTag(ro, id.tag)).toMatchObject({
      name: 'Kolokwium',
      subject_code: 'MECH',
      subject_name: 'Mechanika',
      subject_id: id.sid,
    });
    expect(await getTag(ro, 999)).toBeNull();
  });
});

describe('getLecturer / pageSql / fileSort', () => {
  it('getLecturer', async () => {
    expect(await getLecturer(ro, id.A)).toMatchObject({ name: 'A' });
    expect(await getLecturer(ro, 999)).toBeNull();
  });
  it('pageSql clamps and inlines', async () => {
    const q = {
      select: 'id',
      from: 'v_users',
      where: 'id > ?',
      params: [0],
      orderBy: 'id',
      page: 99,
      perPage: 25,
    };
    const p = await pageSql(ro, q);
    expect(p.page).toBe(1);
    expect(p.sql).toBe(
      'SELECT id\nFROM v_users\nWHERE id > 0\nORDER BY id\nLIMIT 0, 25',
    );
  });
  it('fileSort whitelist', () => {
    expect(fileSort()).toBe('created_at DESC, material_id DESC');
    expect(fileSort('filename', 'asc')).toBe('filename ASC, material_id DESC');
    expect(fileSort('evil; DROP', 'asc')).toBe(
      'created_at DESC, material_id DESC',
    );
  });
});
