import {
  classes,
  classGroups,
  classLecturers,
  type Db,
  insertMaterial,
  lecturers,
  materials,
  subjects,
  tags,
  topics,
  topicTags,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExplorerParams } from '../lib/explorer';
import {
  getExplorerFile,
  getSubjectTree,
  listExplorerFiles,
  listSubjectsOverview,
  resolveSelection,
  type TreeClass,
} from '../lib/queries';

let db: Db;
let sid: number;
let otherSid: number;
const ids: Record<string, number> = {};
let tagId: number;
let tree: TreeClass[];

const P = (o: Partial<ExplorerParams> = {}): ExplorerParams => ({
  classKind: null,
  group: null,
  topic: null,
  file: null,
  tab: 'explorer',
  ...o,
});

let n = 0;
async function mkTopic(
  subjectId: number,
  key: string,
  title: string,
  classId: number | null,
  groupId: number | null,
  deleted = false,
) {
  n++;
  const [{ id }] = await db
    .insert(topics)
    .values({
      subjectId,
      title,
      discordThreadId: `th${n}`,
      classId,
      groupId,
      deletedAt: deleted ? new Date() : null,
    })
    .$returningId();
  ids[key] = id;
}
async function mkFile(
  key: string,
  topicId: number,
  uploaderId: number,
  filename: string,
  deleted = false,
) {
  n++;
  const r = await insertMaterial(
    db,
    {
      topicId,
      uploaderId,
      discordMessageId: `m${n}`,
      discordAttachmentId: `a${n}`,
      originalFilename: filename,
      mimeType: 'application/pdf',
      sizeBytes: 10 * n,
      sha256: String(n).padStart(64, '0'),
      storagePath: `p${n}`,
      previewKind: 'pdf',
    },
    [],
  );
  ids[key] = r.materialId;
  if (deleted) {
    await db
      .update(materials)
      .set({ deletedAt: new Date() })
      .where(eq(materials.id, r.materialId));
  }
}

beforeAll(async () => {
  process.env.DISCORD_GUILD_ID = 'guild1';
  db = await resetTestDb();
  [{ id: sid }] = await db
    .insert(subjects)
    .values({
      name: 'Fizyka',
      code: 'FIZ',
      semester: 1,
      ects: 5,
      discordChannelId: 'c1',
    })
    .$returningId();
  [{ id: otherSid }] = await db
    .insert(subjects)
    .values({
      name: 'Chemia',
      code: 'CHEM',
      semester: 1,
      ects: 5,
      discordChannelId: 'c2',
    })
    .$returningId();
  const mkClass = async (
    subjectId: number,
    kind: 'wyklad' | 'cwiczenia' | 'laboratorium' | 'projekt',
    name: string,
  ) =>
    (
      await db.insert(classes).values({ subjectId, kind, name }).$returningId()
    )[0].id;
  const wyk = await mkClass(sid, 'wyklad', 'Wykład');
  const cw = await mkClass(sid, 'cwiczenia', 'Ćwiczenia');
  const lab = await mkClass(sid, 'laboratorium', 'Laboratorium');
  const proj = await mkClass(sid, 'projekt', 'Projekt');
  const otherCw = await mkClass(otherSid, 'cwiczenia', 'Ćwiczenia');
  const [{ id: g1 }] = await db
    .insert(classGroups)
    .values({ classId: cw, number: 1, name: 'Gr. 1' })
    .$returningId();
  const [{ id: g2 }] = await db
    .insert(classGroups)
    .values({ classId: cw, number: 2, name: 'Gr. 2' })
    .$returningId();
  await db
    .insert(classGroups)
    .values({ classId: cw, number: 3, name: 'Gr. 3' }); // empty group
  const [{ id: jan }] = await db
    .insert(lecturers)
    .values({ name: 'Jan Kowalski', title: 'dr' })
    .$returningId();
  const [{ id: anna }] = await db
    .insert(lecturers)
    .values({ name: 'Anna Nowak', title: null })
    .$returningId();
  await db.insert(classLecturers).values([
    { classId: wyk, lecturerId: jan },
    { classId: cw, lecturerId: anna, groupId: g2 },
    { classId: lab, lecturerId: jan },
  ]);
  const uid = await upsertUser(db, {
    discordUserId: 'u1',
    displayName: 'Ann',
    avatarUrl: null,
  });

  await mkTopic(sid, 'wstep', 'Wstęp', wyk, null);
  await mkTopic(sid, 'wyk0', 'Pusty wykład', wyk, null);
  await mkTopic(sid, 'zad1', 'Zadania', cw, g1);
  await mkTopic(sid, 'zad2', 'Zadania 2', cw, g2);
  await mkTopic(sid, 'luzem', 'Luzem', null, null);
  await mkTopic(sid, 'gone', 'Usunięty', proj, null, true);
  await mkTopic(otherSid, 'otherT', 'Cudzy', otherCw, null);

  await mkFile('f1', ids.wstep, uid, 'wstep.pdf');
  await mkFile('f2', ids.wstep, uid, 'Beta.pdf');
  await mkFile('fdel', ids.wyk0, uid, 'skasowany.pdf', true);
  await mkFile('f3', ids.zad1, uid, 'zadania_1.pdf');
  await mkFile('f4', ids.luzem, uid, 'Notatki_100%.pdf');
  await mkFile('f5', ids.luzem, uid, 'notatki100x.pdf');
  await mkFile('fgone', ids.gone, uid, 'duch.pdf');
  await mkFile('fother', ids.otherT, uid, 'obcy.pdf');
  [{ id: tagId }] = await db
    .insert(tags)
    .values({ subjectId: sid, name: 'Kolokwium', discordTagId: 'tg1' })
    .$returningId();
  await db.insert(topicTags).values({ topicId: ids.zad1, tagId });
  tree = await getSubjectTree(db, sid);
});

