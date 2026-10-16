import {
  createDb,
  type Db,
  events,
  getReminderPrefs,
  getSetting,
  reminderLog,
  setReminderPrefs,
  setSetting,
  users,
} from '@studies/db';
import type { PlanSession } from '@studies/db/plan';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReminderMemory,
  DIGEST_THREAD_SETTING,
  digestText,
  dmText,
  type ReminderGuild,
  runReminderTick,
} from '../src/reminders.js';

const W = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi));

let db: Db;
let pool: ReturnType<typeof createDb>['pool'];
let uid: number;

function fakeGuild() {
  const dms: { to: string; content: string }[] = [];
  const digests: { forum: string; thread: string | null; content: string }[] =
    [];
  const guild: ReminderGuild = {
    sendDm: vi.fn(async (to, content) => {
      dms.push({ to, content });
    }),
    postDigest: vi.fn(async (forum, thread, content) => {
      digests.push({ forum, thread, content });
      return thread ?? 'thread-1';
    }),
  };
  return { guild, dms, digests };
}
const deps = (guild: ReminderGuild) => ({
  db,
  pool,
  guild,
  webBaseUrl: 'https://x.pl',
});

const event = async (
  startsAt: Date,
  o: Partial<typeof events.$inferInsert> = {},
) =>
  (
    await db
      .insert(events)
      .values({
        kind: 'kolokwium',
        title: 'Kolos',
        place: 'C-12',
        startsAt,
        ...o,
      })
      .$returningId()
  )[0].id;

beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
  pool = createDb(process.env.TEST_DATABASE_URL as string).pool;
  [{ id: uid }] = await db
    .insert(users)
    .values({ discordUserId: 'd1', displayName: 'U' })
    .$returningId();
  await setReminderPrefs(db, uid, { dayBefore: true, hourBefore: true }, 'web');
});
afterAll(async () => {
  await pool?.end();
  await closeTestDb(db);
});

describe('reminder texts', () => {
  const base = {
    type: 'event',
    id: 7,
    startsAt: W(2026, 10, 20, 10),
    eventKind: 'kolokwium',
    eventTitle: 'Kolos',
    subjectName: 'Bazy',
    subjectCode: 'BD',
    room: 'C-12',
    label: 'Kolos',
  } as unknown as PlanSession;
  it('DM: day, hour, all-day, missing parts', () => {
    expect(dmText(base, 'day', 'https://x.pl')).toBe(
      'Przypomnienie: 📝 Kolos · Bazy · jutro 10:00 · C-12\nhttps://x.pl/s/wydarzenia/7',
    );
    expect(dmText(base, 'hour', 'https://x.pl')).toContain('dziś 10:00');
    expect(
      dmText(
        { ...base, allDay: true, room: null, subjectName: '' },
        'day',
        'u',
      ),
    ).toBe('Przypomnienie: 📝 Kolos · jutro (cały dzień)\nu/s/wydarzenia/7');
  });
  it('escapes markdown in titles and places', () => {
    const e = { ...base, eventTitle: '*Kolos*', room: '_C_' } as PlanSession;
    expect(dmText(e, 'day', 'u')).toContain(
      '\\*Kolos\\* · Bazy · jutro 10:00 · \\_C\\_',
    );
    expect(digestText([e])).toContain('\\*Kolos\\*');
  });
  it('digest: lines, truncated to 2000 characters', () => {
    expect(digestText([base])).toBe('Jutro:\n📝 Kolos · BD · 10:00 · C-12');
    const many = Array.from({ length: 200 }, (_, i) => ({
      ...base,
      eventTitle: `Wydarzenie numer ${i}`,
    }));
    const t = digestText(many);
    expect(t.length).toBeLessThanOrEqual(2000);
    expect(t).toMatch(/…i \d+ więcej$/);
  });
});

