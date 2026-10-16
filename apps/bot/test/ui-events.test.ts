import {
  adminAudit,
  BANNED_MESSAGE,
  botRequests,
  classes,
  classGroups,
  type Db,
  events,
  eventTopics,
  subjects,
  topics,
  users,
  WHEN_FORMAT_MESSAGE,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInteractionHandler,
  type RouterDeps,
} from '../src/commands/router.js';

// biome-ignore lint/suspicious/noExplicitAny: walking raw component JSON
type Json = any;

let db: Db;
let pool: RouterDeps['pool'];
let subjectId: number;

beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
  pool = (db as unknown as { $client: RouterDeps['pool'] }).$client;
  const [r] = await db
    .insert(subjects)
    .values({ code: 'ASD', name: 'Algorytmy', semester: 1, ects: 5 });
  subjectId = r.insertId;
});
afterAll(async () => {
  await closeTestDb(db);
});

const config = {
  adminRoleName: 'Studies Admin',
  webBaseUrl: 'https://x.pl',
  discordGuildId: 'G1',
} as never;

const handler = () =>
  createInteractionHandler({
    ingest: { db, storageDir: '', fetchBody: vi.fn() },
    client: {} as never,
    config,
    pool,
  });

const discordUser = (id: string) => ({
  id,
  username: id,
  globalName: null,
  displayAvatarURL: () => 'a',
  send: vi.fn(),
});

type Kind = 'button' | 'select' | 'modal';

function interaction(
  customId: string,
  over: {
    kind?: Kind;
    ephemeral?: boolean;
    values?: string[];
    fields?: Record<string, string>;
    selects?: Record<string, string[]>;
  } = {},
) {
  const kind = over.kind ?? 'button';
  const calls: string[] = [];
  const i: Json = {
    customId,
    values: over.values,
    user: discordUser('1000'),
    member: { roles: [] },
    guild: null,
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
    isUserSelectMenu: () => false,
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
    calls,
  };
  const rec = (name: string) => vi.fn(async () => void calls.push(name));
  i.reply = rec('reply');
  i.deferReply = rec('deferReply');
  i.deferUpdate = rec('deferUpdate');
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
const lastEdit = (i: Json) => i.editReply.mock.calls.at(-1)[0];

const fields = (over: Record<string, string> = {}) => ({
  title: 'Kolokwium z pętli',
  when: '20.10.2026 10:00-11:30',
  place_note: 'Aula 1\nPrzynieść kartkę',
  ...over,
});
const selects = (over: Record<string, string[]> = {}) => ({
  kind: ['kolokwium'],
  subject: ['ASD'],
  ...over,
});

const save = (id: string, f = fields(), s = selects(), eph = false) =>
  interaction(`v1:evt:save:${id}`, {
    kind: 'modal',
    fields: f,
    selects: s,
    ephemeral: eph,
  });
const user = async () => (await db.select().from(users))[0];
const upserts = () =>
  db
    .select()
    .from(botRequests)
    .where(eq(botRequests.kind, 'event_post_upsert'));

describe('evt:new', () => {
  it('opens the modal with five components', async () => {
    const i = interaction('v1:evt:new', { ephemeral: false });
    await handler()(i);
    expect(i.calls).toEqual(['showModal']);
    const m = i.showModal.mock.calls[0][0].toJSON();
    expect(m.custom_id).toBe('v1:evt:save:new');
    expect(m.components).toHaveLength(5);
  });

  it('refuses a banned user', async () => {
    await db
      .insert(users)
      .values({ discordUserId: '1000', displayName: 'x', isBanned: true });
    const i = interaction('v1:evt:new');
    await handler()(i);
    expect(i.calls).toEqual(['reply']);
    expect(textOf(i.reply.mock.calls[0][0])).toBe(BANNED_MESSAGE);
    expect(i.showModal).not.toHaveBeenCalled();
  });
});

describe('evt:save', () => {
  it('adds an event: audit with source discord, a post upsert, the card', async () => {
    const i = save('new');
    await handler()(i);
    expect(i.calls).toEqual(['deferReply', 'editReply']);
    const [e] = await db.select().from(events);
    expect(e).toMatchObject({
      kind: 'kolokwium',
      title: 'Kolokwium z pętli',
      subjectId,
      place: 'Aula 1',
      note: 'Przynieść kartkę',
    });
    const [a] = await db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.action, 'event.add'));
    expect(a.target).toBe(String(e.id));
    expect(a.userId).toBe((await user()).id);
    expect(JSON.stringify(a.details)).toContain('"source":"discord"');
    expect(await upserts()).toHaveLength(1);
    const t = textOf(lastEdit(i));
    expect(t).toContain('Kolokwium z pętli');
    expect(t).toContain('ASD');
    expect(lastEdit(i).allowedMentions).toEqual({ parse: [] });
  });

  it('an event without a subject', async () => {
    const i = save('new', fields(), selects({ subject: ['-'] }));
    await handler()(i);
    const [e] = await db.select().from(events);
    expect(e.subjectId).toBeNull();
  });

  it('an invalid "Kiedy" answers with the parseWhen message and adds nothing', async () => {
    const i = save('new', fields({ when: 'jutro' }));
    await handler()(i);
    expect(textOf(lastEdit(i))).toBe(WHEN_FORMAT_MESSAGE);
    expect(await db.select().from(events)).toHaveLength(0);
    expect(await upserts()).toHaveLength(0);
  });

  it('a banned user is refused and nothing is written', async () => {
    await db
      .insert(users)
      .values({ discordUserId: '1000', displayName: 'x', isBanned: true });
    const i = save('new');
    await handler()(i);
    expect(textOf(i.reply.mock.calls[0][0])).toBe(BANNED_MESSAGE);
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('edits in place and audits event.edit', async () => {
    await handler()(save('new'));
    const [e] = await db.select().from(events);
    const i = save(
      String(e.id),
      fields({ title: 'Nowy tytuł' }),
      selects(),
      true,
    );
    await handler()(i);
    expect(i.calls).toEqual(['deferUpdate', 'editReply']);
    expect(textOf(lastEdit(i))).toContain('Nowy tytuł');
    const [after] = await db.select().from(events);
    expect(after.title).toBe('Nowy tytuł');
    const rows = await db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.action, 'event.edit'));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].details)).toContain('discord');
  });

  it('an edit error keeps the card (follow-up)', async () => {
    await handler()(save('new'));
    const [e] = await db.select().from(events);
    const i = save(String(e.id), fields({ when: 'x' }), selects(), true);
    await handler()(i);
    expect(i.calls).toEqual(['deferUpdate', 'followUp']);
  });
});