afterAll(async () => {
  await closeTestDb(db);
});

describe('getSubjectTree', () => {
  it('builds ordered, content-driven tree with counts', () => {
    expect(tree.map((c) => c.kind)).toEqual(['wyklad', 'cwiczenia', 'none']);
    const [wyk, cw, none] = tree;
    expect(wyk).toMatchObject({ name: 'Wykład', fileCount: 2, groups: [] });
    expect(wyk.topics).toEqual([
      { id: ids.wyk0, title: 'Pusty wykład', fileCount: 0 },
      { id: ids.wstep, title: 'Wstęp', fileCount: 2 },
    ]);
    expect(wyk.lecturers).toEqual([
      { name: 'Jan Kowalski', title: 'dr', groupName: null },
    ]);
    expect(cw.fileCount).toBe(1);
    expect(cw.topics).toEqual([]);
    expect(cw.groups.map((g) => [g.number, g.name, g.fileCount])).toEqual([
      [1, 'Gr. 1', 1],
      [2, 'Gr. 2', 0],
    ]);
    expect(cw.groups[1].topics).toEqual([
      { id: ids.zad2, title: 'Zadania 2', fileCount: 0 },
    ]);
    expect(cw.lecturers).toEqual([
      { name: 'Anna Nowak', title: null, groupName: 'Gr. 2' },
    ]);
    expect(none).toMatchObject({
      id: null,
      kind: 'none',
      name: 'Bez kategorii',
      fileCount: 2,
      lecturers: [],
    });
    expect(none.topics.map((t) => t.id)).toEqual([ids.luzem]);
  });
  it('omits classes without live topics and other subjects', () => {
    const all = JSON.stringify(tree);
    expect(all).not.toContain('Laboratorium');
    expect(all).not.toContain('Projekt');
    expect(all).not.toContain('Cudzy');
  });
  it('is empty for a subject without topics', async () => {
    expect(await getSubjectTree(db, 999999)).toEqual([]);
  });
});

describe('resolveSelection', () => {
  it('keeps a valid selection', () => {
    const p = P({
      classKind: 'cwiczenia',
      group: 1,
      topic: ids.zad1,
      file: 5,
      tab: 'map',
    });
    expect(resolveSelection(tree, p)).toEqual(p);
  });
  it('drops group not under class, and group without class', () => {
    expect(
      resolveSelection(tree, P({ classKind: 'wyklad', group: 1 })),
    ).toEqual(P({ classKind: 'wyklad' }));
    expect(resolveSelection(tree, P({ group: 1 }))).toEqual(P());
    expect(
      resolveSelection(tree, P({ classKind: 'cwiczenia', group: 3 })),
    ).toEqual(P({ classKind: 'cwiczenia' }));
  });
  it('drops unknown class and unknown topic', () => {
    expect(resolveSelection(tree, P({ classKind: 'projekt' }))).toEqual(P());
    expect(
      resolveSelection(tree, P({ classKind: 'wyklad', topic: 424242 })),
    ).toEqual(P({ classKind: 'wyklad' }));
    expect(resolveSelection(tree, P({ topic: ids.gone }))).toEqual(P());
  });
  it('drops topic outside selected group/class', () => {
    expect(
      resolveSelection(
        tree,
        P({ classKind: 'cwiczenia', group: 1, topic: ids.zad2 }),
      ),
    ).toEqual(P({ classKind: 'cwiczenia', group: 1 }));
    expect(
      resolveSelection(tree, P({ classKind: 'wyklad', topic: ids.zad1 })),
    ).toEqual(P({ classKind: 'wyklad' }));
  });
  it('fills class and group from topic position', () => {
    expect(resolveSelection(tree, P({ topic: ids.zad2 }))).toEqual(
      P({ classKind: 'cwiczenia', group: 2, topic: ids.zad2 }),
    );
    expect(
      resolveSelection(tree, P({ classKind: 'cwiczenia', topic: ids.zad1 })),
    ).toEqual(P({ classKind: 'cwiczenia', group: 1, topic: ids.zad1 }));
    expect(resolveSelection(tree, P({ topic: ids.luzem }))).toEqual(
      P({ classKind: 'none', topic: ids.luzem }),
    );
  });
  it('leaves file untouched', () => {
    expect(resolveSelection(tree, P({ file: 777 })).file).toBe(777);
  });
});

