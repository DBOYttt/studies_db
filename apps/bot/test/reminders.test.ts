import {
  classes,
  classGroups,
  classMarkSkips,
  classMarks,
  classSessions,
  createDb,
  type Db,
  events,
  getReminderPrefs,
  getSetting,
  reminderLog,
  setReminderPrefs,
  setSetting,
  subjects,
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
  discordReminderGuild,
  dmText,
  NOT_A_DISCORD_ACCOUNT,
  NotDiscordAccountError,
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
      'Reminder: 📝 Kolos · Bazy · tomorrow 10:00 · C-12\nhttps://x.pl/s/wydarzenia/7',
    );
    expect(dmText(base, 'hour', 'https://x.pl')).toContain('today 10:00');
    expect(
      dmText(
        { ...base, allDay: true, room: null, subjectName: '' },
        'day',
        'u',
      ),
    ).toBe('Reminder: 📝 Kolos · tomorrow (all day)\nu/s/wydarzenia/7');
  });
  it('escapes markdown in titles and places', () => {
    const e = { ...base, eventTitle: '*Kolos*', room: '_C_' } as PlanSession;
    expect(dmText(e, 'day', 'u')).toContain(
      '\\*Kolos\\* · Bazy · tomorrow 10:00 · \\_C\\_',
    );
    expect(digestText([e])).toContain('\\*Kolos\\*');
  });
  it('breaks masked links in the digest and DMs (L2)', () => {
    const e = {
      ...base,
      eventTitle: '[Kolos](https://phish)',
      room: '[C](https://x)',
    } as PlanSession;
    expect(digestText([e])).toContain('\\[Kolos](https://phish)');
    expect(digestText([e])).toContain('\\[C](https://x)');
    expect(dmText(e, 'day', 'u')).toContain('\\[Kolos](https://phish)');
  });
  it('digest: entry quiz lines after the events', () => {
    const q = [
      { subjectName: 'Bazy', className: 'Laboratorium', groupName: 'Gr. 1' },
      { subjectName: 'Fizyka', className: 'Ćwiczenia', groupName: null },
    ];
    expect(digestText([base], q)).toBe(
      'Tomorrow:\n📝 Kolos · BD · 10:00 · C-12\nEntry quiz: Bazy, Laboratorium Gr. 1\nEntry quiz: Fizyka, Ćwiczenia',
    );
    expect(digestText([], q.slice(0, 1))).toBe(
      'Tomorrow:\nEntry quiz: Bazy, Laboratorium Gr. 1',
    );
    const many = Array.from({ length: 200 }, () => q[0]);
    expect(digestText([], many).length).toBeLessThanOrEqual(2000);
  });
  it('digest: lines, truncated to 2000 characters', () => {
    expect(digestText([base])).toBe('Tomorrow:\n📝 Kolos · BD · 10:00 · C-12');
    const many = Array.from({ length: 200 }, (_, i) => ({
      ...base,
      eventTitle: `Wydarzenie numer ${i}`,
    }));
    const t = digestText(many);
    expect(t.length).toBeLessThanOrEqual(2000);
    expect(t).toMatch(/…and \d+ more$/);
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

  it('does not re-query entry quizzes after a none check within 5 minutes, but does later and on a new day', async () => {
    const g = fakeGuild();
    const memory = createReminderMemory();
    const spy = vi.spyOn(await import('@studies/db'), 'dueEntryQuizzes');
    const tick = (...t: [number, number, number, number, number]) =>
      runReminderTick({ ...deps(g.guild), memory }, W(...t));
    await tick(2026, 10, 19, 18, 1);
    await tick(2026, 10, 19, 18, 2);
    await tick(2026, 10, 19, 18, 5);
    expect(spy).toHaveBeenCalledTimes(1);
    await tick(2026, 10, 19, 18, 7);
    expect(spy).toHaveBeenCalledTimes(2);
    await tick(2026, 10, 20, 18, 1);
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
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
      'Unknown user',
    );
    expect(await db.select().from(reminderLog)).toHaveLength(1);
  });

  it('a non-snowflake id (seed-*, qa-*) is refused before any API call', async () => {
    const fetch = vi.fn();
    const g = discordReminderGuild({
      users: { fetch },
    } as unknown as Parameters<typeof discordReminderGuild>[0]);
    for (const id of ['seed-u1', 'qa-student', '123', '1'.repeat(21)]) {
      await expect(g.sendDm(id, 'x')).rejects.toBeInstanceOf(
        NotDiscordAccountError,
      );
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a non-Discord account is disabled once with a reason, not retried', async () => {
    await event(W(2026, 10, 20, 10));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = fakeGuild();
    g.guild.sendDm = vi
      .fn()
      .mockRejectedValue(new NotDiscordAccountError('seed-u1'));
    await runReminderTick(deps(g.guild), W(2026, 10, 19, 10));
    expect(await getReminderPrefs(db, uid)).toEqual({
      dayBefore: false,
      hourBefore: false,
      disabledReason: NOT_A_DISCORD_ACCOUNT,
    });
    expect(NOT_A_DISCORD_ACCOUNT).toBe('Not a Discord account');
    expect(await db.select().from(reminderLog)).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('sends one DM per due entry, logs it, and a new tick sends nothing twice', async () => {
    await event(W(2026, 10, 20, 10));
    const a = fakeGuild();
    await runReminderTick(deps(a.guild), W(2026, 10, 19, 10));
    expect(a.dms.map((d) => d.to)).toEqual(['d1']);
    expect(a.dms[0].content).toMatch(/^Reminder: 📝 Kolos/);
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
      disabledReason: 'DMs closed',
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
    expect(g.digests[0].content).toMatch(/^Tomorrow:\n/);
    expect(await getSetting(db, DIGEST_THREAD_SETTING)).toBe('thread-1');
    // An event added later that evening gets its own short message, same thread.
    await event(W(2026, 10, 20, 12), { title: 'Nowy' });
    await runReminderTick(deps(g.guild), W(2026, 10, 19, 18, 10));
    expect(g.digests).toHaveLength(2);
    expect(g.digests[1].thread).toBe('thread-1');
    expect(g.digests[1].content).toContain('Nowy');
    expect(g.digests[1].content).not.toContain('Kolos');
  });

  describe('entry quizzes in the digest', () => {
    /** Bazy, Laboratorium Gr. 1 with a session tomorrow (20.10) and an entry quiz. */
    async function quizTomorrow(skip = false) {
      const [s] = await db
        .insert(subjects)
        .values({ code: 'BD', name: 'Bazy', semester: 1, ects: 5 })
        .$returningId();
      const [c] = await db
        .insert(classes)
        .values({ subjectId: s.id, kind: 'laboratorium', name: 'Laboratorium' })
        .$returningId();
      const [g] = await db
        .insert(classGroups)
        .values({ classId: c.id, number: 1, name: 'Gr. 1' })
        .$returningId();
      await db.insert(classSessions).values({
        uid: 'q1',
        occurrenceStart: W(2026, 10, 20, 8),
        startsAt: W(2026, 10, 20, 8),
        endsAt: W(2026, 10, 20, 9, 30),
        label: 'L',
        subjectId: s.id,
        classId: c.id,
        groupId: g.id,
      });
      const [m] = await db
        .insert(classMarks)
        .values({ classId: c.id, groupId: null, kind: 'wejsciowka' })
        .$returningId();
      if (skip) {
        await db
          .insert(classMarkSkips)
          .values({ markId: m.id, onDate: '2026-10-20' });
      }
    }

    it('posts the quiz lines with the events, once per day, also after a restart', async () => {
      await setSetting(db, 'events_forum_id', 'forum-1');
      await quizTomorrow();
      await event(W(2026, 10, 20, 10));
      const g = fakeGuild();
      const memory = createReminderMemory();
      await runReminderTick(
        { ...deps(g.guild), memory },
        W(2026, 10, 19, 18, 1),
      );
      expect(g.digests).toHaveLength(1);
      expect(g.digests[0].content).toBe(
        'Tomorrow:\n📝 Kolos · 10:00 · C-12\nEntry quiz: Bazy, Laboratorium Gr. 1',
      );
      expect(await getSetting(db, 'digest_quiz_date')).toBe('2026-10-20');
      // A second tick, and a restarted bot (fresh memory), post nothing.
      await runReminderTick(
        { ...deps(g.guild), memory },
        W(2026, 10, 19, 18, 2),
      );
      await runReminderTick(deps(g.guild), W(2026, 10, 19, 18, 3));
      expect(g.digests).toHaveLength(1);
      // An event added later gets its own message, without the quiz lines.
      await event(W(2026, 10, 20, 12), { title: 'Nowy' });
      await runReminderTick(deps(g.guild), W(2026, 10, 19, 18, 10));
      expect(g.digests).toHaveLength(2);
      expect(g.digests[1].content).not.toContain('Entry quiz');
    });

    it('posts the quiz lines when there are no events', async () => {
      await setSetting(db, 'events_forum_id', 'forum-1');
      await quizTomorrow();
      const g = fakeGuild();
      await runReminderTick(deps(g.guild), W(2026, 10, 19, 18, 1));
      await runReminderTick(deps(g.guild), W(2026, 10, 19, 18, 2));
      expect(g.digests.map((d) => d.content)).toEqual([
        'Tomorrow:\nEntry quiz: Bazy, Laboratorium Gr. 1',
      ]);
    });

    it('a skipped date or a time outside 18:00–18:30 posts nothing', async () => {
      await setSetting(db, 'events_forum_id', 'forum-1');
      await quizTomorrow(true);
      const g = fakeGuild();
      await runReminderTick(deps(g.guild), W(2026, 10, 19, 18, 1));
      expect(g.digests).toEqual([]);
      await db.delete(classMarkSkips);
      await runReminderTick(deps(g.guild), W(2026, 10, 19, 17, 59));
      await runReminderTick(deps(g.guild), W(2026, 10, 19, 18, 30));
      expect(g.digests).toEqual([]);
    });

    it('a failed setSetting does not post the quiz lines twice in this process', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await setSetting(db, 'events_forum_id', 'forum-1');
      await setSetting(db, DIGEST_THREAD_SETTING, 'thread-1');
      await quizTomorrow();
      const g = fakeGuild();
      const memory = createReminderMemory();
      const spy = vi
        .spyOn(await import('@studies/db'), 'setSetting')
        .mockRejectedValueOnce(new Error('db blip'));
      await runReminderTick(
        { ...deps(g.guild), memory },
        W(2026, 10, 19, 18, 1),
      );
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
      await runReminderTick(
        { ...deps(g.guild), memory },
        W(2026, 10, 19, 18, 2),
      );
      expect(g.digests).toHaveLength(1);
    });
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
