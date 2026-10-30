import {
  adminAudit,
  botRequests,
  CONFLICT,
  consumeLoginToken,
  createLoginToken,
  type Db,
  events,
  eventTopics,
  subjects,
  topics,
  upsertUser,
  users,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let db: Db;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

let cookieSid: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (n: string) =>
      n === 'sid' && cookieSid ? { name: n, value: cookieSid } : undefined,
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
const counts = vi.hoisted(() => ({ invalidated: 0 }));
vi.mock('../lib/count-cache', () => ({
  invalidateCounts: () => {
    counts.invalidated++;
  },
}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}));

const A = await import('../lib/event-actions');

async function login(discordUserId: string) {
  const id = await upsertUser(db, {
    discordUserId,
    displayName: discordUserId,
    avatarUrl: null,
  });
  const r = await consumeLoginToken(db, await createLoginToken(db, id));
  return { id, sid: (r as { sessionToken: string }).sessionToken };
}

const future = () => {
  const d = new Date(Date.now() + 5 * 86_400_000);
  return d.toISOString().slice(0, 10);
};
function form(o: Record<string, string> = {}) {
  const f = new FormData();
  const base: Record<string, string> = {
    kind: 'kolokwium',
    title: 'Kolokwium z fizyki',
    date: future(),
    start: '10:00',
    end: '11:30',
    place: 'C-12',
    ...o,
  };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

let alice: { id: number; sid: string };
let admin: { id: number; sid: string };
let banned: { id: number; sid: string };
let subjectId: number;
let topicId: number;

beforeAll(async () => {
  db = await resetTestDb();
  [{ id: subjectId }] = await db
    .insert(subjects)
    .values({ name: 'Alfa', code: 'ALF', semester: 1, ects: 1 })
    .$returningId();
  alice = await login('alice');
  admin = await login('admin');
  banned = await login('banned');
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id));
  [{ id: topicId }] = await db
    .insert(topics)
    .values({ subjectId, title: 'Zadania z tarcia', discordThreadId: 't1' })
    .$returningId();
  await db
    .insert(topics)
    .values({ subjectId, title: 'Inny temat', discordThreadId: 't2' });
});
afterAll(() => closeTestDb(db));

const eventRows = () => db.select().from(events);

