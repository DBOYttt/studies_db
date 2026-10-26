import { and, count, eq } from 'drizzle-orm';
import type mysql from 'mysql2/promise';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createDb, type Db } from '../src/client.js';
import {
  addEvent,
  BANNED_MESSAGE,
  CONFLICT,
  deleteEvent,
  type EventInput,
  editEvent,
  eventMaterials,
  getEvent,
  linkTopic,
  listEventsInRange,
  listUpcomingEvents,
  restoreEvent,
  unlinkTopic,
} from '../src/events.js';
import { parseWhen } from '../src/plan.js';
import {
  adminAudit,
  botRequests,
  classes,
  classGroups,
  events,
  eventTopics,
  materials,
  subjects,
  topics,
  users,
} from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

/** Wall Date: UTC fields equal the Warsaw wall clock. */
const W = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi));

describe('parseWhen', () => {
  const now = W(2026, 10, 15, 12);
  it('parses a date with a time range', () => {
    expect(parseWhen('20.10 10:00-11:30', now)).toEqual({
      ok: true,
      startsAt: W(2026, 10, 20, 10),
      endsAt: W(2026, 10, 20, 11, 30),
      allDay: false,
    });
    expect(parseWhen(' 20.10  10:00 – 11:30 ', now)).toMatchObject({
      ok: true,
      endsAt: W(2026, 10, 20, 11, 30),
    });
  });
  it('a date alone is all-day', () => {
    expect(parseWhen('20.10', now)).toEqual({
      ok: true,
      startsAt: W(2026, 10, 20),
      endsAt: null,
      allDay: true,
    });
  });
  it('no year: the nearest date (next January)', () => {
    expect(parseWhen('05.01', now)).toMatchObject({
      ok: true,
      startsAt: W(2027, 1, 5),
    });
    expect(parseWhen('05.01', W(2026, 12, 20))).toMatchObject({
      ok: true,
      startsAt: W(2027, 1, 5),
    });
  });
  it('explicit year and a start time only', () => {
    expect(parseWhen('20.12.2026 08:00', now)).toEqual({
      ok: true,
      startsAt: W(2026, 12, 20, 8),
      endsAt: null,
      allDay: false,
    });
  });
  it('refuses more than a month in the past, not moving it to next year', () => {
    expect(parseWhen('10.09', now).ok).toBe(false);
    expect(parseWhen('16.09', now).ok).toBe(true);
    expect(parseWhen('10.09.2027', now).ok).toBe(true);
  });
  it('refuses more than a year ahead', () => {
    expect(parseWhen('14.10.2027', now).ok).toBe(true);
    expect(parseWhen('16.10.2027', now).ok).toBe(false);
  });
  it('refuses an end not after the start', () => {
    expect(parseWhen('20.10 12:00-11:00', now).ok).toBe(false);
    expect(parseWhen('20.10 12:00-12:00', now).ok).toBe(false);
  });
  it('refuses invalid dates, times and formats', () => {
    for (const t of [
      '32.10',
      '31.11',
      '29.02.2027',
      '20.13',
      '20.10 24:00',
      '20.10 10:60',
      '',
      'jutro',
      '20.10 10',
      '20/10',
    ]) {
      const r = parseWhen(t, now);
      expect(r.ok, t).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/\S/);
    }
  });
});

