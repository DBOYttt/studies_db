import {
  adminAudit,
  classes,
  classLecturers,
  type Db,
  insertMaterial,
  jobs,
  lecturers,
  setSetting,
  subjects,
  topics,
  users,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { Collection, MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInteractionHandler,
  type RouterDeps,
} from '../src/commands/router.js';
import { withSetupLock } from '../src/ops.js';

// biome-ignore lint/suspicious/noExplicitAny: walking raw component JSON
type Json = any;

let db: Db;
let pool: RouterDeps['pool'];

beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
  pool = (db as unknown as { $client: RouterDeps['pool'] }).$client;
  clientUsers.fetch.mockClear();
  await setSetting(db, 'admin_role_id', 'r');
  await db.insert(subjects).values({
    code: 'ASD',
    name: 'Algorytmy',
    semester: 1,
    ects: 5,
    description: 'Opis',
  });
});
afterAll(async () => {
  await closeTestDb(db);
});

const config = {
  adminRoleName: 'Studies Admin',
  webBaseUrl: 'https://x.pl',
} as never;

const discordUser = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  username: id,
  globalName: null,
  displayAvatarURL: () => 'a',
  send: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const clientUsers = { fetch: vi.fn(async (id: string) => discordUser(id)) };
const handler = (client: object = { users: clientUsers }) =>
  createInteractionHandler({
    ingest: { db, storageDir: '', fetchBody: vi.fn() },
    client: client as never,
    config,
    pool,
  });

type Kind = 'button' | 'select' | 'userSelect' | 'modal';

/** A fake component/modal interaction recording its responses in order. */
function interaction(
  customId: string,
  over: {
    kind?: Kind;
    admin?: boolean;
    ephemeral?: boolean;
    values?: string[];
    fields?: Record<string, string>;
    selects?: Record<string, string[]>;
    userId?: string;
    guild?: unknown;
  } = {},
) {
  const kind = over.kind ?? 'button';
  const calls: string[] = [];
  const i: Json = {
    customId,
    values: over.values,
    user: discordUser(over.userId ?? '1000'),
    member: { roles: over.admin === false ? [] : ['r'] },
    guild: over.guild ?? null,
    message: {
      flags: {
        has: (f: number) =>
          f === MessageFlags.Ephemeral && over.ephemeral !== false,
      },
    },
    deferred: false,
    replied: false,
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select',
    isUserSelectMenu: () => kind === 'userSelect',
    isModalSubmit: () => kind === 'modal',
    isRepliable: () => true,
    fields: {
      getTextInputValue: (id: string) => {
        const v = over.fields?.[id];
        if (v === undefined) throw new Error(`no field ${id}`);
        return v;
      },
      getStringSelectValues: (id: string) => over.selects?.[id] ?? [],
    },
    users: new Collection(
      (over.values ?? []).map((v) => [v, discordUser(v)] as const),
    ),
    members: new Collection(),
    calls,
  };
  const rec = (name: string, after?: () => void) =>
    vi.fn(async () => {
      calls.push(name);
      after?.();
    });
  i.reply = rec('reply', () => {
    i.replied = true;
  });
  i.deferReply = rec('deferReply', () => {
    i.deferred = true;
  });
  i.deferUpdate = rec('deferUpdate', () => {
    i.deferred = true;
  });
  i.editReply = rec('editReply');
  i.followUp = rec('followUp');
  i.showModal = rec('showModal');
  return i;
}

function nodes(payload: Json): Json[] {
  const out: Json[] = [];
  const walk = (c: Json) => {
    out.push(c);
    for (const child of c.components ?? []) walk(child);
    if (c.accessory) walk(c.accessory);
    if (c.component) walk(c.component);
  };
  for (const c of payload?.components ?? [])
    walk(typeof c.toJSON === 'function' ? c.toJSON() : c);
  return out;
}
const textOf = (payload: Json) =>
  nodes(payload)
    .filter((n) => typeof n.content === 'string')
    .map((n) => n.content)
    .join('\n');
const ids = (payload: Json) =>
  nodes(payload)
    .map((n) => n.custom_id)
    .filter(Boolean);
const lastEdit = (i: Json) => i.editReply.mock.calls.at(-1)[0];

const STALE = 'This panel is out of date. Open it again.';
const BUSY = '/setup is already running. Try again in a moment.';