describe('event actions', () => {
  it('every action requires a session', async () => {
    cookieSid = undefined;
    await expect(A.createEventAction(form())).rejects.toThrow('redirect');
    await expect(A.updateEventAction(1, form())).rejects.toThrow('redirect');
    await expect(A.deleteEventAction(1)).rejects.toThrow('redirect');
    await expect(A.linkTopicAction(1, 1)).rejects.toThrow('redirect');
    await expect(A.unlinkTopicAction(1, 1)).rejects.toThrow('redirect');
    await expect(A.searchTopicsAction(null, 'a')).rejects.toThrow('redirect');
    expect(await eventRows()).toHaveLength(0);
  });

  it('a banned user writes nothing', async () => {
    await db
      .update(users)
      .set({ isBanned: true })
      .where(eq(users.id, banned.id));
    cookieSid = banned.sid;
    let r: unknown;
    try {
      r = await A.createEventAction(form());
    } catch (e) {
      r = String(e);
    }
    expect(JSON.stringify(r)).not.toContain('redirect:/s/wydarzenia');
    expect(await eventRows()).toHaveLength(0);
  });

  it('returns the English message and its field for invalid input', async () => {
    cookieSid = alice.sid;
    expect(await A.createEventAction(form({ title: '  ' }))).toEqual({
      ok: false,
      message: 'The title must be 1 to 100 characters.',
      field: 'title',
    });
    expect(await A.createEventAction(form({ date: '' }))).toEqual({
      ok: false,
      message: 'Enter the event date.',
      field: 'date',
    });
    expect(
      await A.createEventAction(form({ start: '', end: '11:00' })),
    ).toEqual({ ok: false, message: 'Enter the start time.', field: 'start' });
    // the db's subject check names the Subject select
    expect(
      await A.createEventAction(form({ subjectId: '999999' })),
    ).toMatchObject({ ok: false, field: 'subjectId' });
    expect(await eventRows()).toHaveLength(0);
  });

  it('creates, edits, links, deletes; restore is admin only', async () => {
    cookieSid = alice.sid;
    const invalidated = counts.invalidated;
    await expect(
      A.createEventAction(
        form({ subjectId: String(subjectId), base: 'advanced' }),
      ),
    ).rejects.toThrow(/redirect:\/wydarzenia\/\d+\?notice=event-saved$/);
    // the v_events count in the nav is dropped from the cache
    expect(counts.invalidated).toBeGreaterThan(invalidated);
    const [ev] = await eventRows();
    expect(ev.title).toBe('Kolokwium z fizyki');
    expect(ev.createdBy).toBe(alice.id);

    await expect(
      A.updateEventAction(ev.id, form({ title: 'Nowy tytuł' })),
    ).rejects.toThrow(`redirect:/s/wydarzenia/${ev.id}?notice=event-saved`);
    expect((await eventRows())[0].title).toBe('Nowy tytuł');

    expect((await A.linkTopicAction(ev.id, topicId)).ok).toBe(true);
    expect(await db.select().from(eventTopics)).toHaveLength(1);
    expect((await A.unlinkTopicAction(ev.id, topicId)).ok).toBe(true);
    expect(await db.select().from(eventTopics)).toHaveLength(0);
    expect((await A.linkTopicAction(ev.id, -1)).ok).toBe(false);

    await expect(A.deleteEventAction(ev.id)).rejects.toThrow(
      'redirect:/s/plan',
    );
    expect((await eventRows())[0].deletedAt).not.toBeNull();

    await expect(A.restoreEventAction(ev.id)).rejects.toThrow('notFound');
    expect((await eventRows())[0].deletedAt).not.toBeNull();
    cookieSid = admin.sid;
    await expect(A.restoreEventAction(ev.id)).rejects.toThrow(
      `redirect:/s/wydarzenia/${ev.id}?notice=event-restored`,
    );
    expect((await eventRows())[0].deletedAt).toBeNull();
    // From the edit form: no redirect (it would drop the typed values).
    await A.deleteEventAction(ev.id).catch(() => {});
    expect((await A.restoreEventAction(ev.id, 'advanced', 'edit')).ok).toBe(
      true,
    );
    expect((await eventRows())[0].deletedAt).toBeNull();
    // Already live (a double click, another admin): same confirmation.
    await expect(A.restoreEventAction(ev.id)).rejects.toThrow(
      `redirect:/s/wydarzenia/${ev.id}?notice=event-restored`,
    );
    // An event that does not exist: the refusal comes back, no redirect.
    expect((await A.restoreEventAction(999_999)).ok).toBe(false);
  });

  it('a stale version is refused; the current one saves', async () => {
    cookieSid = alice.sid;
    await expect(
      A.createEventAction(form({ title: 'Wersje' })),
    ).rejects.toThrow('redirect');
    const ev = (await eventRows()).find((e) => e.title === 'Wersje');
    if (!ev) throw new Error('no event');
    const { version } = ev;
    await expect(
      A.updateEventAction(ev.id, form({ title: 'Inna', version: '99' })),
    ).resolves.toEqual({ ok: false, message: CONFLICT });
    expect((await eventRows()).find((e) => e.id === ev.id)?.title).toBe(
      'Wersje',
    );
    await expect(
      A.updateEventAction(
        ev.id,
        form({ title: 'Nowa', version: String(version) }),
      ),
    ).rejects.toThrow('redirect');
    const after = (await eventRows()).find((e) => e.id === ev.id);
    expect(after?.title).toBe('Nowa');
    // the old version is now stale, also for a delete
    expect(await A.deleteEventAction(ev.id, 'simple', 'one', version)).toEqual({
      ok: false,
      message: CONFLICT,
    });
    await expect(
      A.deleteEventAction(ev.id, 'simple', 'one', version + 1),
    ).rejects.toThrow('redirect:/s/plan');
  });

  it('a delete of an already deleted event lands on the timetable with a notice', async () => {
    cookieSid = alice.sid;
    await expect(
      A.createEventAction(form({ title: 'Dwuklik' })),
    ).rejects.toThrow('redirect');
    const ev = (await eventRows()).find((e) => e.title === 'Dwuklik');
    if (!ev) throw new Error('no event');
    const toPlan = /^redirect:\/s\/plan\?notice=event-deleted$/;
    await expect(
      A.deleteEventAction(ev.id, 'simple', 'one', ev.version),
    ).rejects.toThrow(toPlan);
    const audits = async () =>
      (await db.select().from(adminAudit)).filter(
        (a) => a.action === 'event.delete' && a.target === String(ev.id),
      );
    expect(await audits()).toHaveLength(1);
    // The second click of a double click, or a stale tab (its version is old).
    await expect(
      A.deleteEventAction(ev.id, 'simple', 'one', ev.version),
    ).rejects.toThrow(toPlan);
    await expect(A.deleteEventAction(ev.id, 'advanced')).rejects.toThrow(
      /^redirect:\/plan\?notice=event-deleted$/,
    );
    // An id that never existed reads the same, so nothing is revealed.
    await expect(A.deleteEventAction(999_999)).rejects.toThrow(toPlan);
    expect(await audits()).toHaveLength(1);
  });

  it('searches posts by title within the subject, at most 20', async () => {
    cookieSid = alice.sid;
    const r = await A.searchTopicsAction(subjectId, 'tarc');
    expect(r.map((t) => t.title)).toEqual(['Zadania z tarcia']);
    expect(await A.searchTopicsAction(null, '')).toHaveLength(2);
    expect(await A.searchTopicsAction(subjectId, '%')).toHaveLength(0);
  });
  it('repeats weekly, then edits and deletes with a scope', async () => {
    cookieSid = alice.sid;
    await db.delete(events);
    const until = new Date(Date.now() + 5 * 86_400_000 + 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await expect(
      A.createEventAction(form({ repeat: 'weekly', until })),
    ).rejects.toThrow(/redirect:\/s\/wydarzenia\/\d+\?notice=event-saved$/);
    const rows = async () => (await eventRows()).sort((a, b) => a.id - b.id);
    const all = await rows();
    expect(all).toHaveLength(3);
    expect(new Set(all.map((e) => e.seriesId)).size).toBe(1);
    expect(all[0].seriesId).not.toBeNull();

    // an unknown rule is refused, not turned into a single event
    const before = (await eventRows()).length;
    const unknown = await A.createEventAction(form({ repeat: 'daily', until }));
    expect(unknown).toEqual({
      ok: false,
      message: 'Unknown repeat rule.',
      field: 'repeat',
    });
    expect(await eventRows()).toHaveLength(before);

    // a missing "do" is refused, about Until
    const bad = await A.createEventAction(form({ repeat: 'weekly' }));
    expect(bad).toMatchObject({ ok: false, field: 'until' });
    // more than the series' cap of occurrences is about Until too
    const far = new Date(Date.now() + 300 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const tooMany = await A.createEventAction(
      form({ repeat: 'weekly', until: far }),
    );
    expect(tooMany).toMatchObject({
      ok: false,
      message: expect.stringContaining('occurrences'),
      field: 'until',
    });
    // so is an end date before the first event (the db's own message)
    const before2 = await A.createEventAction(
      form({ repeat: 'weekly', until: '2000-01-01' }),
    );
    expect(before2).toMatchObject({ ok: false, field: 'until' });
    expect(await eventRows()).toHaveLength(before);

    await expect(
      A.updateEventAction(
        all[1].id,
        form({ title: 'Tylko drugi', scope: 'one' }),
      ),
    ).rejects.toThrow('redirect');
    expect((await rows()).map((e) => e.title)).toEqual([
      'Kolokwium z fizyki',
      'Tylko drugi',
      'Kolokwium z fizyki',
    ]);
    await expect(
      A.updateEventAction(
        all[1].id,
        form({ title: 'Od drugiego', scope: 'following' }),
      ),
    ).rejects.toThrow('redirect');
    expect((await rows()).map((e) => e.title)).toEqual([
      'Kolokwium z fizyki',
      'Od drugiego',
      'Od drugiego',
    ]);

    await expect(
      A.deleteEventAction(all[1].id, 'simple', 'following'),
    ).rejects.toThrow('redirect:/s/plan');
    expect((await rows()).map((e) => e.deletedAt !== null)).toEqual([
      false,
      true,
      true,
    ]);
  });
});

describe('retryPostAction', () => {
  const mk = async () => {
    const [{ id }] = await db
      .insert(events)
      .values({ kind: 'inne', title: 'Bez posta', startsAt: new Date() })
      .$returningId();
    return id;
  };
  const queued = async (id: number) =>
    (await db.select().from(botRequests)).filter(
      (r) => r.target === `event:${id}` && r.status === 'queued',
    );

  it('requires a session and refuses banned users', async () => {
    const id = await mk();
    cookieSid = undefined;
    await expect(A.retryPostAction(id)).rejects.toThrow('redirect');
    cookieSid = banned.sid;
    await A.retryPostAction(id).catch(() => null);
    expect(await queued(id)).toHaveLength(0);
  });

  it('queues the upsert and audits event.post_retry from the web', async () => {
    const id = await mk();
    cookieSid = alice.sid;
    expect((await A.retryPostAction(id)).ok).toBe(true);
    expect(await queued(id)).toHaveLength(1);
    const audit = (await db.select().from(adminAudit)).filter(
      (a) => a.action === 'event.post_retry' && a.target === String(id),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toMatchObject({ source: 'web' });
    expect(await A.retryPostAction(-1)).toMatchObject({ ok: false });
  });

  it('the page offers the retry when the request failed or is missing', async () => {
    const { loadEventPage } = await import('../lib/event-page');
    const id = await mk();
    const user = { id: alice.id, isAdmin: false } as never;
    let page = await loadEventPage(id, user);
    expect(page.canRetryPost).toBe(true);
    // No post and nothing queued: the line explains the "Try again".
    expect(page.postLine).toBe('Discord post: none');
    await A.retryPostAction(id);
    page = await loadEventPage(id, user);
    expect(page.canRetryPost).toBe(false);
    // On its way: nothing to tell a student.
    expect(page.postLine).toBeNull();
    await db
      .update(botRequests)
      .set({ status: 'failed', error: 'Brak forum' })
      .where(eq(botRequests.target, `event:${id}`));
    page = await loadEventPage(id, user);
    expect(page.canRetryPost).toBe(true);
    expect(page.postLine).toBe('Discord post: failed (Brak forum)');
    await db.update(events).set({ topicId }).where(eq(events.id, id));
    page = await loadEventPage(id, user);
    expect(page.canRetryPost).toBe(false);
    expect(page.postLine).toBeNull();
  });
});

describe('eventHistory', () => {
  it('includes the rows of the event and of its series', async () => {
    const { eventHistory } = await import('../lib/event-queries');
    const { writeAudit } = await import('@studies/db');
    const row = (target: string, action: string) =>
      writeAudit(db, { userId: alice.id, action, target, details: {} });
    await row('9001', 'event.edit');
    await row('series:77', 'event.upload_retry');
    await row('series:78', 'event.edit');
    await row('9002', 'event.edit');
    const h = await eventHistory(db, 9001, 77);
    expect(h.map((r) => [r.target, r.action])).toEqual([
      ['series:77', 'event.upload_retry'],
      ['9001', 'event.edit'],
    ]);
    expect((await eventHistory(db, 9001, null)).map((r) => r.target)).toEqual([
      '9001',
    ]);
  });
});