describe('runReminderTick', () => {
  it('a markSent failure after a delivered DM never re-sends, and others still get theirs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const [{ id: u2 }] = await db
      .insert(users)
      .values({ discordUserId: 'd2', displayName: 'U2' })
      .$returningId();
    await setReminderPrefs(
      db,
      u2,
      { dayBefore: true, hourBefore: true },
      'web',
    );
    await event(W(2026, 10, 20, 10));
    const g = fakeGuild();
    const memory = createReminderMemory();
    const spy = vi
      .spyOn(await import('@studies/db'), 'markSent')
      .mockRejectedValueOnce(new Error('db blip'));
    await runReminderTick({ ...deps(g.guild), memory }, W(2026, 10, 19, 10));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    await runReminderTick({ ...deps(g.guild), memory }, W(2026, 10, 19, 10, 1));
    expect(g.dms.map((d) => d.to).sort()).toEqual(['d1', 'd2']);
    expect(await db.select().from(reminderLog)).toHaveLength(2);
  });

  it('a failed setSetting after creating the digest thread does not create a second one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await setSetting(db, 'events_forum_id', 'forum-1');
    await event(W(2026, 10, 20, 10));
    const g = fakeGuild();
    const memory = createReminderMemory();
    const spy = vi
      .spyOn(await import('@studies/db'), 'setSetting')
      .mockRejectedValueOnce(new Error('db blip'));
    await runReminderTick({ ...deps(g.guild), memory }, W(2026, 10, 19, 18, 1));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    await event(W(2026, 10, 20, 12), { title: 'Nowy' });
    await runReminderTick({ ...deps(g.guild), memory }, W(2026, 10, 19, 18, 2));
    expect(g.digests.map((d) => d.thread)).toEqual([null, 'thread-1']);
    expect(g.digests[1].content).not.toContain('Kolos');
  });

  it('stops between sends when asked', async () => {
    await event(W(2026, 10, 20, 10));
    const g = fakeGuild();
    await runReminderTick(
      { ...deps(g.guild), isStopped: () => true },
      W(2026, 10, 19, 10),
    );
    expect(g.dms).toEqual([]);
  });

  it('an unknown user (10013) is disabled with a reason', async () => {
    await event(W(2026, 10, 20, 10));
    const g = fakeGuild();
    g.guild.sendDm = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), { code: 10013 }));
    await runReminderTick(deps(g.guild), W(2026, 10, 19, 10));
    expect((await getReminderPrefs(db, uid)).disabledReason).toBe(
      'Nieznany użytkownik',
    );
    expect(await db.select().from(reminderLog)).toHaveLength(1);
  });

  it('sends one DM per due entry, logs it, and a new tick sends nothing twice', async () => {
    await event(W(2026, 10, 20, 10));
    const a = fakeGuild();
    await runReminderTick(deps(a.guild), W(2026, 10, 19, 10));
    expect(a.dms.map((d) => d.to)).toEqual(['d1']);
    expect(a.dms[0].content).toMatch(/^Przypomnienie: 📝 Kolos/);
    expect(await db.select().from(reminderLog)).toHaveLength(1);
    const b = fakeGuild();
    await runReminderTick(deps(b.guild), W(2026, 10, 19, 10, 1));
    expect(b.dms).toEqual([]);
  });

  it('a closed DM (50007) turns prefs off with a reason and is not retried', async () => {
    await event(W(2026, 10, 20, 10));
    const g = fakeGuild();
    g.guild.sendDm = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), { code: 50007 }));
    await runReminderTick(deps(g.guild), W(2026, 10, 19, 10));
    expect(await getReminderPrefs(db, uid)).toEqual({
      dayBefore: false,
      hourBefore: false,
      disabledReason: 'DM zamknięte',
    });
    expect(await db.select().from(reminderLog)).toHaveLength(1);
  });

  it('another DM error is logged and retried next tick', async () => {
    await event(W(2026, 10, 20, 10));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = fakeGuild();
    g.guild.sendDm = vi.fn().mockRejectedValue(new Error('boom'));
    await runReminderTick(deps(g.guild), W(2026, 10, 19, 10));
    expect(await db.select().from(reminderLog)).toHaveLength(0);
    expect((await getReminderPrefs(db, uid)).dayBefore).toBe(true);
    const ok = fakeGuild();
    await runReminderTick(deps(ok.guild), W(2026, 10, 19, 10, 1));
    expect(ok.dms).toHaveLength(1);
  });

  it('posts the digest once, in the stored forum, reusing one thread', async () => {
    await setSetting(db, 'events_forum_id', 'forum-1');
    await event(W(2026, 10, 20, 10));
    const g = fakeGuild();
    await runReminderTick(deps(g.guild), W(2026, 10, 19, 18, 1));
    await runReminderTick(deps(g.guild), W(2026, 10, 19, 18, 2));
    expect(g.digests).toHaveLength(1);
    expect(g.digests[0]).toMatchObject({ forum: 'forum-1', thread: null });
    expect(g.digests[0].content).toMatch(/^Jutro:\n/);
    expect(await getSetting(db, DIGEST_THREAD_SETTING)).toBe('thread-1');
    // An event added later that evening gets its own short message, same thread.
    await event(W(2026, 10, 20, 12), { title: 'Nowy' });
    await runReminderTick(deps(g.guild), W(2026, 10, 19, 18, 10));
    expect(g.digests).toHaveLength(2);
    expect(g.digests[1].thread).toBe('thread-1');
    expect(g.digests[1].content).toContain('Nowy');
    expect(g.digests[1].content).not.toContain('Kolos');
  });

  it('no digest without a forum setting', async () => {
    await event(W(2026, 10, 20, 10));
    const g = fakeGuild();
    await runReminderTick(deps(g.guild), W(2026, 10, 19, 18, 1));
    expect(g.digests).toEqual([]);
    expect(await db.select().from(users).where(eq(users.id, uid))).toHaveLength(
      1,
    );
  });
});
