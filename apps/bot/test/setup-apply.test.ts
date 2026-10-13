import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classLecturers,
  classSessions,
  type Db,
  ensureClass,
  ensureGroup,
  getSetting,
  insertMaterial,
  lecturers,
  materials,
  subjects,
  tags,
  topics,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { applySetup, type SetupGuild } from '../src/setup/apply.js';
import { INFO_TITLE } from '../src/setup/info.js';
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
    async createThread(forumId, o) {
      calls.push(['createThread', forumId, o]);
      const id = `th-${++n}`;
      return {
        threadId: id,
        messageId: id,
        attachmentIds: o.files.map((_, i) => `${id}-att-${i}`),
      };
    },
    async sendMessage(threadId, o) {
      calls.push(['sendMessage', threadId, o]);
      const id = `msg-${++n}`;
      return {
        messageId: id,
        attachmentIds: o.files.map((_, i) => `${id}-att-${i}`),
      };
    },
    async editMessage(threadId, messageId, content) {
      calls.push(['editMessage', threadId, messageId, content]);
    },
    async pinThread(threadId) {
      calls.push(['pinThread', threadId]);
    },
  };
}

const snapshot: GuildSnapshot = {
  categories: [],
  forums: [],
  roles: [],
  callerId: 'u1',
  callerRoleIds: [],
  unreadableForums: [],
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
      {
        name: 'Michał Kamiński',
        title: 'mgr',
        group: 3,
        email: null,
        officeHours: null,
        room: null,
      },
    ]);
    expect(asd?.classes.find((c) => c.kind === 'wyklad')?.groups).toEqual([]);
  });
});

