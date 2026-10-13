import {
  classLecturers,
  type Db,
  ensureClass,
  ensureGroup,
  lecturers,
  subjects,
  tags,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { applySetup, type SetupGuild } from '../src/setup/apply.js';
import { loadSubjectSpecs } from '../src/setup/load.js';
import { formatPlan, formatReport } from '../src/setup/report.js';
import type { Action, GuildSnapshot } from '../src/setup/types.js';

let db: Db;
let asdId: number;
let bdId: number;
beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
  [{ id: asdId }] = await db
    .insert(subjects)
    .values({ code: 'ASD', name: 'Algorytmy', semester: 3, ects: 6 })
    .$returningId();
  [{ id: bdId }] = await db
    .insert(subjects)
    .values({ code: 'BD', name: 'Bazy', semester: 3, ects: 5 })
    .$returningId();
});
afterAll(async () => {
  await closeTestDb(db);
});

type Call = [string, ...unknown[]];
function fakeGuild(failForum?: string): SetupGuild & { calls: Call[] } {
  const calls: Call[] = [];
  let n = 0;
  const tagsOf = (names: string[]) =>
    names.map((name) => ({ id: `t-${name}`, name }));
  return {
    calls,
    async createRole(name) {
      calls.push(['createRole', name]);
      return 'role-new';
    },
    async addRoleToMember(userId, roleId) {
      calls.push(['addRoleToMember', userId, roleId]);
    },
    async createCategory(name) {
      calls.push(['createCategory', name]);
      return `cat-${++n}`;
    },
    async createForum(o) {
      calls.push(['createForum', o]);
      if (o.name === failForum) throw new Error('Missing Permissions');
      return { id: `forum-${++n}`, tags: tagsOf(o.tags) };
    },
    async addForumTags(channelId, names) {
      calls.push(['addForumTags', channelId, names]);
      return tagsOf(['Old', ...names]);
    },
    async setForumTopic(channelId, topic) {
      calls.push(['setForumTopic', channelId, topic]);
    },
  };
}

const snapshot: GuildSnapshot = {
  categories: [],
  forums: [],
  roles: [],
  callerId: 'u1',
  callerRoleIds: [],
};
const forum = (subjectId: number, code: string): Action => ({
  type: 'createForum',
  subjectId,
  code,
  name: code.toLowerCase(),
  categoryName: 'Semestr 3',
  tags: ['Wykład', 'Kolokwium'],
  topic: `G:${code}`,
});
const channelOf = async (id: number) =>
  (
    await db
      .select({ c: subjects.discordChannelId })
      .from(subjects)
      .where(eq(subjects.id, id))
  )[0].c;

describe('loadSubjectSpecs', () => {
  it('loads classes with sorted groups and group-scoped lecturers', async () => {
    const lab = await ensureClass(db, asdId, 'laboratorium');
    await ensureClass(db, asdId, 'wyklad');
    for (const g of [3, 1, 2]) await ensureGroup(db, lab, g);
    const [{ id: lid }] = await db
      .insert(lecturers)
      .values({ name: 'Michał Kamiński', title: 'mgr' })
      .$returningId();
    const gr3 = await ensureGroup(db, lab, 3);
    await db
      .insert(classLecturers)
      .values({ classId: lab, lecturerId: lid, groupId: gr3 });

    const specs = await loadSubjectSpecs(db);
    const asd = specs.find((s) => s.code === 'ASD');
    expect(asd?.channelId).toBeNull();
    const labSpec = asd?.classes.find((c) => c.kind === 'laboratorium');
    expect(labSpec?.groups).toEqual([1, 2, 3]);
    expect(labSpec?.lecturers).toEqual([
      { name: 'Michał Kamiński', title: 'mgr', group: 3 },
    ]);
    expect(asd?.classes.find((c) => c.kind === 'wyklad')?.groups).toEqual([]);
  });
});