describe('card actions', () => {
  let id: number;
  beforeEach(async () => {
    await handler()(save('new'));
    id = (await db.select().from(events))[0].id;
  });

  it('opens a card from a plan select as a new reply', async () => {
    const i = interaction('v1:evt:open', {
      kind: 'select',
      values: [String(id)],
    });
    await handler()(i);
    expect(i.calls).toEqual(['deferReply', 'editReply']);
    expect(textOf(lastEdit(i))).toContain('Kolokwium z pętli');
  });

  it('a deleted event shows "Wydarzenie usunięte"', async () => {
    await db.update(events).set({ deletedAt: new Date() });
    const i = interaction(`v1:evt:show:${id}`);
    await handler()(i);
    expect(textOf(lastEdit(i))).toBe('Wydarzenie usunięte');
  });

  it('sets class and group', async () => {
    const [c] = await db
      .insert(classes)
      .values({ subjectId, kind: 'laboratorium', name: 'Laboratorium' });
    const [g] = await db
      .insert(classGroups)
      .values({ classId: c.insertId, number: 2, name: 'Gr. 2' });
    const open = interaction(`v1:evt:grp:${id}`);
    await handler()(open);
    expect(
      nodes(lastEdit(open)).find((n) => n.type === 3).options,
    ).toHaveLength(3);
    const set = interaction(`v1:evt:grp:${id}`, {
      kind: 'select',
      values: [`g${g.insertId}`],
    });
    await handler()(set);
    const [e] = await db.select().from(events);
    expect(e.groupId).toBe(g.insertId);
    expect(e.classId).toBe(c.insertId);
    expect(textOf(lastEdit(set))).toContain('Laboratorium · Gr. 2');
  });

  it('toggles a linked post', async () => {
    const [t] = await db.insert(topics).values({
      subjectId,
      title: 'Zadania',
      discordThreadId: 'T1',
      authorDiscordId: 'a',
    } as never);
    const link = interaction(`v1:evt:link:${id}:0`, {
      kind: 'select',
      values: [String(t.insertId)],
    });
    await handler()(link);
    expect(await db.select().from(eventTopics)).toHaveLength(1);
    expect(
      nodes(lastEdit(link)).find((n) => n.type === 3).options[0].label,
    ).toBe('✓ Zadania');
    const again = interaction(`v1:evt:link:${id}:0`, {
      kind: 'select',
      values: [String(t.insertId)],
    });
    await handler()(again);
    expect(await db.select().from(eventTopics)).toHaveLength(0);
  });

  it('deletes after the confirmation', async () => {
    const ask = interaction(`v1:evt:del:${id}`);
    await handler()(ask);
    expect(
      nodes(lastEdit(ask)).some((n) => n.custom_id === `v1:evt:delok:${id}`),
    ).toBe(true);
    expect((await db.select().from(events))[0].deletedAt).toBeNull();
    const ok = interaction(`v1:evt:delok:${id}`);
    await handler()(ok);
    expect(textOf(lastEdit(ok))).toBe('Wydarzenie usunięte');
    expect((await db.select().from(events))[0].deletedAt).not.toBeNull();
  });

  it('a stale id is answered as stale', async () => {
    const i = interaction('v1:evt:nope:1');
    await handler()(i);
    expect(textOf(i.reply.mock.calls[0][0])).toContain('nieaktualny');
  });
});