const subjectFields = (over: Record<string, string> = {}) => ({
  name: 'Algorytmy',
  semester: '1',
  ects: '5',
  description: 'Opis',
  platform_url: '',
  ...over,
});

const auditRows = () => db.select().from(adminAudit);
const subject = async (code = 'ASD') =>
  (await db.select().from(subjects).where(eq(subjects.code, code)))[0];

describe('admin check', () => {
  it('a non-admin pressing banok gets "You do not have permission." and nothing changes', async () => {
    await db.insert(users).values({ discordUserId: '999', displayName: '999' });
    const i = interaction('v1:adm:user:banok:999', { admin: false });
    await handler()(i);
    expect(i.calls).toEqual(['reply']);
    const arg = i.reply.mock.calls[0][0];
    expect(textOf(arg)).toBe('You do not have permission.');
    expect(arg.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(arg.allowedMentions).toEqual({ parse: [] });
    const [v] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, '999'));
    expect(v.isBanned).toBe(false);
    expect(await auditRows()).toHaveLength(0);
    expect(clientUsers.fetch).not.toHaveBeenCalled();
  });

  it('refuses a non-admin before a modal opens', async () => {
    const i = interaction('v1:adm:subj:edit:ASD', { admin: false });
    await handler()(i);
    expect(i.calls).toEqual(['reply']);
    expect(textOf(i.reply.mock.calls[0][0])).toBe(
      'You do not have permission.',
    );
  });

  it('answers malformed admin ids as stale', async () => {
    for (const cid of [
      'v1:adm:nope',
      'v1:adm:class:edit:ASD:zzz',
      'v1:adm:user:banok:notanid',
      'v1:adm:lect:edit:0',
    ]) {
      const i = interaction(cid);
      await handler()(i);
      expect(i.calls).toEqual(['reply']);
      expect(textOf(i.reply.mock.calls[0][0])).toBe(STALE);
    }
  });
});

