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
  setSetting,
  subjects,
  tags,
  topics,
  upsertUser,
  users,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { applySetup, type SetupGuild } from '../src/setup/apply.js';
import { INFO_TITLE } from '../src/setup/info.js';
import { loadPanelSettings, loadSubjectSpecs } from '../src/setup/load.js';
import { planSetup } from '../src/setup/plan.js';
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
function fakeGuild(failForum?: string): SetupGuild & {
  calls: Call[];
  /** Panel messages that exist on the fake server. */
  panelMessages: Set<string>;
  /** Pinned panel messages. */
  pinned: Set<string>;
  /** Discord refuses pins (no Pin Messages). */
  refusePin: boolean;
  textChannels: GuildSnapshot['textChannels'];
} {
  const calls: Call[] = [];
  const panelMessages = new Set<string>();
  const pinned = new Set<string>();
  const textChannels: GuildSnapshot['textChannels'] = [];
  let n = 0;
  const tagsOf = (names: string[]) =>
    names.map((name) => ({ id: `t-${name}`, name }));
  return {
    calls,
    panelMessages,
    pinned,
    refusePin: false,
    textChannels,
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
    async createTextChannel(o) {
      calls.push(['createTextChannel', o]);
      const id = `text-${++n}`;
      textChannels.push({
        id,
        name: o.name,
        parentId: o.parentId,
        everyoneCanView: !o.private,
        viewRoleIds: o.private && o.adminRoleId ? [o.adminRoleId] : [],
      });
      return id;
    },
    async postPanel(channelId) {
      calls.push(['postPanel', channelId]);
      const id = `panel-msg-${++n}`;
      panelMessages.add(id);
      if (!this.refusePin) pinned.add(id);
      return { id, pinned: pinned.has(id) };
    },
    async syncAdminPanelPerms(channelId, roleId) {
      calls.push(['syncAdminPanelPerms', channelId, roleId]);
    },
    async editPanel(channelId, messageId) {
      calls.push(['editPanel', channelId, messageId]);
      if (!panelMessages.has(messageId)) return false;
      if (!this.refusePin) pinned.add(messageId);
      return { pinned: pinned.has(messageId) };
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
  textChannels: [],
  panelChannels: { panel: null, admin: null },
  panelMessages: { panel: null, admin: null },
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
    expect(asd.topics?.[0].materials[0].discordMessageId).toBe('m-a');
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

  describe('admin role change', () => {
    const adminFlags = async () =>
      (await db.select().from(users).orderBy(users.discordUserId)).map(
        (u) => u.isAdmin,
      );
    const twoAdmins = async () => {
      for (const id of ['a1', 'a2']) {
        await upsertUser(db, {
          discordUserId: id,
          displayName: id,
          avatarUrl: null,
        });
      }
      await db.update(users).set({ isAdmin: true });
    };

    it('clears every is_admin when an adopted role replaces the stored one', async () => {
      await setSetting(db, 'admin_role_id', 'old');
      await twoAdmins();
      await applySetup(
        db,
        fakeGuild(),
        [{ type: 'adoptRole', roleId: 'r7', name: 'Studies Admin' }],
        snapshot,
      );
      expect(await getSetting(db, 'admin_role_id')).toBe('r7');
      expect(await adminFlags()).toEqual([false, false]);
    });

    it('clears every is_admin when a created role replaces the stored one', async () => {
      await setSetting(db, 'admin_role_id', 'old');
      await twoAdmins();
      await applySetup(
        db,
        fakeGuild(),
        [{ type: 'createRole', name: 'Studies Admin' }],
        snapshot,
      );
      expect(await getSetting(db, 'admin_role_id')).toBe('role-new');
      expect(await adminFlags()).toEqual([false, false]);
    });

    it('keeps is_admin when the same role id is stored again', async () => {
      await setSetting(db, 'admin_role_id', 'r7');
      await twoAdmins();
      await applySetup(
        db,
        fakeGuild(),
        [{ type: 'adoptRole', roleId: 'r7', name: 'Studies Admin' }],
        snapshot,
      );
      expect(await adminFlags()).toEqual([true, true]);
    });

    it('reports the assigned role id', async () => {
      const r = await applySetup(
        db,
        fakeGuild(),
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
      expect(r.assignedRoleId).toBe('role-new');
    });
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
    sizeBytes: 1,
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

  it('re-sends missing files into the thread and relinks them', async () => {
    const a = await mat('a.pdf');
    const b = await mat('b.pdf');
    const c = await mat('c.pdf');
    const g = fakeGuild();
    let sent = 0;
    g.sendMessage = async (threadId, o) => {
      g.calls.push(['sendMessage', threadId, o]);
      sent++;
      const id = `msg-${sent}`;
      // The second message comes back short: its file stays unlinked.
      const n = sent === 2 ? 0 : o.files.length;
      return {
        messageId: id,
        attachmentIds: Array.from({ length: n }, (_, i) => `${id}-att-${i}`),
      };
    };
    const send: Action = {
      type: 'postFiles',
      subjectId: asdId,
      code: 'ASD',
      topicId,
      threadId: 'th-9',
      title: 'Lab 1',
      messages: [
        { content: 'Pliki (cd.)', files: [file(a, 'a.pdf'), file(b, 'b.pdf')] },
        { content: 'Pliki (cd.)', files: [file(c, 'c.pdf')] },
      ],
    };
    const r = await applySetup(
      db,
      g,
      [
        send,
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
    expect(g.calls.map((x) => [x[0], x[1]])).toEqual([
      ['sendMessage', 'th-9'],
      ['sendMessage', 'th-9'],
      ['setForumTopic', 'f-asd'],
    ]);
    expect(await linkOf(a)).toEqual({ m: 'msg-1', a: 'msg-1-att-0' });
    expect(await linkOf(b)).toEqual({ m: 'msg-1', a: 'msg-1-att-1' });
    expect(await linkOf(c)).toEqual({ m: 'seed-m-c.pdf', a: 'seed-a-c.pdf' });
    expect(r.updated.join('\n')).toContain('Lab 1');
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain('Lab 1');
  });

  it('reports a failed re-send without stopping the subject', async () => {
    const gone = await mat('gone.pdf', false);
    const g = fakeGuild();
    const r = await applySetup(
      db,
      g,
      [
        {
          type: 'postFiles',
          subjectId: asdId,
          code: 'ASD',
          topicId,
          threadId: 'th-9',
          title: 'Lab 1',
          messages: [
            { content: 'Pliki (cd.)', files: [file(gone, 'gone.pdf')] },
          ],
        },
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
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain('gone.pdf');
    expect(g.calls.map((x) => x[0])).toEqual(['setForumTopic']);
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

describe('applySetup: panels', () => {
  const ROLE = { name: 'Studies Admin', storedId: null };
  const newChannel = (which: 'panel' | 'admin') => ({
    type: 'ensurePanelChannel' as const,
    which,
    name: which === 'panel' ? ('panel' as const) : ('admin-panel' as const),
    existingId: null as string | null,
    parentId: 'c3',
  });
  const message = (
    which: 'panel' | 'admin',
    channelId: string | null,
    messageId: string | null,
  ): Action => ({ type: 'ensurePanelMessage', which, channelId, messageId });
  const createdChannels = (g: { calls: Call[] }) =>
    g.calls.filter((c) => c[0] === 'createTextChannel').map((c) => c[1]);

  it('creates #admin-panel with the admin role created earlier in the run', async () => {
    const g = fakeGuild();
    const r = await applySetup(
      db,
      g,
      [
        { type: 'createRole', name: 'Studies Admin' },
        newChannel('panel'),
        newChannel('admin'),
      ],
      snapshot,
    );
    expect(r.failures).toEqual([]);
    expect(createdChannels(g)).toEqual([
      { name: 'panel', parentId: 'c3', private: false, adminRoleId: null },
      {
        name: 'admin-panel',
        parentId: 'c3',
        private: true,
        adminRoleId: 'role-new',
      },
    ]);
    expect(await getSetting(db, 'panel_channel_id')).toBe('text-1');
    expect(await getSetting(db, 'admin_panel_channel_id')).toBe('text-2');
  });

  it('uses the stored admin role and refuses #admin-panel without one', async () => {
    const g = fakeGuild();
    const r1 = await applySetup(db, g, [newChannel('admin')], snapshot);
    expect(r1.failures).toHaveLength(1);
    expect(r1.failures[0]).toContain('#admin-panel');
    expect(createdChannels(g)).toEqual([]);
    await setSetting(db, 'admin_role_id', 'r7');
    await applySetup(db, g, [newChannel('admin')], snapshot);
    expect(createdChannels(g)).toEqual([
      { name: 'admin-panel', parentId: 'c3', private: true, adminRoleId: 'r7' },
    ]);
  });

  it('adopts an existing channel without creating one', async () => {
    const g = fakeGuild();
    await applySetup(
      db,
      g,
      [{ ...newChannel('panel'), existingId: 'x1' }],
      snapshot,
    );
    expect(createdChannels(g)).toEqual([]);
    expect(await getSetting(db, 'panel_channel_id')).toBe('x1');
  });

  it('edits a panel message that still exists and never re-posts it', async () => {
    const g = fakeGuild();
    g.panelMessages.add('m-p');
    const r = await applySetup(
      db,
      g,
      [message('panel', 'ch-p', 'm-p')],
      snapshot,
    );
    expect(g.calls.map((c) => c[0])).toEqual(['editPanel']);
    expect(r.updated.join('\n')).toContain('#panel');
    expect(await getSetting(db, 'panel_message_id')).toBeNull();
  });

  it('re-posts a panel message that is gone and stores the new id', async () => {
    const g = fakeGuild();
    const r = await applySetup(
      db,
      g,
      [message('admin', 'ch-a', 'm-gone')],
      snapshot,
    );
    expect(g.calls).toEqual([
      ['editPanel', 'ch-a', 'm-gone'],
      ['postPanel', 'ch-a'],
    ]);
    expect(await getSetting(db, 'admin_panel_message_id')).toBe('panel-msg-1');
    expect(r.created.join('\n')).toContain('#admin-panel');
  });

  it('posts into the channel created earlier in the run', async () => {
    const g = fakeGuild();
    await setSetting(db, 'admin_role_id', 'r7');
    await applySetup(
      db,
      g,
      [newChannel('panel'), message('panel', null, null)],
      snapshot,
    );
    expect(g.calls.map((c) => c.slice(0, 2))).toEqual([
      ['createTextChannel', expect.anything()],
      ['postPanel', 'text-1'],
    ]);
    expect(await getSetting(db, 'panel_message_id')).toBe('panel-msg-2');
  });

  it('reports a failed edit without posting a duplicate', async () => {
    const g = fakeGuild();
    g.editPanel = async () => {
      throw new Error('Service Unavailable');
    };
    const r = await applySetup(
      db,
      g,
      [message('panel', 'ch-p', 'm-p')],
      snapshot,
    );
    expect(g.calls).toEqual([]);
    expect(r.failures[0]).toContain('Service Unavailable');
  });

  it('posts each panel once over two runs', async () => {
    const g = fakeGuild();
    const run = async () => {
      const snap: GuildSnapshot = {
        ...snapshot,
        roles: [{ id: 'role-new', name: 'Studies Admin' }],
        callerRoleIds: ['role-new'],
        textChannels: [...g.textChannels],
        ...(await loadPanelSettings(db)),
      };
      const stored = await getSetting(db, 'admin_role_id');
      const actions = planSetup(
        [],
        snap,
        { ...ROLE, storedId: stored },
        () => '',
      );
      const r = await applySetup(db, g, actions, snap);
      expect(r.failures).toEqual([]);
    };
    await setSetting(db, 'admin_role_id', 'role-new');
    await run();
    await run();
    expect(g.calls.filter((c) => c[0] === 'createTextChannel')).toHaveLength(2);
    expect(g.calls.filter((c) => c[0] === 'postPanel')).toHaveLength(2);
    expect(g.calls.filter((c) => c[0] === 'editPanel')).toHaveLength(2);
  });
});

describe('applySetup: panel pins and adopted channels', () => {
  const message = (messageId: string | null): Action => ({
    type: 'ensurePanelMessage',
    which: 'panel',
    channelId: 'ch-p',
    messageId,
  });

  it('warns when a new panel cannot be pinned', async () => {
    const g = fakeGuild();
    g.refusePin = true;
    const r = await applySetup(db, g, [message(null)], snapshot);
    expect(r.failures).toEqual([]);
    expect(r.created).toEqual(['panel w #panel']);
    expect(r.warnings).toEqual([
      'nie udało się przypiąć panelu w #panel (bot potrzebuje uprawnienia Pin Messages)',
    ]);
    expect(await getSetting(db, 'panel_message_id')).toBe('panel-msg-1');
  });

  it('pins an existing unpinned panel on edit, and warns when that is refused', async () => {
    const g = fakeGuild();
    g.panelMessages.add('m-p');
    const r1 = await applySetup(db, g, [message('m-p')], snapshot);
    expect(g.pinned.has('m-p')).toBe(true);
    expect(r1.warnings).toEqual([]);
    const h = fakeGuild();
    h.panelMessages.add('m-p');
    h.refusePin = true;
    const r2 = await applySetup(db, h, [message('m-p')], snapshot);
    expect(h.calls.map((c) => c[0])).toEqual(['editPanel']);
    expect(r2.warnings[0]).toContain('nie udało się przypiąć panelu w #panel');
  });

  it('warns when an adopted #admin-panel is visible to everyone', async () => {
    const adopt = (which: 'panel' | 'admin', id: string): Action => ({
      type: 'ensurePanelChannel',
      which,
      name: which === 'panel' ? 'panel' : 'admin-panel',
      existingId: id,
      parentId: null,
    });
    const snap: GuildSnapshot = {
      ...snapshot,
      textChannels: [
        {
          id: 'x1',
          name: 'panel',
          parentId: null,
          everyoneCanView: true,
          viewRoleIds: [],
        },
        {
          id: 'x2',
          name: 'admin-panel',
          parentId: null,
          everyoneCanView: true,
          viewRoleIds: [],
        },
        {
          id: 'x3',
          name: 'admin-panel',
          parentId: null,
          everyoneCanView: false,
          viewRoleIds: [],
        },
      ],
    };
    const open = await applySetup(
      db,
      fakeGuild(),
      [adopt('panel', 'x1'), adopt('admin', 'x2')],
      snap,
    );
    expect(open.warnings).toEqual([
      'kanał #admin-panel widzą wszyscy — ogranicz go do roli admina',
    ]);
    const hidden = await applySetup(
      db,
      fakeGuild(),
      [adopt('admin', 'x3')],
      snap,
    );
    expect(hidden.warnings).toEqual([]);
  });
});

describe('applySetup: #admin-panel permissions', () => {
  const sync = (roleId: string | null): Action => ({
    type: 'syncAdminPanelPerms',
    channelId: 'ch-a',
    roleId,
  });

  it('grants the role created earlier in the run', async () => {
    const g = fakeGuild();
    const r = await applySetup(
      db,
      g,
      [{ type: 'createRole', name: 'Studies Admin' }, sync(null)],
      snapshot,
    );
    expect(g.calls).toEqual([
      ['createRole', 'Studies Admin'],
      ['syncAdminPanelPerms', 'ch-a', 'role-new'],
    ]);
    expect(r.updated).toEqual([
      'kanał #admin-panel: uprawnienia dla roli admina',
    ]);
    expect(r.failures).toEqual([]);
  });

  it('grants an existing role by id', async () => {
    const g = fakeGuild();
    await applySetup(db, g, [sync('r2')], snapshot);
    expect(g.calls).toEqual([['syncAdminPanelPerms', 'ch-a', 'r2']]);
  });

  it('fails when the role was not created', async () => {
    const g = fakeGuild();
    const r = await applySetup(db, g, [sync(null)], snapshot);
    expect(g.calls).toEqual([]);
    expect(r.failures).toEqual(['#admin-panel: brak roli admina']);
  });

  it('re-grants a kept #admin-panel after the admin role was replaced', async () => {
    await setSetting(db, 'admin_role_id', 'r-old');
    await setSetting(db, 'admin_panel_channel_id', 'ch-a');
    const g = fakeGuild();
    const snap: GuildSnapshot = {
      ...snapshot,
      textChannels: [
        {
          id: 'ch-a',
          name: 'admin-panel',
          parentId: null,
          everyoneCanView: false,
          viewRoleIds: ['r-old'],
        },
      ],
      ...(await loadPanelSettings(db)),
    };
    const actions = planSetup(
      [],
      snap,
      { name: 'Studies Admin', storedId: 'r-old' },
      () => '',
    );
    const r = await applySetup(db, g, actions, snap);
    expect(g.calls).toContainEqual(['syncAdminPanelPerms', 'ch-a', 'role-new']);
    expect(r.updated).toContain(
      'kanał #admin-panel: uprawnienia dla roli admina',
    );
  });
});

describe('formatPlan: #admin-panel permissions', () => {
  it('lists the permission sync in a dry run', () => {
    expect(
      formatPlan([
        { type: 'syncAdminPanelPerms', channelId: 'c', roleId: null },
      ]),
    ).toContain('ustaw uprawnienia #admin-panel dla roli admina');
  });
});

describe('formatPlan: panels', () => {
  it('lists the panel actions in a dry run', () => {
    const text = formatPlan([
      {
        type: 'ensurePanelChannel',
        which: 'admin',
        name: 'admin-panel',
        existingId: null,
        parentId: null,
      },
      {
        type: 'ensurePanelMessage',
        which: 'admin',
        channelId: null,
        messageId: null,
      },
      {
        type: 'ensurePanelMessage',
        which: 'panel',
        channelId: 'c',
        messageId: 'm',
      },
    ]);
    expect(text).toContain('utwórz kanał #admin-panel');
    expect(text).toContain('opublikuj panel w #admin-panel');
    expect(text).toContain('odśwież panel w #panel');
  });
});
