import {
  adminAudit,
  classes,
  classGroups,
  classSessions,
  type Db,
  disableReminders,
  getReminderPrefs,
  setSetting,
  subjects,
  userGroups,
  users,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  createInteractionHandler,
  type RouterDeps,
} from '../src/commands/router.js';

// biome-ignore lint/suspicious/noExplicitAny: walking raw component JSON
type Json = any;

/** Flip `on` to make the plan renderer fail. */
const renderFail = vi.hoisted(() => ({ on: false }));
vi.mock('../src/ui/plan-image.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/ui/plan-image.js')>();
  const wrap =
    <A extends unknown[], R>(f: (...a: A) => Promise<R>) =>
    async (...a: A) => {
      if (renderFail.on) throw new Error('canvas broke');
      return f(...a);
    };
  return {
    ...m,
    renderDayImage: wrap(m.renderDayImage),
    renderWeekImage: wrap(m.renderWeekImage),
  };
});

let db: Db;
let pool: RouterDeps['pool'];
const id: Record<string, number> = {};

beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
  pool = (db as unknown as { $client: RouterDeps['pool'] }).$client;
  await setSetting(db, 'admin_role_id', 'r');
  const [s] = await db
    .insert(subjects)
    .values({ name: 'Fizyka', code: 'FIZ', semester: 1, ects: 5 })
    .$returningId();
  id.subj = s.id;
  const [c] = await db
    .insert(classes)
    .values({ subjectId: s.id, kind: 'laboratorium', name: 'Laboratorium' })
    .$returningId();
  id.cls = c.id;
  for (const n of [1, 2]) {
    const [g] = await db
      .insert(classGroups)
      .values({ classId: c.id, number: n, name: `Gr. ${n}` })
      .$returningId();
    id[`g${n}`] = g.id;
  }
  let uid = 0;
  const sess = (start: string, end: string, groupId?: number) =>
    db.insert(classSessions).values({
      uid: `u${++uid}`,
      occurrenceStart: new Date(`${start}Z`),
      startsAt: new Date(`${start}Z`),
      endsAt: new Date(`${end}Z`),
      label: 'L',
      subjectId: s.id,
      classId: groupId ? c.id : null,
      groupId: groupId ?? null,
    });
  // Wednesday 14.10.2026 (wall time): a lecture and both lab groups.
  await sess('2026-10-14T08:00:00', '2026-10-14T09:30:00');
  await sess('2026-10-14T10:00:00', '2026-10-14T11:30:00', id.g1);
  await sess('2026-10-14T12:00:00', '2026-10-14T13:30:00', id.g2);
  // Real instant 2026-10-14 10:00 UTC = 12:00 in Warsaw.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  renderFail.on = false;
});
afterAll(async () => {
  await closeTestDb(db);
});

const config = {
  adminRoleName: 'Studies Admin',
  webBaseUrl: 'https://x.pl',
} as never;
const handler = () =>
  createInteractionHandler({
    ingest: { db, storageDir: '', fetchBody: vi.fn() },
    client: {} as never,
    config,
    pool,
  });

const user = (over: Record<string, unknown> = {}) => ({
  id: 'stud',
  username: 'stud',
  globalName: null,
  displayAvatarURL: () => 'a',
  send: vi.fn().mockResolvedValue(undefined),
  ...over,
});