describe('subjects', () => {
  it('rejects ECTS 31 with the Polish message and changes nothing', async () => {
    const i = interaction('v1:adm:subj:save:ASD', {
      kind: 'modal',
      fields: subjectFields({ name: 'Nowa nazwa', ects: '31' }),
    });
    await handler()(i);
    expect(i.calls).toEqual(['reply']);
    const arg = i.reply.mock.calls[0][0];
    expect(textOf(arg)).toBe('ECTS must be a number from 0 to 30.');
    expect(arg.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(await subject()).toMatchObject({ name: 'Algorytmy', ects: 5 });
    expect(await auditRows()).toHaveLength(0);
  });

  it('rejects semester 3', async () => {
    const i = interaction('v1:adm:subj:save:ASD', {
      kind: 'modal',
      fields: subjectFields({ semester: '3' }),
    });
    await handler()(i);
    expect(textOf(i.reply.mock.calls[0][0])).toBe('Semester must be 1 or 2.');
  });

  it('saves an edit, audits subject.edit once and re-renders the card', async () => {
    const i = interaction('v1:adm:subj:save:ASD', {
      kind: 'modal',
      fields: subjectFields({ name: 'Algorytmy 2', ects: '6' }),
    });
    await handler()(i);
    expect(i.calls).toEqual(['deferUpdate', 'editReply']);
    expect(await subject()).toMatchObject({
      name: 'Algorytmy 2',
      ects: 6,
      semester: 1,
      description: 'Opis',
    });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'subject.edit', target: 'ASD' });
    expect(rows[0].details).toEqual({
      fields: ['name', 'ects'],
      source: 'discord',
    });
    const view = lastEdit(i);
    expect(view.allowedMentions).toEqual({ parse: [] });
    expect(textOf(view)).toContain('Algorytmy 2');
  });

  it('keeps a long description when its clipped prefill comes back unchanged', async () => {
    const long = `${'a'.repeat(999)}😀tail`;
    await db
      .update(subjects)
      .set({ description: long })
      .where(eq(subjects.code, 'ASD'));
    // The prefill stops before the emoji (it would end past 1000 units).
    const i = interaction('v1:adm:subj:save:ASD', {
      kind: 'modal',
      fields: subjectFields({ name: 'Inna', description: 'a'.repeat(999) }),
    });
    await handler()(i);
    expect((await subject()).description).toBe(long);
    expect((await auditRows())[0].details).toEqual({
      fields: ['name'],
      source: 'discord',
    });
  });

  it('treats a CRLF description that comes back with LF as unchanged', async () => {
    await db
      .update(subjects)
      .set({ description: 'Linia 1\r\nLinia 2\rLinia 3' })
      .where(eq(subjects.code, 'ASD'));
    const i = interaction('v1:adm:subj:save:ASD', {
      kind: 'modal',
      fields: subjectFields({
        name: 'Inna',
        description: 'Linia 1\nLinia 2\nLinia 3',
      }),
    });
    await handler()(i);
    expect((await subject()).description).toBe('Linia 1\r\nLinia 2\rLinia 3');
    expect((await auditRows())[0].details).toEqual({
      fields: ['name'],
      source: 'discord',
    });
  });

  it('clears the description when it is emptied', async () => {
    const i = interaction('v1:adm:subj:save:ASD', {
      kind: 'modal',
      fields: subjectFields({ description: '' }),
    });
    await handler()(i);
    expect((await subject()).description).toBeNull();
  });

  it('writes nothing when nothing changed', async () => {
    const i = interaction('v1:adm:subj:save:ASD', {
      kind: 'modal',
      fields: subjectFields(),
    });
    await handler()(i);
    expect(await auditRows()).toHaveLength(0);
    expect(textOf(lastEdit(i))).toContain('Algorytmy');
  });

  it('shows a refused edit privately and keeps the card', async () => {
    const i = interaction('v1:adm:subj:save:ASD', {
      kind: 'modal',
      fields: subjectFields({ platform_url: 'nie-url' }),
    });
    await handler()(i);
    expect(i.calls).toEqual(['deferUpdate', 'followUp']);
    expect(textOf(i.followUp.mock.calls[0][0])).toBe('Invalid URL.');
    expect(await auditRows()).toHaveLength(0);
  });

  it('adds a subject, audits subject.add and offers /setup', async () => {
    const i = interaction('v1:adm:subj:save:new', {
      kind: 'modal',
      fields: {
        name: 'Bazy danych',
        code: 'bd-1',
        semester: '2',
        ects: '4',
        description: '',
      },
    });
    await handler()(i);
    expect(await subject('BD-1')).toMatchObject({
      name: 'Bazy danych',
      semester: 2,
      ects: 4,
      description: null,
      discordChannelId: null,
    });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'subject.add', target: 'BD-1' });
    const view = lastEdit(i);
    expect(ids(view)).toContain('v1:adm:setup:ask');
    expect(textOf(view)).toContain('Added subject BD-1');
  });

  it('rejects a new code with characters that cannot go into an id', async () => {
    const i = interaction('v1:adm:subj:save:new', {
      kind: 'modal',
      fields: {
        name: 'X',
        code: 'A:B',
        semester: '1',
        ects: '1',
        description: '',
      },
    });
    await handler()(i);
    expect(i.calls).toEqual(['reply']);
    expect(textOf(i.reply.mock.calls[0][0])).toBe(
      'The code may contain only letters, digits, dots, hyphens and underscores (up to 20 characters).',
    );
    expect(await db.select().from(subjects)).toHaveLength(1);
  });

  it('opens the edit modal as the first response, prefilled', async () => {
    const i = interaction('v1:adm:subj:edit:ASD');
    await handler()(i);
    expect(i.calls).toEqual(['showModal']);
    const modal = i.showModal.mock.calls[0][0].toJSON();
    expect(modal.custom_id).toBe('v1:adm:subj:save:ASD');
    const name = nodes(modal).find((n) => n.custom_id === 'name');
    expect(name.value).toBe('Algorytmy');
  });

  it('shows a notice for a subject whose code cannot be encoded', async () => {
    await db
      .insert(subjects)
      .values({ code: 'X:Y', name: 'Zły kod', semester: 1, ects: 1 });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const i = interaction('v1:adm:subj:pick', {
      kind: 'select',
      values: ['X:Y'],
    });
    await handler()(i);
    expect(textOf(lastEdit(i))).toContain('cannot be shown');
    err.mockRestore();
  });

  it('pages the subject list from the pinned panel with a new ephemeral reply', async () => {
    const i = interaction('v1:adm:subj:list:0', { ephemeral: false });
    await handler()(i);
    expect(i.calls).toEqual(['deferReply', 'editReply']);
    expect(i.deferReply.mock.calls[0][0].flags).toBe(MessageFlags.Ephemeral);
    expect(textOf(lastEdit(i))).toContain('1 in the database');
  });
});

