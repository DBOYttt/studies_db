import {
  adminAudit,
  BANNED_MESSAGE,
  botRequests,
  classes,
  classGroups,
  classSessions,
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
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEventAdd } from '../src/commands/event.js';
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

  it('an invalid "When" answers with the parseWhen message and adds nothing', async () => {
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
    expect(textOf(lastEdit(i))).toBe(BANNED_MESSAGE);
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

  it('a deleted event shows "Event deleted"', async () => {
    await db.update(events).set({ deletedAt: new Date() });
    const i = interaction(`v1:evt:show:${id}`);
    await handler()(i);
    expect(textOf(lastEdit(i))).toBe('Event deleted');
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
      nodes(lastEdit(ask)).some(
        (n) => n.custom_id === `v1:evt:delok:${id}:one:v0`,
      ),
    ).toBe(true);
    expect((await db.select().from(events))[0].deletedAt).toBeNull();
    const ok = interaction(`v1:evt:delok:${id}:one:v0`);
    await handler()(ok);
    expect(textOf(lastEdit(ok))).toBe('Event deleted');
    expect((await db.select().from(events))[0].deletedAt).not.toBeNull();
  });

  it('a stale id is answered as stale', async () => {
    const i = interaction('v1:evt:nope:1');
    await handler()(i);
    expect(textOf(i.reply.mock.calls[0][0])).toContain('out of date');
  });
});

describe('edit round trip', () => {
  const insertEvent = async (over: Record<string, unknown>) => {
    const [r] = await db.insert(events).values({
      kind: 'inne',
      title: 'Stare',
      subjectId,
      startsAt: new Date('2026-10-20T10:00:00Z'),
      endsAt: new Date('2026-10-20T11:00:00Z'),
      allDay: false,
      ...over,
    } as never);
    return r.insertId;
  };
  const editAudits = () =>
    db.select().from(adminAudit).where(eq(adminAudit.action, 'event.edit'));

  it('an unchanged submit of an event with a note and no place changes nothing', async () => {
    const id = await insertEvent({
      place: null,
      note: 'Pierwsza linia\nDruga',
    });
    const open = interaction(`v1:evt:edit:${id}`);
    await handler()(open);
    const m = open.showModal.mock.calls[0][0].toJSON();
    const prefilled = m.components[4].component.value;
    expect(prefilled).toBe('\nPierwsza linia\nDruga');
    const i = save(
      String(id),
      {
        title: 'Stare',
        when: m.components[3].component.value,
        place_note: prefilled,
      },
      selects({ kind: ['inne'] }),
      true,
    );
    await handler()(i);
    const [e] = await db.select().from(events);
    expect(e.place).toBeNull();
    expect(e.note).toBe('Pierwsza linia\nDruga');
    expect(await editAudits()).toHaveLength(0);
    // The event has no post yet: saving unchanged only retries the post.
    expect(await upserts()).toHaveLength(1);
  });

  it('an event older than a month can be edited (only the title changes)', async () => {
    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 45);
    old.setUTCHours(9, 0, 0, 0);
    const id = await insertEvent({
      startsAt: old,
      endsAt: new Date(old.getTime() + 3_600_000),
    });
    const open = interaction(`v1:evt:edit:${id}`);
    await handler()(open);
    const m = open.showModal.mock.calls[0][0].toJSON();
    const i = save(
      String(id),
      {
        title: 'Nowe',
        when: m.components[3].component.value,
        place_note: '',
      },
      selects({ kind: ['inne'] }),
      true,
    );
    await handler()(i);
    expect((await db.select().from(events))[0].title).toBe('Nowe');
    expect(await editAudits()).toHaveLength(1);
    expect(i.calls).toEqual(['deferUpdate', 'editReply']);
  });

  it('reads the subject from a text field when that is what was submitted', async () => {
    const i = save('new', fields(), { kind: ['inne'], subject: [] });
    i.fields.getTextInputValue = (id: string) => {
      const v: Record<string, string> = { ...fields(), subject: 'asd' };
      if (!(id in v)) throw new Error(id);
      return v[id];
    };
    await handler()(i);
    expect((await db.select().from(events))[0].subjectId).toBe(subjectId);
  });
});