/** A fake component interaction that records its responses in order. */
function component(
  customId: string,
  over: { ephemeral?: boolean; values?: string[]; select?: boolean } = {},
) {
  const calls: string[] = [];
  const i: Json = {
    customId,
    values: over.values,
    user: user(),
    member: { roles: [] },
    message: {
      flags: {
        has: (f: number) => f === MessageFlags.Ephemeral && !!over.ephemeral,
      },
    },
    deferred: false,
    replied: false,
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => !over.select,
    isStringSelectMenu: () => !!over.select,
    isUserSelectMenu: () => false,
    isModalSubmit: () => false,
    isMessageComponent: () => true,
    isRepliable: () => true,
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
  return i;
}

function nodes(payload: Json): Json[] {
  const out: Json[] = [];
  const walk = (c: Json) => {
    out.push(c);
    for (const child of c.components ?? []) walk(child);
    if (c.accessory) walk(c.accessory);
  };
  for (const c of payload?.components ?? [])
    walk(typeof c.toJSON === 'function' ? c.toJSON() : c);
  return out;
}
const textOf = (payload: Json) =>
  [
    payload?.content ?? '',
    ...nodes(payload)
      .filter((n) => typeof n.content === 'string')
      .map((n) => n.content),
  ].join('\n');

const STALE = 'Ten panel jest nieaktualny — otwórz go ponownie.';
const BANNED = 'Twój dostęp do strony jest zablokowany.';

describe('handleUi', () => {
  it('answers a stale id with the notice', async () => {
    const i = component('v0:stu:plan:day');
    await handler()(i);
    expect(i.calls).toEqual(['reply']);
    const arg = i.reply.mock.calls[0][0];
    expect(textOf(arg)).toContain(STALE);
    expect(arg.flags & MessageFlags.Ephemeral).toBeTruthy();
  });

  it('treats unknown student actions and bad args as stale', async () => {
    for (const cid of ['v1:stu:nope', 'v1:stu:plan:day:2026-13-45']) {
      const i = component(cid);
      await handler()(i);
      expect(i.calls).toEqual(['reply']);
      expect(textOf(i.reply.mock.calls[0][0])).toContain(STALE);
    }
  });

  const gallery = (payload: Json) =>
    nodes(payload).filter((n) => n.type === 12);
  const fileNames = (payload: Json) =>
    (payload.files ?? []).map((f: Json) => f.name);
  const isPng = (payload: Json) =>
    [...(payload.files[0].attachment as Buffer).subarray(0, 4)].join() ===
    '137,80,78,71';

  it('plan day from the pinned message: ephemeral deferReply, then the day image', async () => {
    const i = component('v1:stu:plan:day');
    await handler()(i);
    expect(i.calls).toEqual(['deferReply', 'editReply']);
    expect(i.deferReply.mock.calls[0][0].flags).toBe(MessageFlags.Ephemeral);
    const view = i.editReply.mock.calls[0][0];
    expect(view.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(fileNames(view)).toEqual(['plan-2026-10-14.png']);
    expect(isPng(view)).toBe(true);
    expect(gallery(view)[0].items[0].media.url).toBe(
      'attachment://plan-2026-10-14.png',
    );
    const text = textOf(view);
    expect(text).toContain('Plan — śr 14.10');
    expect(text).toContain('Zajęcia: 3 · Moje grupy: nie');
    expect(text).toContain('Ustaw Moje grupy');
  });

  it('plan from an ephemeral view updates it in place, filtered by my groups', async () => {
    const [u] = await db
      .insert(users)
      .values({ discordUserId: 'stud', displayName: 'stud' })
      .$returningId();
    await db
      .insert(userGroups)
      .values({ userId: u.id, classId: id.cls, groupId: id.g2 });
    const i = component('v1:stu:plan:day:2026-10-14', { ephemeral: true });
    await handler()(i);
    expect(i.calls).toEqual(['deferUpdate', 'editReply']);
    const text = textOf(i.editReply.mock.calls[0][0]);
    expect(text).toContain('Zajęcia: 2 · Moje grupy: tak');
    expect(text).not.toContain('Ustaw Moje grupy');
  });

  it('◀/▶ swap the image in place: new files, previous attachments dropped', async () => {
    for (const cid of [
      'v1:stu:plan:day:2026-10-13',
      'v1:stu:plan:day:2026-10-14',
      'v1:stu:plan:week:2026-W43',
      'v1:stu:plan:week:2026-W42',
    ]) {
      const i = component(cid, { ephemeral: true });
      await handler()(i);
      expect(i.calls).toEqual(['deferUpdate', 'editReply']);
      const payload = i.editReply.mock.calls[0][0];
      expect(payload.attachments).toEqual([]);
      expect(Array.isArray(payload.files)).toBe(true);
    }
    const week = component('v1:stu:plan:week:2026-W42', { ephemeral: true });
    await handler()(week);
    expect(fileNames(week.editReply.mock.calls[0][0])).toEqual([
      'plan-2026-W42.png',
    ]);
  });

  it('an empty day renders no image and says "Brak zajęć"', async () => {
    const i = component('v1:stu:plan:day:2026-10-13', { ephemeral: true });
    await handler()(i);
    const payload = i.editReply.mock.calls[0][0];
    expect(payload.files).toEqual([]);
    expect(gallery(payload)).toHaveLength(0);
    expect(textOf(payload)).toContain('Brak zajęć');
  });

  it('falls back to the text list when rendering fails', async () => {
    renderFail.on = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const cid of ['v1:stu:plan:day:2026-10-14', 'v1:stu:plan:week']) {
      const i = component(cid, { ephemeral: true });
      await handler()(i);
      expect(i.calls).toEqual(['deferUpdate', 'editReply']);
      const payload = i.editReply.mock.calls[0][0];
      expect(payload.files).toEqual([]);
      expect(gallery(payload)).toHaveLength(0);
      const text = textOf(payload);
      expect(text).toContain('08:00–09:30');
      expect(text).toContain('10:00–11:30');
      expect(text).toContain('12:00–13:30');
    }
    expect(err).toHaveBeenCalledTimes(2);
    expect(String(err.mock.calls[0])).toContain('canvas broke');
  });

  it('ignores a saved group that is no longer a group of its class (like the web)', async () => {
    const [u] = await db
      .insert(users)
      .values({ discordUserId: 'stud', displayName: 'stud' })
      .$returningId();
    await db
      .insert(userGroups)
      .values({ userId: u.id, classId: id.cls, groupId: id.g2 });
    // Gr. 2 moves to another class: the saved pair is stale.
    const [other] = await db
      .insert(classes)
      .values({ subjectId: id.subj, kind: 'cwiczenia', name: 'Ćwiczenia' })
      .$returningId();
    await db
      .update(classGroups)
      .set({ classId: other.id })
      .where(eq(classGroups.id, id.g2));
    const i = component('v1:stu:plan:day:2026-10-14', { ephemeral: true });
    await handler()(i);
    const text = textOf(i.editReply.mock.calls[0][0]);
    expect(text).toContain('Zajęcia: 3 · Moje grupy: nie');
  });

  it('plan week: the Dzień button targets today in the current week', async () => {
    const i = component('v1:stu:plan:week', { ephemeral: true });
    await handler()(i);
    const view = i.editReply.mock.calls[0][0];
    expect(textOf(view)).toContain('Plan — tydzień 12.10–18.10');
    const ids = nodes(view).map((n) => n.custom_id);
    expect(ids).toContain('v1:stu:plan:day:2026-10-14');
    const j = component('v1:stu:plan:week:2026-W44', { ephemeral: true });
    await handler()(j);
    expect(
      nodes(j.editReply.mock.calls[0][0]).map((n) => n.custom_id),
    ).toContain('v1:stu:plan:day:2026-10-26');
  });

  it('groups: subject select shows class selects; set defers before saving', async () => {
    const open = component('v1:stu:groups:open');
    await handler()(open);
    expect(open.calls).toEqual(['deferReply', 'editReply']);
    expect(textOf(open.editReply.mock.calls[0][0])).toContain('Moje grupy');

    const subj = component('v1:stu:groups:subj', {
      ephemeral: true,
      select: true,
      values: ['0'],
    });
    await handler()(subj);
    expect(
      nodes(subj.editReply.mock.calls[0][0]).map((n) => n.custom_id),
    ).toContain(`v1:stu:groups:set:${id.cls}`);

    // Out of range: no subject selected, not an error.
    const far = component('v1:stu:groups:subj', {
      ephemeral: true,
      select: true,
      values: ['99'],
    });
    await handler()(far);
    expect(
      nodes(far.editReply.mock.calls[0][0]).map((n) => n.custom_id),
    ).not.toContain(`v1:stu:groups:set:${id.cls}`);

    const set = component(`v1:stu:groups:set:${id.cls}`, {
      ephemeral: true,
      select: true,
      values: [String(id.g2)],
    });
    let rowsAtDefer = -1;
    set.deferUpdate = vi.fn(async () => {
      set.calls.push('deferUpdate');
      set.deferred = true;
      rowsAtDefer = (await db.select().from(userGroups)).length;
    });
    await handler()(set);
    expect(set.calls).toEqual(['deferUpdate', 'editReply']);
    expect(rowsAtDefer).toBe(0);
    const rows = await db.select().from(userGroups);
    expect(rows).toMatchObject([{ classId: id.cls, groupId: id.g2 }]);
    const view = set.editReply.mock.calls[0][0];
    expect(textOf(view)).toContain('Fizyka · Laboratorium — **Gr. 2**');
    // The subject stays selected, so its class select is still there.
    expect(nodes(view).map((n) => n.custom_id)).toContain(
      `v1:stu:groups:set:${id.cls}`,
    );

    const none = component(`v1:stu:groups:set:${id.cls}`, {
      ephemeral: true,
      select: true,
      values: ['0'],
    });
    await handler()(none);
    expect(await db.select().from(userGroups)).toEqual([]);
  });

  it('groups clear removes every saved group', async () => {
    const [u] = await db
      .insert(users)
      .values({ discordUserId: 'stud', displayName: 'stud' })
      .$returningId();
    await db
      .insert(userGroups)
      .values({ userId: u.id, classId: id.cls, groupId: id.g1 });
    const i = component('v1:stu:groups:clear', { ephemeral: true });
    await handler()(i);
    expect(i.calls).toEqual(['deferUpdate', 'editReply']);
    expect(await db.select().from(userGroups)).toEqual([]);
  });

  it('rem toggles persist per kind, audit as discord and keep the subject open', async () => {
    const [u] = await db
      .insert(users)
      .values({ discordUserId: 'stud', displayName: 'stud' })
      .$returningId();
    const day = component('v1:stu:rem:day:1:0', { ephemeral: true });
    await handler()(day);
    expect(day.calls).toEqual(['deferUpdate', 'editReply']);
    expect(await getReminderPrefs(db, u.id)).toMatchObject({
      dayBefore: true,
      hourBefore: false,
    });
    const view = day.editReply.mock.calls[0][0];
    const ids = nodes(view).map((n) => n.custom_id);
    expect(ids).toContain(`v1:stu:groups:set:${id.cls}`);
    expect(
      nodes(view)
        .filter((n) => n.type === 2)
        .map((n) => n.label),
    ).toContain('Przypomnienie 24 h: wł.');
    await handler()(component('v1:stu:rem:hour:1', { ephemeral: true }));
    // A stale or double click sets the state its button showed.
    await handler()(component('v1:stu:rem:hour:1', { ephemeral: true }));
    await handler()(component('v1:stu:rem:day:0', { ephemeral: true }));
    expect(await getReminderPrefs(db, u.id)).toMatchObject({
      dayBefore: false,
      hourBefore: true,
    });
    const [a] = await db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.action, 'reminders.update'))
      .limit(1);
    expect((a.details as { source: string }).source).toBe('discord');
  });

  it('shows the closed-DM notice once, then clears the reason but keeps prefs off', async () => {
    const [u] = await db
      .insert(users)
      .values({ discordUserId: 'stud', displayName: 'stud' })
      .$returningId();
    await disableReminders(db, u.id, 'DM zamknięte');
    const first = component('v1:stu:plan:day', { ephemeral: true });
    await handler()(first);
    expect(first.calls).toEqual(['deferUpdate', 'editReply', 'followUp']);
    expect(textOf(first.followUp.mock.calls[0][0])).toContain(
      'Przypomnienia wyłączone: DM zamknięte',
    );
    expect(await getReminderPrefs(db, u.id)).toEqual({
      dayBefore: false,
      hourBefore: false,
      disabledReason: null,
    });
    const second = component('v1:stu:plan:day', { ephemeral: true });
    await handler()(second);
    expect(second.calls).not.toContain('followUp');
  });

  it('/panel shows the closed-DM notice once as a follow-up', async () => {
    const [u] = await db
      .insert(users)
      .values({ discordUserId: 'stud', displayName: 'stud' })
      .$returningId();
    await disableReminders(db, u.id, 'DM zamknięte');
    const mk = (): Json => ({
      commandName: 'panel',
      user: user(),
      member: { roles: [] },
      deferred: false,
      replied: false,
      isAutocomplete: () => false,
      isChatInputCommand: () => true,
      isRepliable: () => true,
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    });
    const a = mk();
    await handler()(a);
    expect(a.followUp).toHaveBeenCalledTimes(1);
    const b = mk();
    await handler()(b);
    expect(b.followUp).not.toHaveBeenCalled();
  });

  it('login DMs the one-time link in a new ephemeral reply', async () => {
    const i = component('v1:stu:login', { ephemeral: true });
    await handler()(i);
    expect(i.calls).toEqual(['deferReply', 'editReply']);
    expect(i.user.send.mock.calls[0][0].content).toMatch(
      /^Twój link do Studies DB \(ważny 15 minut, jednorazowy\): <https:\/\/x\.pl\/auth\/callback\?token=[^>\s]+>$/,
    );
    expect(i.user.send.mock.calls[0][0].flags).toBe(
      MessageFlags.SuppressEmbeds,
    );
    expect(textOf(i.editReply.mock.calls[0][0])).toContain(
      'Wysłałem Ci link w wiadomości prywatnej.',
    );
  });

  it('login with closed DMs says so', async () => {
    const i = component('v1:stu:login');
    i.user.send = vi.fn().mockRejectedValue(new Error('Cannot send'));
    await handler()(i);
    expect(textOf(i.editReply.mock.calls[0][0])).toContain(
      'Nie mogę wysłać DM — włącz wiadomości prywatne od członków serwera.',
    );
  });

  it('refuses every student action of a banned user', async () => {
    await db
      .insert(users)
      .values({ discordUserId: 'stud', displayName: 'stud', isBanned: true });
    for (const cid of [
      'v1:stu:login',
      'v1:stu:plan:day',
      'v1:stu:groups:open',
      'v1:stu:rem:day:1',
    ]) {
      const i = component(cid);
      await handler()(i);
      expect(textOf(i.editReply.mock.calls[0][0])).toContain(BANNED);
      expect(i.user.send).not.toHaveBeenCalled();
    }
  });

  it('syncs users.is_admin on every interaction', async () => {
    const i = component('v1:stu:plan:day');
    i.member = { roles: ['r'] };
    await handler()(i);
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, 'stud'));
    expect(u?.isAdmin).toBe(true);
  });

  const ERROR = 'Wystąpił błąd. Spróbuj ponownie później.';

  for (const ephemeral of [false, true]) {
    it(`replaces the deferred response with a V2 error notice (ephemeral view: ${ephemeral})`, async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const i = component('v1:stu:plan:day', { ephemeral });
      i.editReply = vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(undefined);
      await handler()(i);
      expect(i.followUp).not.toHaveBeenCalled();
      expect(i.editReply).toHaveBeenCalledTimes(2);
      const arg = i.editReply.mock.calls[1][0];
      expect(arg.content).toBeUndefined();
      expect(arg.flags & MessageFlags.IsComponentsV2).toBeTruthy();
      expect(arg.allowedMentions).toEqual({ parse: [] });
      expect(textOf(arg)).toBe(`\n${ERROR}`);
      err.mockRestore();
    });
  }

  it('falls back to an ephemeral V2 followUp when the error edit fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const i = component('v1:stu:plan:day', { ephemeral: true });
    i.editReply = vi.fn().mockRejectedValue(new Error('boom'));
    await handler()(i);
    expect(i.editReply).toHaveBeenCalledTimes(2);
    expect(i.followUp).toHaveBeenCalledTimes(1);
    const arg = i.followUp.mock.calls[0][0];
    expect(arg.content).toBeUndefined();
    expect(arg.flags).toBe(
      MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    );
    expect(textOf(arg)).toContain(ERROR);
    err.mockRestore();
  });

  it('uses the raw API member nick as the display name', async () => {
    const i = component('v1:stu:plan:day');
    i.member = { roles: [], nick: 'Ksywka' };
    await handler()(i);
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, 'stud'));
    expect(u?.displayName).toBe('Ksywka');
  });
});