describe('classes and lecturers', () => {
  it('assigns a lecturer to a group and audits lecturer.assign', async () => {
    const [l] = await db
      .insert(lecturers)
      .values({ name: 'Nowak', title: 'dr' })
      .$returningId();
    const i = interaction(`v1:adm:assign:grp:ASD:laboratorium:${l.id}`, {
      kind: 'select',
      values: ['2'],
    });
    await handler()(i);
    expect(await db.select().from(classLecturers)).toHaveLength(1);
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'lecturer.assign',
      target: 'ASD',
    });
    expect(rows[0].details).toMatchObject({
      lecturerId: l.id,
      classKind: 'laboratorium',
      groupNumber: 2,
      source: 'discord',
    });
    expect(textOf(lastEdit(i))).toContain('dr Nowak (Gr. 2)');
  });

  it('edits a class from its modal and audits class.edit', async () => {
    const [s] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.code, 'ASD'));
    await db
      .insert(classes)
      .values({ subjectId: s.id, kind: 'wyklad', name: 'Wykład' });
    const i = interaction('v1:adm:class:save:ASD:wyklad', {
      kind: 'modal',
      fields: { note: 'Egzamin pisemny', platform_url: '' },
      selects: { assessment: ['egzamin'] },
    });
    await handler()(i);
    const [c] = await db.select().from(classes);
    expect(c).toMatchObject({
      assessment: 'egzamin',
      assessmentNote: 'Egzamin pisemny',
    });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toEqual({
      kind: 'wyklad',
      fields: ['assessment', 'note'],
      source: 'discord',
    });
  });

  it('adds a lecturer, audits lecturer.add and shows the card', async () => {
    const i = interaction('v1:adm:lect:save:new', {
      kind: 'modal',
      fields: {
        name: 'Kowalska',
        title: 'prof.',
        email: '',
        office_hours: '',
        room: '101',
      },
    });
    await handler()(i);
    const [l] = await db.select().from(lecturers);
    expect(l).toMatchObject({
      name: 'Kowalska',
      title: 'prof.',
      email: null,
      room: '101',
    });
    const rows = await auditRows();
    expect(rows[0]).toMatchObject({
      action: 'lecturer.add',
      target: String(l.id),
    });
    expect(textOf(lastEdit(i))).toContain('prof. Kowalska');
  });
});

describe('users', () => {
  it('refuses to ban yourself', async () => {
    const i = interaction('v1:adm:user:banok:1000');
    await handler()(i);
    expect(i.calls).toEqual(['reply']);
    expect(textOf(i.reply.mock.calls[0][0])).toBe('You cannot block yourself.');
    const [me] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, '1000'));
    expect(me.isBanned).toBe(false);
    expect(await auditRows()).toHaveLength(0);
  });

  it('bans a never-seen user after upserting them, and audits user.ban', async () => {
    const i = interaction('v1:adm:user:banok:12345');
    await handler()(i);
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, '12345'));
    expect(u.isBanned).toBe(true);
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'user.ban', target: '12345' });
    expect(rows[0].details).toEqual({ source: 'discord' });
    const view = lastEdit(i);
    expect(view.allowedMentions).toEqual({ parse: [] });
    expect(ids(view)).toContain('v1:adm:user:unban:12345');
  });

  it('unbans and audits user.unban', async () => {
    await db
      .insert(users)
      .values({ discordUserId: '777', displayName: 'x', isBanned: true });
    const i = interaction('v1:adm:user:unbanok:777');
    await handler()(i);
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, '777'));
    expect(u.isBanned).toBe(false);
    expect((await auditRows())[0]).toMatchObject({ action: 'user.unban' });
  });

  it('shows a picked user who never used the bot', async () => {
    const i = interaction('v1:adm:user:pick', {
      kind: 'userSelect',
      values: ['555'],
    });
    await handler()(i);
    const text = textOf(lastEdit(i));
    expect(text).toContain('## 555');
    expect(text).toContain('has not used the bot yet');
  });
});