describe('applySetup', () => {
  it('creates a category and forum, links it and syncs tags', async () => {
    const g = fakeGuild();
    const r = await applySetup(
      db,
      g,
      [{ type: 'createCategory', name: 'Semestr 3' }, forum(asdId, 'ASD')],
      snapshot,
    );
    expect(await channelOf(asdId)).toBe('forum-2');
    expect(g.calls[1]).toEqual([
      'createForum',
      {
        name: 'asd',
        parentId: 'cat-1',
        tags: ['Wykład', 'Kolokwium'],
        topic: 'G:ASD',
      },
    ]);
    const rows = await db
      .select({ name: tags.name, id: tags.discordTagId })
      .from(tags)
      .where(eq(tags.subjectId, asdId));
    expect(rows.map((t) => t.id).sort()).toEqual(['t-Kolokwium', 't-Wykład']);
    expect(r.created.join('\n')).toContain('ASD');
    expect(r.failures).toEqual([]);
  });

  it('records a failure and carries on with other subjects', async () => {
    const g = fakeGuild('asd');
    const r = await applySetup(
      db,
      g,
      [
        { type: 'createCategory', name: 'Semestr 3' },
        forum(asdId, 'ASD'),
        {
          type: 'setGuidelines',
          subjectId: asdId,
          code: 'ASD',
          channelId: 'x',
          topic: 't',
        },
        forum(bdId, 'BD'),
      ],
      snapshot,
    );
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain('ASD');
    expect(r.failures[0]).toContain('Missing Permissions');
    expect(g.calls.some((c) => c[0] === 'setForumTopic')).toBe(false);
    expect(await channelOf(asdId)).toBeNull();
    expect(await channelOf(bdId)).not.toBeNull();
  });

  it('reports a duplicate channel link as a failure without throwing', async () => {
    await db
      .update(subjects)
      .set({ discordChannelId: 'forum-1' })
      .where(eq(subjects.id, bdId));
    const r = await applySetup(db, fakeGuild(), [forum(asdId, 'ASD')], {
      ...snapshot,
      categories: [{ id: 'c3', name: 'Semestr 3' }],
    });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain('ASD');
  });

  it('assigns a role created earlier in the same run', async () => {
    const g = fakeGuild();
    await applySetup(
      db,
      g,
      [
        { type: 'createRole', name: 'Studies Admin' },
        { type: 'assignRole', roleName: 'Studies Admin', userId: 'u1' },
      ],
      snapshot,
    );
    expect(g.calls).toContainEqual(['addRoleToMember', 'u1', 'role-new']);
  });

  it('adds tags to an existing forum and re-syncs them', async () => {
    await db
      .update(subjects)
      .set({ discordChannelId: 'f-bd' })
      .where(eq(subjects.id, bdId));
    const r = await applySetup(
      db,
      fakeGuild(),
      [
        {
          type: 'addTags',
          subjectId: bdId,
          code: 'BD',
          channelId: 'f-bd',
          tags: ['Egzamin'],
        },
      ],
      snapshot,
    );
    const rows = await db.select().from(tags).where(eq(tags.subjectId, bdId));
    expect(rows.map((t) => t.name).sort()).toEqual(['Egzamin', 'Old']);
    expect(r.updated.join('\n')).toContain('BD');
  });
});

describe('applySetup: Discord → DB', () => {
  it('imports a forum as a linked subject with classes and tags', async () => {
    const r = await applySetup(
      db,
      fakeGuild(),
      [
        {
          type: 'importForum',
          channelId: 'f-fiz',
          forumName: 'fiz-fizyka',
          code: 'FIZ',
          name: 'Fizyka',
          semester: 2,
          tags: [
            { id: 'x1', name: 'Laboratorium' },
            { id: 'x2', name: 'Gr. 1' },
          ],
          classKinds: ['laboratorium'],
        },
      ],
      snapshot,
    );
    const [s] = await db
      .select()
      .from(subjects)
      .where(eq(subjects.code, 'FIZ'));
    expect(s).toMatchObject({
      name: 'Fizyka',
      semester: 2,
      ects: 0,
      discordChannelId: 'f-fiz',
    });
    const kinds = (await loadSubjectSpecs(db))
      .find((x) => x.code === 'FIZ')
      ?.classes.map((c) => c.kind);
    expect(kinds).toEqual(['laboratorium']);
    const t = await db.select().from(tags).where(eq(tags.subjectId, s.id));
    expect(t.map((x) => x.discordTagId).sort()).toEqual(['x1', 'x2']);
    expect(r.created.join('\n')).toContain('FIZ');
  });

  it('reports a code clash at insert time as a failure', async () => {
    const r = await applySetup(
      db,
      fakeGuild(),
      [
        {
          type: 'importForum',
          channelId: 'f-x',
          forumName: 'asd',
          code: 'ASD',
          name: 'Asd',
          semester: 1,
          tags: [],
          classKinds: [],
        },
      ],
      snapshot,
    );
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain('ASD');
  });

  it('adds missing classes to an existing subject', async () => {
    const r = await applySetup(
      db,
      fakeGuild(),
      [
        {
          type: 'addClasses',
          subjectId: bdId,
          code: 'BD',
          kinds: ['seminarium'],
        },
      ],
      snapshot,
    );
    const bd = (await loadSubjectSpecs(db)).find((x) => x.code === 'BD');
    expect(bd?.classes.map((c) => c.kind)).toEqual(['seminarium']);
    expect(r.updated.join('\n')).toContain('BD');
  });
});

describe('format', () => {
  it('says everything is up to date for an empty plan', () => {
    expect(formatPlan([])).toBe('Wszystko jest aktualne.');
    expect(
      formatReport({ created: [], updated: [], warnings: [], failures: [] }),
    ).toBe('Wszystko jest aktualne.');
  });
  it('notes that imported forums get tags and guidelines in the real run', () => {
    const text = formatPlan([
      {
        type: 'importForum',
        channelId: 'f',
        forumName: 'fiz',
        code: 'FIZ',
        name: 'Fiz',
        semester: 1,
        tags: [],
        classKinds: [],
      },
    ]);
    expect(text).toContain('FIZ');
    expect(text).toContain('tagi i wytyczne');
  });
  it('keeps long plans within 2000 characters', () => {
    const many = Array.from({ length: 500 }, (_, i) => forum(i, `S${i}`));
    const text = formatPlan(many);
    expect(text.startsWith('Plan (bez zmian):')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(2000);
  });
});