describe('listExplorerFiles', () => {
  const names = async (sel: ExplorerParams, opts = {}) =>
    (await listExplorerFiles(db, sid, sel, opts)).map((f) => f.filename);

  it('lists whole subject, excluding deleted and other subjects', async () => {
    const got = await names(P());
    expect(got.sort()).toEqual([
      'Beta.pdf',
      'Notatki_100%.pdf',
      'notatki100x.pdf',
      'wstep.pdf',
      'zadania_1.pdf',
    ]);
  });
  it('defaults to created desc', async () => {
    const files = await listExplorerFiles(db, sid, P(), {});
    expect(files[0].id).toBe(ids.f5);
  });
  it('filters by class, group, topic', async () => {
    expect((await names(P({ classKind: 'wyklad' }))).sort()).toEqual([
      'Beta.pdf',
      'wstep.pdf',
    ]);
    expect(await names(P({ classKind: 'none' }))).toHaveLength(2);
    expect(await names(P({ classKind: 'cwiczenia', group: 1 }))).toEqual([
      'zadania_1.pdf',
    ]);
    expect(await names(P({ classKind: 'cwiczenia', group: 2 }))).toEqual([]);
    expect(await names(P({ topic: ids.wstep }))).toHaveLength(2);
  });
  it('filters by tag', async () => {
    expect(await names(P(), { tagId })).toEqual(['zadania_1.pdf']);
  });
  it('q is case-insensitive contains and escapes wildcards', async () => {
    expect(await names(P(), { q: 'BETA' })).toEqual(['Beta.pdf']);
    expect(await names(P(), { q: '100%' })).toEqual(['Notatki_100%.pdf']);
    expect(await names(P(), { q: 'zadania_' })).toEqual(['zadania_1.pdf']);
    expect(await names(P(), { q: 'a_1' })).toEqual(['zadania_1.pdf']);
    expect(await names(P(), { q: '_' })).toEqual(
      expect.arrayContaining(['zadania_1.pdf', 'Notatki_100%.pdf']),
    );
    expect(await names(P(), { q: '%' })).toEqual(['Notatki_100%.pdf']);
  });
  it('sorts', async () => {
    expect(await names(P(), { sort: 'filename', dir: 'asc' })).toEqual([
      'Beta.pdf',
      'Notatki_100%.pdf',
      'notatki100x.pdf',
      'wstep.pdf',
      'zadania_1.pdf',
    ]);
    expect((await names(P(), { sort: 'filename', dir: 'desc' }))[0]).toBe(
      'zadania_1.pdf',
    );
    const byTopic = await listExplorerFiles(db, sid, P(), {
      sort: 'topic',
      dir: 'asc',
    });
    expect(byTopic[0].topicTitle).toBe('Luzem');
    expect((await names(P(), { sort: 'created', dir: 'asc' }))[0]).toBe(
      'wstep.pdf',
    );
    expect(await names(P(), { sort: 'uploader' })).toHaveLength(5);
  });
  it('returns full row shape', async () => {
    const [f] = await listExplorerFiles(db, sid, P({ topic: ids.zad1 }), {});
    expect(f).toMatchObject({
      id: ids.f3,
      filename: 'zadania_1.pdf',
      topicId: ids.zad1,
      topicTitle: 'Zadania',
      className: 'Ćwiczenia',
      groupName: 'Gr. 1',
      previewKind: 'pdf',
      status: 'ready',
      uploader: 'Ann',
    });
    expect(f.createdAt).toBeInstanceOf(Date);
    expect(f.discordUrl).toMatch(
      /^https:\/\/discord\.com\/channels\/guild1\/th\d+\/m\d+$/,
    );
    const [loose] = await listExplorerFiles(
      db,
      sid,
      P({ classKind: 'none' }),
      {},
    );
    expect(loose).toMatchObject({
      className: 'Bez kategorii',
      groupName: null,
    });
  });
});

describe('getExplorerFile', () => {
  it('returns file in subject', async () => {
    expect((await getExplorerFile(db, sid, ids.f1))?.filename).toBe(
      'wstep.pdf',
    );
  });
  it('null for deleted, deleted-topic, other subject, unknown', async () => {
    expect(await getExplorerFile(db, sid, ids.fdel)).toBeNull();
    expect(await getExplorerFile(db, sid, ids.fgone)).toBeNull();
    expect(await getExplorerFile(db, sid, ids.fother)).toBeNull();
    expect(await getExplorerFile(db, sid, 987654)).toBeNull();
  });
});

describe('listSubjectsOverview classes', () => {
  it('returns class chips in fixed order for classes with live topics', async () => {
    const list = await listSubjectsOverview(db);
    const fiz = list.find((s) => s.code === 'FIZ');
    expect(fiz?.classes).toEqual([
      { kind: 'wyklad', name: 'Wykład' },
      { kind: 'cwiczenia', name: 'Ćwiczenia' },
      { kind: 'none', name: 'Bez kategorii' },
    ]);
    expect(list.find((s) => s.code === 'CHEM')?.classes).toEqual([
      { kind: 'cwiczenia', name: 'Ćwiczenia' },
    ]);
  });
});