describe('status, setup and web', () => {
  it('shows plan status, job counts and pending materials', async () => {
    const [s] = await db.select().from(subjects);
    const [u] = await db
      .insert(users)
      .values({ discordUserId: 'up', displayName: 'up' })
      .$returningId();
    const [t] = await db
      .insert(topics)
      .values({ subjectId: s.id, discordThreadId: 't1', title: 'T' })
      .$returningId();
    await insertMaterial(
      db,
      {
        topicId: t.id,
        uploaderId: u.id,
        discordMessageId: 'm',
        discordAttachmentId: 'a1',
        originalFilename: 'x.docx',
        mimeType: 'application/msword',
        sizeBytes: 1,
        sha256: 'f'.repeat(64),
        storagePath: 'x',
        previewKind: 'pdf',
      },
      ['convert', 'extract_text'],
    );
    await db
      .update(jobs)
      .set({ status: 'failed' })
      .where(eq(jobs.type, 'convert'));
    const i = interaction('v1:adm:status', { ephemeral: false });
    await handler()(i);
    const text = textOf(lastEdit(i));
    expect(text).toContain('Never synced.');
    expect(text).toContain('Queued: 1 · Running: 0 · Failed: 1');
    expect(text).toContain('**Materials being processed**\n1');
  });

  it('plan sync audits plan.sync', async () => {
    const i = interaction('v1:adm:plan:sync');
    await handler()(i);
    expect(textOf(lastEdit(i))).toContain('Timetable sync requested');
    expect((await auditRows())[0]).toMatchObject({ action: 'plan.sync' });
  });

  it('setup run while the lock is held gives the busy text', async () => {
    let release = () => {};
    const held = withSetupLock(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const i = interaction('v1:adm:setup:run', { guild: {} });
    await handler()(i);
    release();
    await held;
    expect(i.calls).toEqual(['deferUpdate', 'editReply', 'editReply']);
    expect(textOf(i.editReply.mock.calls[0][0])).toBe('Working…');
    expect(textOf(lastEdit(i))).toBe(BUSY);
    expect(await auditRows()).toHaveLength(0);
  });

  it('setup dry run shows the plan in a report and audits it', async () => {
    const guild = {
      client: { user: { id: 'bot' } },
      roles: {
        cache: new Collection([['r', { id: 'r', name: 'Studies Admin' }]]),
        fetch: async () =>
          new Collection([['r', { id: 'r', name: 'Studies Admin' }]]),
      },
      channels: { fetch: async () => new Collection() },
      members: {
        me: { id: 'bot' },
        fetch: async () => ({
          roles: { cache: new Collection([['r', {}]]) },
        }),
      },
    };
    const i = interaction('v1:adm:setup:dry', { guild });
    await handler()(i);
    expect(textOf(i.editReply.mock.calls[0][0])).toBe('Working…');
    const text = textOf(lastEdit(i));
    expect(text).toContain('/setup preview');
    expect(text).toContain('Plan (no changes made):');
    expect(ids(lastEdit(i))).toContain('v1:adm:status');
    expect((await auditRows())[0]).toMatchObject({
      action: 'bot.setup_dry_run',
    });
  });

  it('Panel www DMs a login link with next=/admin', async () => {
    const i = interaction('v1:adm:web', { ephemeral: false });
    await handler()(i);
    expect(i.calls).toEqual(['deferReply', 'editReply']);
    const dm = i.user.send.mock.calls[0][0].content;
    expect(dm).toMatch(/token=[^&>]+&next=%2Fadmin>/);
    expect(textOf(lastEdit(i))).toBe(
      'I sent you the link in a direct message.',
    );
  });
});

describe('/admin', () => {
  const command = (roles: string[]) => {
    const i: Json = {
      commandName: 'admin',
      user: discordUser('1000'),
      member: { roles },
      deferred: false,
      replied: false,
      isAutocomplete: () => false,
      isChatInputCommand: () => true,
      isRepliable: () => true,
      reply: vi.fn().mockResolvedValue(undefined),
    };
    return i;
  };

  it('gives an admin the ephemeral admin panel', async () => {
    const i = command(['r']);
    await handler()(i);
    const arg = i.reply.mock.calls[0][0];
    expect(arg.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(arg.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(arg.allowedMentions).toEqual({ parse: [] });
    expect(ids(arg)).toEqual([
      'v1:adm:status',
      'v1:adm:subj:list:0',
      'v1:adm:lect:list:0',
      'v1:adm:user:open',
      'v1:adm:web',
    ]);
  });

  it('refuses a non-admin', async () => {
    const i = command([]);
    await handler()(i);
    expect(i.reply.mock.calls[0][0].content).toBe(
      'You do not have permission.',
    );
  });
});
