import {
  adminAudit,
  botRequests,
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

  it('returns the Polish message for invalid input', async () => {
    cookieSid = alice.sid;
    expect(await A.createEventAction(form({ title: '  ' }))).toEqual({
      ok: false,
      message: 'Tytuł musi mieć od 1 do 100 znaków.',
    });
    expect(await A.createEventAction(form({ date: '' }))).toEqual({
      ok: false,
      message: 'Podaj datę wydarzenia.',
    });
    expect(
      await A.createEventAction(form({ start: '', end: '11:00' })),
    ).toEqual({ ok: false, message: 'Podaj godzinę rozpoczęcia.' });
    expect(await eventRows()).toHaveLength(0);
  });

  it('creates, edits, links, deletes; restore is admin only', async () => {
    cookieSid = alice.sid;
    await expect(
      A.createEventAction(
        form({ subjectId: String(subjectId), base: 'advanced' }),
      ),
    ).rejects.toThrow(/redirect:\/wydarzenia\/\d+/);
    const [ev] = await eventRows();
    expect(ev.title).toBe('Kolokwium z fizyki');
    expect(ev.createdBy).toBe(alice.id);

    await expect(
      A.updateEventAction(ev.id, form({ title: 'Nowy tytuł' })),
    ).rejects.toThrow(`redirect:/s/wydarzenia/${ev.id}`);
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
    expect((await A.restoreEventAction(ev.id)).ok).toBe(true);
    expect((await eventRows())[0].deletedAt).toBeNull();
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
    ).rejects.toThrow(/redirect:\/s\/wydarzenia\/\d+/);
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
      message: 'Nieznana reguła powtarzania.',
    });
    expect(await eventRows()).toHaveLength(before);

    // a missing "do" is refused in Polish
    const bad = await A.createEventAction(form({ repeat: 'weekly' }));
    expect(bad.ok).toBe(false);

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
    await A.retryPostAction(id);
    page = await loadEventPage(id, user);
    expect(page.canRetryPost).toBe(false);
    expect(page.postLine).toBe('Post na Discordzie: w przygotowaniu');
    await db
      .update(botRequests)
      .set({ status: 'failed', error: 'Brak forum' })
      .where(eq(botRequests.target, `event:${id}`));
    page = await loadEventPage(id, user);
    expect(page.canRetryPost).toBe(true);
    expect(page.postLine).toBe('Post na Discordzie: błąd (Brak forum)');
    await db.update(events).set({ topicId }).where(eq(events.id, id));
    page = await loadEventPage(id, user);
    expect(page.canRetryPost).toBe(false);
  });
});