/* ---------- /event add ---------- */

function slash(opts: Record<string, string | number>) {
  const i: Json = {
    commandName: 'event',
    user: discordUser('1000'),
    member: { roles: [] },
    deferred: false,
    replied: false,
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    isRepliable: () => true,
    options: {
      getSubcommand: () => 'add',
      getString: (n: string, req?: boolean) => {
        const v = opts[n];
        if (v === undefined && req) throw new Error(`missing ${n}`);
        return (v as string | undefined) ?? null;
      },
      getInteger: (n: string) => (opts[n] as number | undefined) ?? null,
    },
    reply: vi.fn(async () => {}),
    deferReply: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}),
  };
  return i;
}

describe('/event add', () => {
  const base = { kind: 'egzamin', title: 'Egzamin', when: '25.10.2026 09:00' };

  it('rejects repeat and until until Phase 2', async () => {
    for (const extra of [{ repeat: 'weekly' }, { until: '01.12' }] as Record<
      string,
      string
    >[]) {
      const i = slash({ ...base, ...extra });
      await handler()(i);
      expect(i.reply.mock.calls[0][0].content).toBe(
        'Powtarzanie będzie dostępne wkrótce',
      );
    }
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('adds an event with subject, class and group', async () => {
    const [c] = await db
      .insert(classes)
      .values({ subjectId, kind: 'cwiczenia', name: 'Ćwiczenia' });
    const [g] = await db
      .insert(classGroups)
      .values({ classId: c.insertId, number: 3, name: 'Gr. 3' });
    const i = slash({
      ...base,
      subject: 'asd',
      class: 'cwiczenia',
      group: 3,
      place: 'B2',
      note: 'nota',
    });
    await handler()(i);
    const [e] = await db.select().from(events);
    expect(e).toMatchObject({
      kind: 'egzamin',
      subjectId,
      classId: c.insertId,
      groupId: g.insertId,
      place: 'B2',
      note: 'nota',
    });
    expect(textOf(i.editReply.mock.calls[0][0])).toContain('Egzamin');
    const [a] = await db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.action, 'event.add'));
    expect(JSON.stringify(a.details)).toContain('discord');
  });

  it('says so for an unknown subject, and for a bad "when"', async () => {
    const a = slash({ ...base, subject: 'ZZZ' });
    await handler()(a);
    expect(a.reply.mock.calls[0][0].content).toContain('ZZZ');
    const b = slash({ ...base, when: 'x' });
    await handler()(b);
    expect(b.editReply.mock.calls[0][0].content).toBe(WHEN_FORMAT_MESSAGE);
  });

  it('refuses a banned user', async () => {
    await db
      .insert(users)
      .values({ discordUserId: '1000', displayName: 'x', isBanned: true });
    const i = slash(base);
    await handler()(i);
    expect(i.editReply.mock.calls[0][0].content).toBe(BANNED_MESSAGE);
    expect(await db.select().from(events)).toHaveLength(0);
  });
});