describe('acknowledges before any database work', () => {
  it('a button', async () => {
    const i = interaction('v1:evt:link:1', { ephemeral: true });
    let usersAtAck = -1;
    i.deferUpdate = vi.fn(async () => {
      usersAtAck = (await db.select().from(users)).length;
    });
    await handler()(i);
    expect(usersAtAck).toBe(0);
  });

  it('a modal submit', async () => {
    const i = save('new');
    let at = -1;
    i.deferReply = vi.fn(async () => {
      at = (await db.select().from(users)).length;
    });
    await handler()(i);
    expect(at).toBe(0);
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it('/event add', async () => {
    const i = slash({
      kind: 'egzamin',
      title: 'Egzamin',
      when: '25.10.2026 09:00',
    });
    let at = [-1, -1];
    i.deferReply = vi.fn(async () => {
      at = [
        (await db.select().from(users)).length,
        (await db.select().from(events)).length,
      ];
    });
    await runEventAdd({ ingest: { db }, config, pool } as never, i, undefined, {
      discordUserId: '1000',
      displayName: 'x',
      avatarUrl: null,
    } as never);
    expect(at).toEqual([0, 0]);
    expect(await db.select().from(events)).toHaveLength(1);
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

  it('adds a weekly series and shows the first occurrence card', async () => {
    const i = slash({
      ...base,
      title: 'Konsultacje',
      repeat: 'weekly',
      until: '08.11.2026',
      subject: 'asd',
    });
    await handler()(i);
    const rows = await db.select().from(events);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((e) => e.seriesId)).size).toBe(1);
    expect(textOf(i.editReply.mock.calls[0][0])).toContain(
      'Part of a series: every week',
    );
    const reqs = await db.select().from(botRequests);
    expect(reqs.map((r) => r.target)).toEqual([`series:${rows[0].seriesId}`]);
  });

  it('asks for the missing half of repeat/until', async () => {
    const a = slash({ ...base, repeat: 'weekly' });
    await handler()(a);
    expect(a.editReply.mock.calls[0][0].content).toContain('until');
    const b = slash({ ...base, until: '01.12.2026' });
    await handler()(b);
    expect(b.editReply.mock.calls[0][0].content).toContain('repeat');
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
    expect(a.editReply.mock.calls[0][0].content).toContain('ZZZ');
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

describe('series scope', () => {
  const mkSeries = async () => {
    const i = slash({
      kind: 'egzamin',
      title: 'Konsultacje',
      when: '25.10.2026 09:00',
      repeat: 'weekly',
      until: '08.11.2026',
    });
    await handler()(i);
    return (await db.select().from(events).orderBy(events.startsAt)).map(
      (e) => e.id,
    );
  };
  const buttons = (p: Json) =>
    nodes(p)
      .filter((n) => n.type === 2)
      .map((b) => b.custom_id);

  it('Edytuj and Usuń on an occurrence ask Tylko to / To i następne first', async () => {
    const [id] = await mkSeries();
    for (const action of ['edit', 'del']) {
      const i = interaction(`v1:evt:${action}:${id}`);
      await handler()(i);
      expect(i.calls).toEqual(['deferUpdate', 'editReply']);
      expect(i.showModal).not.toHaveBeenCalled();
      expect(buttons(lastEdit(i))).toEqual([
        `v1:evt:${action}:${id}:one`,
        `v1:evt:${action}:${id}:following`,
        `v1:evt:show:${id}`,
      ]);
    }
  });

  it('a plain event goes straight to the modal / confirm', async () => {
    const i = slash({ kind: 'egzamin', title: 'X', when: '25.10.2026 09:00' });
    await handler()(i);
    const [e] = await db.select().from(events);
    const edit = interaction(`v1:evt:edit:${e.id}`);
    await handler()(edit);
    expect(edit.calls).toEqual(['showModal']);
    expect(edit.showModal.mock.calls[0][0].toJSON().custom_id).toBe(
      `v1:evt:save:${e.id}:one:v${e.version}`,
    );
    const del = interaction(`v1:evt:del:${e.id}`);
    await handler()(del);
    expect(buttons(lastEdit(del))).toContain(
      `v1:evt:delok:${e.id}:one:v${e.version}`,
    );
  });

  it('edit with a scope opens the modal that saves with the scope', async () => {
    const [, second, third] = await mkSeries();
    const open = interaction(`v1:evt:edit:${second}:following`);
    await handler()(open);
    const m = open.showModal.mock.calls[0][0].toJSON();
    expect(m.custom_id).toMatch(
      new RegExp(`^v1:evt:save:${second}:following:v\\d+$`),
    );
    const i = save(
      m.custom_id.replace('v1:evt:save:', ''),
      {
        title: 'Zmiana',
        when: m.components[3].component.value,
        place_note: '',
      },
      selects({ kind: ['egzamin'], subject: ['-'] }),
      true,
    );
    await handler()(i);
    const rows = await db.select().from(events).orderBy(events.startsAt);
    expect(rows.map((e) => e.title)).toEqual([
      'Konsultacje',
      'Zmiana',
      'Zmiana',
    ]);
    expect(third).toBeDefined();
  });

  it('delete: scope -> confirm -> only that scope is deleted', async () => {
    const [first, second] = await mkSeries();
    const ask = interaction(`v1:evt:del:${second}:following`);
    await handler()(ask);
    const delok = buttons(lastEdit(ask)).find((b) =>
      b.startsWith(`v1:evt:delok:${second}:following:v`),
    );
    expect(delok).toBeDefined();
    const ok = interaction(delok as string);
    await handler()(ok);
    const rows = await db.select().from(events).orderBy(events.startsAt);
    expect(rows.map((e) => e.deletedAt !== null)).toEqual([false, true, true]);
    expect(rows[0].id).toBe(first);
  });

  it('a save opened before someone else edited is refused', async () => {
    const [id] = await mkSeries();
    const open = interaction(`v1:evt:edit:${id}:one`);
    await handler()(open);
    const m = open.showModal.mock.calls[0][0].toJSON();
    await db
      .update(events)
      .set({ version: sql`${events.version} + 1` })
      .where(eq(events.id, id));
    const i = save(
      m.custom_id.replace('v1:evt:save:', ''),
      {
        title: 'Spóźnione',
        when: m.components[3].component.value,
        place_note: '',
      },
      selects({ kind: ['egzamin'], subject: ['-'] }),
      true,
    );
    await handler()(i);
    expect(JSON.stringify(i.followUp.mock.calls[0][0])).toContain(
      'Someone changed this event',
    );
    const [e] = await db.select().from(events).where(eq(events.id, id));
    expect(e.title).toBe('Konsultacje');
  });

  it('a delete confirmed after someone else edited is refused', async () => {
    const [id] = await mkSeries();
    const ask = interaction(`v1:evt:del:${id}:one`);
    await handler()(ask);
    const delok = buttons(lastEdit(ask)).find((b) => b.includes(':delok:'));
    await db
      .update(events)
      .set({ version: sql`${events.version} + 1` })
      .where(eq(events.id, id));
    const ok = interaction(delok as string);
    await handler()(ok);
    expect(textOf(lastEdit(ok))).toContain('Someone changed this event');
    const [e] = await db.select().from(events).where(eq(events.id, id));
    expect(e.deletedAt).toBeNull();
  });

  it('a bad scope argument is stale', async () => {
    const i = interaction('v1:evt:del:1:everything');
    await handler()(i);
    expect(textOf(i.reply.mock.calls[0][0])).toContain('out of date');
  });
});

describe('"Shown on" a timetable session', () => {
  let classId: number;
  let groupId: number;
  beforeEach(async () => {
    const [c] = await db
      .insert(classes)
      .values({ subjectId, kind: 'laboratorium', name: 'Laboratorium' });
    classId = c.insertId;
    const [g] = await db
      .insert(classGroups)
      .values({ classId, number: 2, name: 'Gr. 2' });
    groupId = g.insertId;
    // Tue 20.10.2026 10:00-11:30, Laboratorium Gr. 2.
    await db.insert(classSessions).values({
      uid: 's1',
      occurrenceStart: new Date('2026-10-20T10:00:00Z'),
      startsAt: new Date('2026-10-20T10:00:00Z'),
      endsAt: new Date('2026-10-20T11:30:00Z'),
      label: 'L',
      subjectId,
      classId,
      groupId,
    });
  });
  const SHOWN = 'Shown on Laboratorium Gr. 2, Tue 20 Oct';

  it('after setting the class and group of a Test inside the session', async () => {
    await handler()(save('new', fields({ when: '20.10.2026 10:15' })));
    const [e] = await db.select().from(events);
    expect(e.classId).toBeNull();
    const set = interaction(`v1:evt:grp:${e.id}`, {
      kind: 'select',
      values: [`g${groupId}`],
    });
    await handler()(set);
    expect(textOf(lastEdit(set))).toContain(SHOWN);
    // An edit that keeps the time inside says it again, one outside does not.
    const inside = save(
      String(e.id),
      fields({ when: '20.10.2026 11:00' }),
      selects(),
      true,
    );
    await handler()(inside);
    expect(textOf(lastEdit(inside))).toContain(SHOWN);
    const outside = save(
      String(e.id),
      fields({ when: '20.10.2026 11:30' }),
      selects(),
      true,
    );
    await handler()(outside);
    expect(textOf(lastEdit(outside))).not.toContain('Shown on');
  });

  it('not for an event without a class, nor for another kind', async () => {
    const i = save('new', fields({ when: '20.10.2026 10:15' }));
    await handler()(i);
    expect(textOf(lastEdit(i))).not.toContain('Shown on');
    const [e] = await db.select().from(events);
    await db.update(events).set({ classId, groupId, kind: 'inne' });
    const show = interaction(`v1:evt:grp:${e.id}`, {
      kind: 'select',
      values: [`g${groupId}`],
    });
    await handler()(show);
    expect(textOf(lastEdit(show))).not.toContain('Shown on');
  });

  it('/event add with the class and group', async () => {
    const i = slash({
      kind: 'kolokwium',
      title: 'Kolokwium 1',
      when: '20.10.2026 10:00',
      subject: 'asd',
      class: 'laboratorium',
      group: 2,
    });
    await handler()(i);
    expect(textOf(i.editReply.mock.calls[0][0])).toContain(SHOWN);
    const other = slash({
      kind: 'kolokwium',
      title: 'Kolokwium 2',
      when: '21.10.2026 10:00',
      subject: 'asd',
      class: 'laboratorium',
      group: 2,
    });
    await handler()(other);
    expect(textOf(other.editReply.mock.calls[0][0])).not.toContain('Shown on');
  });
});