describe('loadSubjectSpecs: topics, files, sessions', () => {
  it('loads posted-content data and upcoming sessions', async () => {
    const lab = await ensureClass(db, asdId, 'laboratorium');
    const gr1 = await ensureGroup(db, lab, 1);
    const [{ id: lid }] = await db
      .insert(lecturers)
      .values({
        name: 'Jan Kowalski',
        email: 'jan@example.edu',
        officeHours: 'śr. 10',
        room: 'B-1',
      })
      .$returningId();
    await db
      .insert(classLecturers)
      .values({ classId: lab, lecturerId: lid, groupId: null });
    const uid = await upsertUser(db, {
      discordUserId: 'u-ola',
      displayName: 'Ola',
      avatarUrl: null,
    });
    const [{ id: topicId }] = await db
      .insert(topics)
      .values({
        subjectId: asdId,
        title: 'Lab 1',
        discordThreadId: 'seed-1',
        createdBy: uid,
        classId: lab,
        groupId: gr1,
      })
      .$returningId();
    await db.insert(topics).values({
      subjectId: asdId,
      title: 'Gone',
      discordThreadId: 'seed-2',
      deletedAt: new Date(),
    });
    const mat = (id: string, status: 'ready' | 'pending', deleted = false) =>
      insertMaterial(
        db,
        {
          topicId,
          uploaderId: uid,
          discordMessageId: `m-${id}`,
          discordAttachmentId: `a-${id}`,
          originalFilename: `${id}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 123,
          sha256: id.padEnd(64, '0'),
          storagePath: `originals/${id}.pdf`,
          previewKind: 'pdf',
          status,
          deletedAt: deleted ? new Date() : null,
        },
        status === 'ready' ? [] : ['extract_text'],
      );
    await mat('a', 'ready');
    await mat('b', 'pending');
    await mat('c', 'ready', true);
    const at = (d: number) => new Date(Date.UTC(2026, 9, d, 8));
    await db.insert(classSessions).values(
      [5, 13, 30].map((d) => ({
        uid: 'u-lab',
        occurrenceStart: at(d),
        subjectId: asdId,
        classId: lab,
        groupId: gr1,
        room: 'C-2',
        startsAt: at(d),
        endsAt: at(d),
      })),
    );

    const [asd] = (await loadSubjectSpecs(db, at(12))).filter(
      (s) => s.code === 'ASD',
    );
    expect(asd.classes[0].lecturers[0]).toMatchObject({
      email: 'jan@example.edu',
      officeHours: 'śr. 10',
      room: 'B-1',
    });
    expect(asd.topics).toHaveLength(1);
    expect(asd.topics?.[0]).toMatchObject({
      id: topicId,
      title: 'Lab 1',
      threadId: 'seed-1',
      classKind: 'laboratorium',
      group: 1,
      authorName: 'Ola',
    });
    expect(asd.topics?.[0].materials.map((m) => m.filename)).toEqual(['a.pdf']);
    expect(asd.sessions?.map((x) => x.startsAt.getUTCDate())).toEqual([13]);
    expect(asd.sessions?.[0]).toMatchObject({
      classKind: 'laboratorium',
      group: 1,
      room: 'C-2',
      status: 'confirmed',
    });
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

  it('stores and assigns a role created earlier in the same run', async () => {
    const g = fakeGuild();
    await applySetup(
      db,
      g,
      [
        { type: 'createRole', name: 'Studies Admin' },
        {
          type: 'assignRole',
          roleName: 'Studies Admin',
          roleId: null,
          userId: 'u1',
        },
      ],
      snapshot,
    );
    expect(g.calls).toContainEqual(['addRoleToMember', 'u1', 'role-new']);
    expect(await getSetting(db, 'admin_role_id')).toBe('role-new');
  });

  it('stores an adopted role and assigns by id', async () => {
    const g = fakeGuild();
    const r = await applySetup(
      db,
      g,
      [
        { type: 'adoptRole', roleId: 'r7', name: 'Studies Admin' },
        {
          type: 'assignRole',
          roleName: 'Studies Admin',
          roleId: 'r7',
          userId: 'u1',
        },
      ],
      snapshot,
    );
    expect(await getSetting(db, 'admin_role_id')).toBe('r7');
    expect(g.calls).toEqual([['addRoleToMember', 'u1', 'r7']]);
    expect(r.failures).toEqual([]);
    expect(r.updated.join('\n')).toContain('Studies Admin');
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

describe('applySetup: posts', () => {
  let storageDir: string;
  let topicId: number;
  let uid: number;
  const mat = async (name: string, onDisk = true) => {
    if (onDisk) writeFileSync(join(storageDir, name), name);
    const r = await insertMaterial(
      db,
      {
        topicId,
        uploaderId: uid,
        discordMessageId: `seed-m-${name}`,
        discordAttachmentId: `seed-a-${name}`,
        originalFilename: name,
        mimeType: 'application/pdf',
        sizeBytes: 1,
        sha256: name.padEnd(64, '0'),
        storagePath: name,
        previewKind: 'pdf',
      },
      [],
    );
    return r.materialId;
  };
  const file = (materialId: number, name: string) => ({
    materialId,
    name,
    storagePath: name,
  });
  const post = (
    topic: number,
    messages: { content: string; files: ReturnType<typeof file>[] }[],
    title = 'Lab 1',
  ): Action => ({
    type: 'postTopic',
    subjectId: asdId,
    code: 'ASD',
    channelId: 'f-asd',
    topicId: topic,
    title,
    tagIds: ['t1'],
    messages,
  });
  const linkOf = async (id: number) =>
    (
      await db
        .select({
          m: materials.discordMessageId,
          a: materials.discordAttachmentId,
        })
        .from(materials)
        .where(eq(materials.id, id))
    )[0];
  const threadOf = async (id: number) =>
    (
      await db
        .select({ t: topics.discordThreadId })
        .from(topics)
        .where(eq(topics.id, id))
    )[0].t;

  beforeEach(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'setup-posts-'));
    uid = await upsertUser(db, {
      discordUserId: 'u-ola',
      displayName: 'Ola',
      avatarUrl: null,
    });
    [{ id: topicId }] = await db
      .insert(topics)
      .values({ subjectId: asdId, title: 'Lab 1', discordThreadId: 'seed-1' })
      .$returningId();
  });

  it('posts a topic and links the thread and files by upload order', async () => {
    const a = await mat('a.pdf');
    const b = await mat('b.pdf');
    const g = fakeGuild();
    const r = await applySetup(
      db,
      g,
      [
        post(topicId, [
          { content: 'hdr', files: [file(a, 'a.pdf'), file(b, 'b.pdf')] },
        ]),
      ],
      snapshot,
      storageDir,
    );
    expect(g.calls[0]).toEqual([
      'createThread',
      'f-asd',
      {
        name: 'Lab 1',
        tagIds: ['t1'],
        content: 'hdr',
        files: [
          { path: join(storageDir, 'a.pdf'), name: 'a.pdf' },
          { path: join(storageDir, 'b.pdf'), name: 'b.pdf' },
        ],
      },
    ]);
    expect(await threadOf(topicId)).toBe('th-1');
    expect(await linkOf(a)).toEqual({ m: 'th-1', a: 'th-1-att-0' });
    expect(await linkOf(b)).toEqual({ m: 'th-1', a: 'th-1-att-1' });
    expect(r.created.join('\n')).toContain('Lab 1');
  });

  it('sends follow-up messages and links their files', async () => {
    const a = await mat('a.pdf');
    const b = await mat('b.pdf');
    const g = fakeGuild();
    await applySetup(
      db,
      g,
      [
        post(topicId, [
          { content: 'hdr', files: [file(a, 'a.pdf')] },
          { content: 'Pliki (cd.)', files: [file(b, 'b.pdf')] },
        ]),
      ],
      snapshot,
      storageDir,
    );
    expect(g.calls[1]?.[0]).toBe('sendMessage');
    expect(g.calls[1]?.[1]).toBe('th-1');
    expect(await linkOf(b)).toEqual({ m: 'msg-2', a: 'msg-2-att-0' });
  });

  it('links the thread but no files when the starter attachments are unknown', async () => {
    const a = await mat('a.pdf');
    const b = await mat('b.pdf');
    const g = fakeGuild();
    g.createThread = async () => ({
      threadId: 'th-x',
      messageId: 'th-x',
      attachmentIds: [],
    });
    const r = await applySetup(
      db,
      g,
      [
        post(topicId, [
          { content: 'hdr', files: [file(a, 'a.pdf'), file(b, 'b.pdf')] },
        ]),
      ],
      snapshot,
      storageDir,
    );
    expect(await threadOf(topicId)).toBe('th-x');
    expect(await linkOf(a)).toEqual({ m: 'seed-m-a.pdf', a: 'seed-a-a.pdf' });
    expect(await linkOf(b)).toEqual({ m: 'seed-m-b.pdf', a: 'seed-a-b.pdf' });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain('ASD');
    expect(r.failures[0]).toContain('Lab 1');
  });

  it('relinks nothing from a message whose attachment count is off, but keeps going', async () => {
    const a = await mat('a.pdf');
    const b = await mat('b.pdf');
    const c = await mat('c.pdf');
    const d = await mat('d.pdf');
    const g = fakeGuild();
    let sent = 0;
    g.sendMessage = async (_threadId, o) => {
      sent++;
      const id = `msg-${sent}`;
      const n = sent === 1 ? o.files.length - 1 : o.files.length;
      return {
        messageId: id,
        attachmentIds: Array.from({ length: n }, (_, i) => `${id}-att-${i}`),
      };
    };
    const r = await applySetup(
      db,
      g,
      [
        post(topicId, [
          { content: 'hdr', files: [file(a, 'a.pdf')] },
          {
            content: 'Pliki (cd.)',
            files: [file(b, 'b.pdf'), file(c, 'c.pdf')],
          },
          { content: 'Pliki (cd.)', files: [file(d, 'd.pdf')] },
        ]),
      ],
      snapshot,
      storageDir,
    );
    expect(await linkOf(a)).toEqual({ m: 'th-1', a: 'th-1-att-0' });
    expect(await linkOf(b)).toEqual({ m: 'seed-m-b.pdf', a: 'seed-a-b.pdf' });
    expect(await linkOf(c)).toEqual({ m: 'seed-m-c.pdf', a: 'seed-a-c.pdf' });
    expect(await linkOf(d)).toEqual({ m: 'msg-2', a: 'msg-2-att-0' });
    expect(await threadOf(topicId)).toBe('th-1');
    expect(r.failures).toHaveLength(1);
  });

  it('reports a missing file and still posts the next topic', async () => {
    const gone = await mat('gone.pdf', false);
    const [{ id: other }] = await db
      .insert(topics)
      .values({ subjectId: asdId, title: 'Other', discordThreadId: 'seed-2' })
      .$returningId();
    const g = fakeGuild();
    const r = await applySetup(
      db,
      g,
      [
        post(topicId, [{ content: 'hdr', files: [file(gone, 'gone.pdf')] }]),
        post(other, [{ content: 'hdr', files: [] }], 'Other'),
      ],
      snapshot,
      storageDir,
    );
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain('gone.pdf');
    expect(await threadOf(topicId)).toBe('seed-1');
    expect(await threadOf(other)).toBe('th-1');
  });

  const info = (
    existing: Extract<Action, { type: 'upsertInfoPost' }>['existing'],
    pin = false,
  ): Action => ({
    type: 'upsertInfoPost',
    subjectId: asdId,
    code: 'ASD',
    channelId: 'f-asd',
    content: 'INFO',
    existing,
    pin,
  });

  it('creates (pinning only when asked) and edits info posts', async () => {
    const g = fakeGuild();
    await applySetup(
      db,
      g,
      [
        info(null, true),
        info(null, false),
        info({ threadId: 'i2', messageId: 'i2' }),
      ],
      snapshot,
      storageDir,
    );
    expect(g.calls).toEqual([
      [
        'createThread',
        'f-asd',
        { name: INFO_TITLE, tagIds: [], content: 'INFO', files: [] },
      ],
      ['pinThread', 'th-1'],
      [
        'createThread',
        'f-asd',
        { name: INFO_TITLE, tagIds: [], content: 'INFO', files: [] },
      ],
      ['editMessage', 'i2', 'i2', 'INFO'],
    ]);
  });

  it('turns a failed pin into a warning and carries on with the subject', async () => {
    const g = fakeGuild();
    g.pinThread = async () => {
      throw new Error('Missing Permissions');
    };
    const r = await applySetup(
      db,
      g,
      [
        info(null, true),
        {
          type: 'setGuidelines',
          subjectId: asdId,
          code: 'ASD',
          channelId: 'f-asd',
          topic: 't',
        },
      ],
      snapshot,
      storageDir,
    );
    expect(r.failures).toEqual([]);
    expect(r.created.join('\n')).toContain('post informacyjny');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('ASD');
    expect(r.warnings[0]).toContain('Missing Permissions');
    expect(g.calls.at(-1)?.[0]).toBe('setForumTopic');
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