describe('/panel', () => {
  it('replies ephemeral with the student panel and its 5 buttons', async () => {
    const i: Json = {
      commandName: 'panel',
      user: user(),
      member: { roles: [] },
      deferred: false,
      replied: false,
      isAutocomplete: () => false,
      isChatInputCommand: () => true,
      isRepliable: () => true,
      reply: vi.fn().mockResolvedValue(undefined),
    };
    await handler()(i);
    const arg = i.reply.mock.calls[0][0];
    expect(arg.flags & MessageFlags.Ephemeral).toBeTruthy();
    expect(arg.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    const buttons = nodes(arg).filter((n) => n.type === 2);
    expect(buttons.map((b) => b.label)).toEqual([
      'Plan dziś',
      'Ten tydzień',
      'Moje grupy',
      'Zaloguj się na stronie',
      'Dodaj wydarzenie',
    ]);
  });

  it('opens for a banned user too', async () => {
    await db
      .insert(users)
      .values({ discordUserId: 'stud', displayName: 'stud', isBanned: true });
    const i: Json = {
      commandName: 'panel',
      user: user(),
      member: { roles: [] },
      deferred: false,
      replied: false,
      isAutocomplete: () => false,
      isChatInputCommand: () => true,
      isRepliable: () => true,
      reply: vi.fn().mockResolvedValue(undefined),
    };
    await handler()(i);
    expect(
      nodes(i.reply.mock.calls[0][0]).filter((n) => n.type === 2),
    ).toHaveLength(5);
  });
});