describe('event actions', () => {
  let db: Db;
  let pool: mysql.Pool;
  const id: Record<string, number> = {};
  let thread = 0;

  /** A date ~5 days from the real now, in the "Kiedy" format. */
  const soon = (days = 5, time = '10:00-11:30') => {
    const d = new Date(Date.now() + days * 86_400_000);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${d.getUTCFullYear()} ${time}`.trim();
  };
  const input = (o: Partial<EventInput> = {}): EventInput => ({
    kind: 'kolokwium',
    title: 'Kolokwium 1',
    subjectId: id.subA,
    when: soon(),
    ...o,
  });
  const auditRows = (action: string, target: string) =>
    db
      .select()
      .from(adminAudit)
      .where(and(eq(adminAudit.action, action), eq(adminAudit.target, target)));
  const counts = async () => {
    const [e] = await db.select({ n: count() }).from(events);
    const [a] = await db.select({ n: count() }).from(adminAudit);
    const [r] = await db.select({ n: count() }).from(botRequests);
    const [l] = await db.select({ n: count() }).from(eventTopics);
    return { e: e.n, a: a.n, r: r.n, l: l.n };
  };
  const topic = async (subjectId: number | null, title = 'Post') =>
    (
      await db
        .insert(topics)
        .values({ subjectId, title, discordThreadId: `th${++thread}` })
        .$returningId()
    )[0].id;
  const user = async (
    name: string,
    o: Partial<typeof users.$inferInsert> = {},
  ) =>
    (
      await db
        .insert(users)
        .values({ discordUserId: `d-${name}`, displayName: name, ...o })
        .$returningId()
    )[0].id;

  beforeAll(async () => {
    db = await resetTestDb();
    pool = createDb(process.env.TEST_DATABASE_URL as string).pool;
    id.u = await user('Ala');
    id.u2 = await user('Bartek');
    id.banned = await user('Zbanowany', { isBanned: true });
    id.admin = await user('Admin', { isAdmin: true });
    id.limited = await user('Limit');
    const subj = async (code: string, name: string) =>
      (
        await db
          .insert(subjects)
          .values({ code, name, semester: 1, ects: 5 })
          .$returningId()
      )[0].id;
    id.subA = await subj('BD', 'Bazy danych');
    id.subB = await subj('FIZ', 'Fizyka');
    const cls = async (subjectId: number) =>
      (
        await db
          .insert(classes)
          .values({ subjectId, kind: 'laboratorium', name: 'Laboratorium' })
          .$returningId()
      )[0].id;
    id.cA = await cls(id.subA);
    id.cB = await cls(id.subB);
    const grp = async (classId: number, number: number) =>
      (
        await db
          .insert(classGroups)
          .values({ classId, number, name: `Gr. ${number}` })
          .$returningId()
      )[0].id;
    id.gA1 = await grp(id.cA, 1);
    id.gB1 = await grp(id.cB, 1);
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb(db);
  });
  // Keep the main test user under the hourly add limit.
  beforeEach(async () => {
    await db
      .delete(adminAudit)
      .where(
        and(eq(adminAudit.userId, id.u), eq(adminAudit.action, 'event.add')),
      );
  });

  describe('validation', () => {
    it('refuses a title of 0 or 101 characters', async () => {
      const before = await counts();
      for (const title of ['', '   ', 'x'.repeat(101)]) {
        const r = await addEvent(db, id.u, input({ title }), 'web');
        expect(r.ok).toBe(false);
        expect(r.message).toBe('The title must be 1 to 100 characters.');
      }
      expect(
        (await addEvent(db, id.u, input({ title: 'x'.repeat(100) }), 'web')).ok,
      ).toBe(true);
      expect((await counts()).e).toBe(before.e + 1);
    });
    it('refuses a too long place or note and a bad kind', async () => {
      expect(
        (await addEvent(db, id.u, input({ place: 'p'.repeat(101) }), 'web')).ok,
      ).toBe(false);
      expect(
        (await addEvent(db, id.u, input({ note: 'n'.repeat(1001) }), 'web')).ok,
      ).toBe(false);
      expect(
        (
          await addEvent(
            db,
            id.u,
            input({ kind: 'impreza' as EventInput['kind'] }),
            'web',
          )
        ).ok,
      ).toBe(false);
    });
    it('refuses an invalid "Kiedy" with the parseWhen message', async () => {
      const r = await addEvent(db, id.u, input({ when: '32.10' }), 'web');
      expect(r.ok).toBe(false);
      expect(r.message).toBe(
        (parseWhen('32.10', new Date()) as { message: string }).message,
      );
    });
    it('refuses a class of another subject', async () => {
      const r = await addEvent(db, id.u, input({ classId: id.cB }), 'web');
      expect(r).toEqual({
        ok: false,
        message: 'The chosen class does not belong to this subject.',
      });
    });
    it('refuses a group of another class', async () => {
      const r = await addEvent(
        db,
        id.u,
        input({ classId: id.cA, groupId: id.gB1 }),
        'web',
      );
      expect(r).toEqual({
        ok: false,
        message: 'The chosen group does not belong to this class.',
      });
    });
    it('refuses a class without a subject and an unknown subject', async () => {
      expect(
        (
          await addEvent(
            db,
            id.u,
            input({ subjectId: null, classId: id.cA }),
            'web',
          )
        ).ok,
      ).toBe(false);
      expect(
        (await addEvent(db, id.u, input({ subjectId: 999_999 }), 'web')).ok,
      ).toBe(false);
    });
    it('a group alone fills in its class', async () => {
      const r = await addEvent(db, id.u, input({ groupId: id.gA1 }), 'web');
      expect(r.ok).toBe(true);
      const [e] = await db
        .select()
        .from(events)
        .where(eq(events.id, r.id as number));
      expect(e).toMatchObject({ classId: id.cA, groupId: id.gA1 });
    });
    it('the 11th event within an hour is refused', async () => {
      for (let i = 0; i < 10; i++) {
        const r = await addEvent(db, id.limited, input(), 'discord');
        expect(r.ok).toBe(true);
      }
      const before = await counts();
      const r = await addEvent(db, id.limited, input(), 'discord');
      expect(r).toEqual({
        ok: false,
        message: 'You can add at most 10 events per hour. Try again later.',
      });
      expect(await counts()).toEqual(before);
    });
  });

  describe('mutations', () => {
    it('addEvent inserts, audits once and enqueues an upsert', async () => {
      const r = await addEvent(
        db,
        id.u,
        input({ place: ' C-12 ', note: '', classId: id.cA }),
        'discord',
      );
      expect(r.ok).toBe(true);
      expect(r.message).toBe('Event added.');
      const eid = r.id as number;
      const [e] = await db.select().from(events).where(eq(events.id, eid));
      expect(e).toMatchObject({
        kind: 'kolokwium',
        title: 'Kolokwium 1',
        subjectId: id.subA,
        classId: id.cA,
        groupId: null,
        allDay: false,
        place: 'C-12',
        note: null,
        createdBy: id.u,
        updatedBy: id.u,
        deletedAt: null,
      });
      const audit = await auditRows('event.add', String(eid));
      expect(audit).toHaveLength(1);
      expect(audit[0].userId).toBe(id.u);
      expect(audit[0].details).toMatchObject({
        source: 'discord',
        fields: { title: 'Kolokwium 1', place: 'C-12' },
      });
      const reqs = await db
        .select()
        .from(botRequests)
        .where(eq(botRequests.target, `event:${eid}`));
      expect(reqs).toMatchObject([
        { kind: 'event_post_upsert', status: 'queued' },
      ]);
    });

    it('an event without a subject is fine', async () => {
      const r = await addEvent(
        db,
        id.u,
        input({ subjectId: null, kind: 'wyjazd', when: soon(6, '') }),
        'web',
      );
      expect(r.ok).toBe(true);
      const ev = await getEvent(db, r.id as number);
      expect(ev).toMatchObject({
        subjectId: null,
        subjectCode: null,
        allDay: true,
        endsAt: null,
      });
      expect(ev?.startsAt.getUTCHours()).toBe(0);
    });

    it('editEvent changes fields, audits the changes and enqueues an upsert', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      await db.delete(botRequests);
      const r = await editEvent(
        db,
        id.u2,
        eid as number,
        { title: 'Kolokwium 2', when: soon(7, '12:00-13:00') },
        'web',
      );
      expect(r).toEqual({ ok: true, message: 'Changes saved.' });
      const ev = await getEvent(db, eid as number);
      expect(ev).toMatchObject({
        title: 'Kolokwium 2',
        updatedBy: id.u2,
        updatedByName: 'Bartek',
        createdByName: 'Ala',
        subjectCode: 'BD',
        subjectName: 'Bazy danych',
      });
      expect(ev?.startsAt.getUTCHours()).toBe(12);
      const audit = await auditRows('event.edit', String(eid));
      expect(audit).toHaveLength(1);
      expect(audit[0].userId).toBe(id.u2);
      expect(audit[0].details).toMatchObject({
        source: 'web',
        changes: { title: { from: 'Kolokwium 1', to: 'Kolokwium 2' } },
      });
      const reqs = await db.select().from(botRequests);
      expect(reqs).toMatchObject([
        { kind: 'event_post_upsert', target: `event:${eid}` },
      ]);
    });

    it('getEvent loads the event, subject and both names in one query plus the links', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      await editEvent(db, id.u, eid as number, { title: 'Kolokwium 3' }, 'web');
      const select = vi.spyOn(db, 'select');
      try {
        const ev = await getEvent(db, eid as number);
        expect(ev).toMatchObject({
          title: 'Kolokwium 3',
          createdByName: 'Ala',
          updatedByName: 'Ala',
          subjectCode: 'BD',
          subjectName: 'Bazy danych',
          series: null,
          linkedTopicIds: [],
        });
        expect(select).toHaveBeenCalledTimes(2);
      } finally {
        select.mockRestore();
      }
      expect(await getEvent(db, 999_999)).toBeNull();
    });

    it('editEvent validates the merged event; a subject change clears class/group', async () => {
      const { id: eid } = await addEvent(
        db,
        id.u,
        input({ groupId: id.gA1 }),
        'web',
      );
      expect(
        (await editEvent(db, id.u, eid as number, { classId: id.cB }, 'web'))
          .ok,
      ).toBe(false);
      expect(
        (await editEvent(db, id.u, eid as number, { title: '' }, 'web')).ok,
      ).toBe(false);
      const r = await editEvent(
        db,
        id.u,
        eid as number,
        { subjectId: id.subB },
        'web',
      );
      expect(r.ok).toBe(true);
      expect(await getEvent(db, eid as number)).toMatchObject({
        subjectId: id.subB,
        classId: null,
        groupId: null,
      });
      expect(
        (await editEvent(db, id.u, 999_999, { title: 'x' }, 'web')).ok,
      ).toBe(false);
    });

    it('deleteEvent soft-deletes, audits and enqueues an archive; restore is admin only', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      await db.delete(botRequests);
      const r = await deleteEvent(db, id.u2, eid as number, 'discord');
      expect(r).toEqual({ ok: true, message: 'Event deleted.' });
      expect((await getEvent(db, eid as number))?.deletedAt).toBeInstanceOf(
        Date,
      );
      expect(await auditRows('event.delete', String(eid))).toMatchObject([
        { userId: id.u2, details: { source: 'discord' } },
      ]);
      expect(await db.select().from(botRequests)).toMatchObject([
        { kind: 'event_post_archive', target: `event:${eid}` },
      ]);
      // a deleted event can't be edited or deleted again
      expect(
        (await editEvent(db, id.u, eid as number, { title: 'x' }, 'web')).ok,
      ).toBe(false);
      expect((await deleteEvent(db, id.u, eid as number, 'web')).ok).toBe(
        false,
      );

      const before = await counts();
      const nope = await restoreEvent(db, id.u, eid as number);
      expect(nope.ok).toBe(false);
      expect(await counts()).toEqual(before);

      await db.delete(botRequests);
      const ok = await restoreEvent(db, id.admin, eid as number);
      expect(ok).toEqual({ ok: true, message: 'Event restored.' });
      expect((await getEvent(db, eid as number))?.deletedAt).toBeNull();
      expect(await auditRows('event.restore', String(eid))).toMatchObject([
        { userId: id.admin, details: { source: 'web' } },
      ]);
      expect(await db.select().from(botRequests)).toMatchObject([
        { kind: 'event_post_upsert', target: `event:${eid}` },
      ]);
    });

    it('refuses an inherited property name as the kind', async () => {
      for (const kind of ['toString', 'constructor', '__proto__']) {
        expect(
          await addEvent(db, id.u, input({ kind: kind as never }), 'web'),
        ).toEqual({ ok: false, message: 'Unknown event type.' });
      }
    });

    it('a banned user is refused by every mutation with no rows written', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      const t = await topic(id.subA);
      await linkTopic(db, id.u, eid as number, t, 'web');
      const before = await counts();
      const results = [
        await addEvent(db, id.banned, input(), 'web'),
        await editEvent(db, id.banned, eid as number, { title: 'x' }, 'web'),
        await deleteEvent(db, id.banned, eid as number, 'web'),
        await restoreEvent(db, id.banned, eid as number),
        await linkTopic(
          db,
          id.banned,
          eid as number,
          await topic(id.subA),
          'web',
        ),
        await unlinkTopic(db, id.banned, eid as number, t, 'web'),
      ];
      for (const r of results) {
        expect(r).toEqual({ ok: false, message: BANNED_MESSAGE });
      }
      expect(BANNED_MESSAGE).toBe('Your access to the website is blocked.');
      expect(await counts()).toEqual(before);
    });
  });

  describe('optimistic version', () => {
    const edits = (eid: number) => auditRows('event.edit', String(eid));
    it('editEvent with the current version succeeds and bumps it', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      const v0 = (await getEvent(db, eid as number))?.version;
      expect(v0).toBe(0);
      const r = await editEvent(
        db,
        id.u,
        eid as number,
        { title: 'Nowy' },
        'web',
        'one',
        { expectedVersion: v0 },
      );
      expect(r.ok).toBe(true);
      expect((await getEvent(db, eid as number))?.version).toBe(1);
    });
    it('a stale version is refused with no write, audit or request', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      await editEvent(db, id.u, eid as number, { title: 'B' }, 'web');
      const reqs = (await db.select().from(botRequests)).length;
      const audits = (await edits(eid as number)).length;
      const r = await editEvent(
        db,
        id.u,
        eid as number,
        { title: 'C' },
        'web',
        'one',
        { expectedVersion: 0 },
      );
      expect(r).toEqual({ ok: false, message: CONFLICT });
      expect((await getEvent(db, eid as number))?.title).toBe('B');
      expect((await edits(eid as number)).length).toBe(audits);
      expect((await db.select().from(botRequests)).length).toBe(reqs);
    });
    it('an unchanged save with a stale version is also a conflict', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      await editEvent(db, id.u, eid as number, { title: 'B' }, 'web');
      const r = await editEvent(
        db,
        id.u,
        eid as number,
        { title: 'B' },
        'web',
        'one',
        { expectedVersion: 0 },
      );
      expect(r).toEqual({ ok: false, message: CONFLICT });
    });
    it('without expectedVersion there is no check', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      await editEvent(db, id.u, eid as number, { title: 'B' }, 'web');
      const r = await editEvent(db, id.u, eid as number, { title: 'C' }, 'web');
      expect(r.ok).toBe(true);
      expect((await getEvent(db, eid as number))?.version).toBe(2);
    });
    it('deleteEvent with a stale version is refused; a current one deletes', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      await editEvent(db, id.u, eid as number, { title: 'B' }, 'web');
      const r = await deleteEvent(db, id.u, eid as number, 'web', 'one', {
        expectedVersion: 0,
      });
      expect(r).toEqual({ ok: false, message: CONFLICT });
      expect((await getEvent(db, eid as number))?.deletedAt).toBeNull();
      const ok = await deleteEvent(db, id.u, eid as number, 'web', 'one', {
        expectedVersion: 1,
      });
      expect(ok.ok).toBe(true);
      expect((await getEvent(db, eid as number))?.version).toBe(2);
    });
    // A db whose first transaction fails with 1020 after `race` ran on the
    // real db, as when a concurrent commit lands between two attempts.
    const racingDb = (race: () => Promise<unknown>) => {
      let calls = 0;
      return new Proxy(db, {
        get(target, prop) {
          if (prop === 'transaction') {
            return async (fn: Parameters<Db['transaction']>[0]) => {
              if (++calls === 1) {
                await race();
                throw { errno: 1020 };
              }
              return target.transaction(fn);
            };
          }
          const v = Reflect.get(target, prop, target);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      }) as Db;
    };
    it('without expectedVersion a retried edit applies the patch to the current row', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      const r = await editEvent(
        racingDb(() =>
          editEvent(db, id.u2, eid as number, { title: 'Od B' }, 'web'),
        ),
        id.u,
        eid as number,
        { classId: id.cA, groupId: id.gA1 },
        'discord',
      );
      expect(r.ok, r.message).toBe(true);
      const e = await getEvent(db, eid as number);
      expect(e?.title).toBe('Od B');
      expect(e?.groupId).toBe(id.gA1);
      expect(e?.version).toBe(2);
    });
    it('without expectedVersion an edit of an event deleted meanwhile is refused', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      const r = await editEvent(
        racingDb(() => deleteEvent(db, id.u2, eid as number, 'web')),
        id.u,
        eid as number,
        { title: 'Za późno' },
        'web',
      );
      expect(r).toEqual({ ok: false, message: 'Event not found.' });
      const e = await getEvent(db, eid as number);
      expect(e?.deletedAt).not.toBeNull();
      expect(e?.title).toBe('Kolokwium 1');
    });
    it('linkTopic and unlinkTopic bump the version', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      const t = await topic(id.subA);
      await linkTopic(db, id.u, eid as number, t, 'web');
      expect((await getEvent(db, eid as number))?.version).toBe(1);
      await unlinkTopic(db, id.u, eid as number, t, 'web');
      expect((await getEvent(db, eid as number))?.version).toBe(2);
    });
  });

  describe('links', () => {
    it('links a topic of the same subject once, audits link and unlink', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      const t = await topic(id.subA);
      const r = await linkTopic(db, id.u, eid as number, t, 'discord');
      expect(r).toEqual({ ok: true, message: 'Post linked.' });
      expect((await getEvent(db, eid as number))?.linkedTopicIds).toEqual([t]);
      expect(await auditRows('event.link', String(eid))).toMatchObject([
        { details: { source: 'discord', topicId: t } },
      ]);
      expect((await linkTopic(db, id.u, eid as number, t, 'web')).ok).toBe(
        false,
      );
      const u = await unlinkTopic(db, id.u, eid as number, t, 'web');
      expect(u).toEqual({ ok: true, message: 'Link removed.' });
      expect(await auditRows('event.unlink', String(eid))).toMatchObject([
        { details: { source: 'web', topicId: t } },
      ]);
      expect((await unlinkTopic(db, id.u, eid as number, t, 'web')).ok).toBe(
        false,
      );
    });

    it('refuses a topic of another subject; any topic when the event has none', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      const other = await topic(id.subB);
      const none = await topic(null);
      expect(await linkTopic(db, id.u, eid as number, other, 'web')).toEqual({
        ok: false,
        message: 'This post belongs to a different subject.',
      });
      expect((await linkTopic(db, id.u, eid as number, none, 'web')).ok).toBe(
        false,
      );
      const { id: free } = await addEvent(
        db,
        id.u,
        input({ subjectId: null }),
        'web',
      );
      expect((await linkTopic(db, id.u, free as number, other, 'web')).ok).toBe(
        true,
      );
      expect((await linkTopic(db, id.u, free as number, none, 'web')).ok).toBe(
        true,
      );
    });

    it('the 21st link is refused', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      for (let i = 0; i < 20; i++) {
        const r = await linkTopic(
          db,
          id.u,
          eid as number,
          await topic(id.subA),
          'web',
        );
        expect(r.ok).toBe(true);
      }
      const r = await linkTopic(
        db,
        id.u,
        eid as number,
        await topic(id.subA),
        'web',
      );
      expect(r).toEqual({
        ok: false,
        message: 'You can link at most 20 posts.',
      });
    });
  });

  describe('materials', () => {
    it('eventMaterials returns own and linked files, newest first, without deleted ones', async () => {
      const { id: eid } = await addEvent(db, id.u, input(), 'web');
      const own = await topic(id.subA, 'Kolokwium 1 — post');
      const linked = await topic(id.subA, 'Notatki');
      const deletedTopic = await topic(id.subA, 'Usunięty post');
      const unrelated = await topic(id.subA, 'Inny');
      await db
        .update(events)
        .set({ topicId: own })
        .where(eq(events.id, eid as number));
      await linkTopic(db, id.u, eid as number, linked, 'web');
      await linkTopic(db, id.u, eid as number, deletedTopic, 'web');
      await db
        .update(topics)
        .set({ deletedAt: new Date() })
        .where(eq(topics.id, deletedTopic));
      let n = 0;
      const mat = async (
        topicId: number,
        filename: string,
        createdAt: Date,
        deletedAt: Date | null = null,
      ) =>
        (
          await db
            .insert(materials)
            .values({
              topicId,
              uploaderId: id.u,
              discordMessageId: `m${++n}`,
              discordAttachmentId: `evt-att-${n}`,
              originalFilename: filename,
              mimeType: 'application/pdf',
              sizeBytes: 1,
              sha256: 'a'.repeat(64),
              storagePath: `x/${n}`,
              previewKind: 'pdf',
              createdAt,
              deletedAt,
            })
            .$returningId()
        )[0].id;
      const a = await mat(own, 'a.pdf', W(2026, 10, 1));
      const b = await mat(linked, 'b.pdf', W(2026, 10, 3));
      await mat(own, 'gone.pdf', W(2026, 10, 4), W(2026, 10, 5));
      await mat(deletedTopic, 'hidden.pdf', W(2026, 10, 4));
      await mat(unrelated, 'other.pdf', W(2026, 10, 4));
      expect(await eventMaterials(db, eid as number)).toEqual([
        {
          id: b,
          filename: 'b.pdf',
          topicTitle: 'Notatki',
          createdAt: W(2026, 10, 3),
          previewKind: 'pdf',
        },
        {
          id: a,
          filename: 'a.pdf',
          topicTitle: 'Kolokwium 1 — post',
          createdAt: W(2026, 10, 1),
          previewKind: 'pdf',
        },
      ]);
      expect(await eventMaterials(db, 999_999)).toEqual([]);
    });
  });

  describe('listing', () => {
    it('listEventsInRange returns plan rows with type "event"', async () => {
      const ins = async (o: Partial<typeof events.$inferInsert>) =>
        (
          await db
            .insert(events)
            .values({
              kind: 'egzamin',
              title: 'Egzamin',
              startsAt: W(2030, 1, 8, 9),
              ...o,
            })
            .$returningId()
        )[0].id;
      const timed = await ins({
        subjectId: id.subA,
        classId: id.cA,
        groupId: id.gA1,
        endsAt: W(2030, 1, 8, 11),
        place: 'Aula',
      });
      const allDay = await ins({
        kind: 'wyjazd',
        title: 'Wyjazd',
        startsAt: W(2030, 1, 7),
        allDay: true,
      });
      const open = await ins({
        startsAt: W(2030, 1, 9, 8),
        title: 'Bez końca',
      });
      // group without class: its class comes from the group
      const grpOnly = await ins({
        subjectId: id.subA,
        groupId: id.gA1,
        startsAt: W(2030, 1, 10, 8),
        endsAt: W(2030, 1, 10, 9),
      });
      await ins({ startsAt: W(2030, 1, 8, 10), deletedAt: new Date() });
      await ins({ startsAt: W(2030, 1, 14) });
      const rows = await listEventsInRange(pool, W(2030, 1, 7), W(2030, 1, 14));
      expect(rows.map((r) => r.id)).toEqual([allDay, timed, open, grpOnly]);
      expect(rows[1]).toEqual({
        id: timed,
        type: 'event',
        startsAt: W(2030, 1, 8, 9),
        endsAt: W(2030, 1, 8, 11),
        subjectId: id.subA,
        subjectName: 'Bazy danych',
        subjectCode: 'BD',
        classId: id.cA,
        classKind: 'laboratorium',
        className: 'Laboratorium',
        groupId: id.gA1,
        groupName: 'Gr. 1',
        lecturerId: null,
        lecturerName: null,
        room: 'Aula',
        label: 'Egzamin',
        status: 'confirmed',
        eventKind: 'egzamin',
        eventTitle: 'Egzamin',
        allDay: false,
      });
      expect(rows[0]).toMatchObject({
        allDay: true,
        startsAt: W(2030, 1, 7),
        endsAt: W(2030, 1, 8),
        subjectId: 0,
        subjectName: '',
        subjectCode: '',
        eventKind: 'wyjazd',
      });
      expect(rows[2]).toMatchObject({ endsAt: W(2030, 1, 9, 8) });
      expect(rows[3]).toMatchObject({ classId: id.cA, groupId: id.gA1 });

      const up = await listUpcomingEvents(pool, W(2030, 1, 8, 10), 2);
      expect(up.map((r) => r.id)).toEqual([timed, open]);
      const upAll = await listUpcomingEvents(pool, W(2030, 1, 7, 23), 10);
      expect(upAll.map((r) => r.id).slice(0, 2)).toEqual([allDay, timed]);
    });
  });
});
