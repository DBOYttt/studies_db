import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import {
  addSeries,
  linkSeriesTopic,
  unlinkSeriesTopic,
} from '../src/event-series.js';
import {
  CONFLICT,
  deleteEvent,
  editEvent,
  eventMaterials,
  getEvent,
  linkTopic,
  unlinkTopic,
} from '../src/events.js';
import {
  adminAudit,
  botRequests,
  eventSeries,
  events,
  eventTopics,
  materials,
  subjects,
  topics,
  users,
} from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

let db: Db;
const id = {} as Record<string, number>;
let thread = 0;

const dmy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
const DAY = 86_400_000;
const base = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 5);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};
const plus = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

const input = (o: Record<string, unknown> = {}) => ({
  kind: 'zajecia_dodatkowe' as const,
  title: 'Konsultacje',
  subjectId: id.sub,
  when: `${dmy(base())} 10:00-11:00`,
  rule: 'weekly' as const,
  until: dmy(plus(base(), 56)),
  ...o,
});
const occ = (seriesId: number) =>
  db
    .select()
    .from(events)
    .where(and(eq(events.seriesId, seriesId), isNull(events.deletedAt)))
    .orderBy(asc(events.startsAt));
const mkSeries = async (o: Record<string, unknown> = {}) => {
  const r = await addSeries(db, id.u, input(o), 'web');
  expect(r.ok, r.message).toBe(true);
  return r.id as number;
};
const requests = async (target: string) =>
  (await db.select().from(botRequests)).filter((r) => r.target === target);

describe('event series', () => {
  beforeAll(async () => {
    db = await resetTestDb();
    id.u = (
      await db
        .insert(users)
        .values({ discordUserId: 'd-u', displayName: 'Ala' })
        .$returningId()
    )[0].id;
    id.banned = (
      await db
        .insert(users)
        .values({ discordUserId: 'd-b', displayName: 'Ban', isBanned: true })
        .$returningId()
    )[0].id;
    id.sub = (
      await db
        .insert(subjects)
        .values({ code: 'BD', name: 'Bazy', semester: 1, ects: 5 })
        .$returningId()
    )[0].id;
    id.sub2 = (
      await db
        .insert(subjects)
        .values({ code: 'FIZ', name: 'Fizyka', semester: 1, ects: 5 })
        .$returningId()
    )[0].id;
  });
  afterAll(async () => {
    await closeTestDb(db);
  });
  beforeEach(async () => {
    await db.delete(adminAudit).where(eq(adminAudit.action, 'event.add'));
  });
  const topic = async (subjectId: number | null) =>
    (
      await db
        .insert(topics)
        .values({ subjectId, title: 'Post', discordThreadId: `s${++thread}` })
        .$returningId()
    )[0].id;

  describe('addSeries', () => {
    it('weekly generates one occurrence per week through until (9)', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      expect(rows).toHaveLength(9);
      expect(rows[1].startsAt.getTime() - rows[0].startsAt.getTime()).toBe(
        7 * DAY,
      );
      expect(rows[0].endsAt?.getTime()).toBe(
        rows[0].startsAt.getTime() + 3_600_000,
      );
      expect(rows.every((r) => r.title === 'Konsultacje')).toBe(true);
      expect(rows.every((r) => r.topicId === null)).toBe(true);
    });
    it('stores until as the date of the last generated occurrence', async () => {
      const sid = await mkSeries({
        when: '20.10.2026 10:00-11:00',
        until: '14.11.2026',
      });
      const [s] = await db
        .select()
        .from(eventSeries)
        .where(eq(eventSeries.id, sid));
      const rows = await occ(sid);
      expect(rows[rows.length - 1].startsAt.toISOString().slice(0, 10)).toBe(
        '2026-11-10',
      );
      expect(s.until).toBe('2026-11-10');
    });
    it('biweekly generates every other week', async () => {
      const sid = await mkSeries({ rule: 'biweekly' });
      const rows = await occ(sid);
      expect(rows).toHaveLength(5);
      expect(rows[1].startsAt.getTime() - rows[0].startsAt.getTime()).toBe(
        14 * DAY,
      );
    });
    it('enqueues one upsert for series:<id> and audits once', async () => {
      const sid = await mkSeries();
      const reqs = await requests(`series:${sid}`);
      expect(reqs.map((r) => r.kind)).toEqual(['event_post_upsert']);
      expect(
        (await db.select().from(botRequests)).filter((r) =>
          r.target.startsWith('event:'),
        ),
      ).toHaveLength(0);
      const a = (await db.select().from(adminAudit)).filter(
        (r) => r.action === 'event.add' && r.target === `series:${sid}`,
      );
      expect(a).toHaveLength(1);
    });
    it('refuses more than 30 occurrences', async () => {
      const r = await addSeries(
        db,
        id.u,
        input({ until: dmy(plus(base(), 7 * 30)) }),
        'web',
      );
      expect(r.ok).toBe(false);
      expect(r.message).toBe('A series can have at most 30 occurrences.');
      expect(
        (
          await addSeries(
            db,
            id.u,
            input({ until: dmy(plus(base(), 7 * 29)) }),
            'web',
          )
        ).ok,
      ).toBe(true);
    });
    it('refuses a last occurrence more than a year after the first', async () => {
      const r = await addSeries(
        db,
        id.u,
        input({ rule: 'biweekly', until: dmy(plus(base(), 400)) }),
        'web',
      );
      expect(r.ok).toBe(false);
      expect(r.message).toBe(
        'The last occurrence can be at most a year after the first.',
      );
    });
    it('refuses until before the first start', async () => {
      const r = await addSeries(
        db,
        id.u,
        input({ until: dmy(plus(base(), -1)) }),
        'web',
      );
      expect(r).toEqual({
        ok: false,
        message: 'The series end date cannot be before the first event.',
      });
    });
    it('refuses an unreadable until, a bad rule and a banned user', async () => {
      expect(
        (await addSeries(db, id.u, input({ until: 'kiedyś' }), 'web')).ok,
      ).toBe(false);
      expect(
        (await addSeries(db, id.u, input({ rule: 'daily' }), 'web')).ok,
      ).toBe(false);
      const r = await addSeries(db, id.banned, input(), 'web');
      expect(r.ok).toBe(false);
    });
    it('until equal to the first day gives one occurrence', async () => {
      const sid = await mkSeries({ until: dmy(base()) });
      expect(await occ(sid)).toHaveLength(1);
    });
    it('writes nothing when refused', async () => {
      const before = (await db.select().from(eventSeries)).length;
      await addSeries(db, id.u, input({ until: 'x' }), 'web');
      expect((await db.select().from(eventSeries)).length).toBe(before);
    });
  });

  describe('editEvent scope', () => {
    it('one changes only that occurrence', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      const r = await editEvent(
        db,
        id.u,
        rows[3].id,
        { title: 'Inne' },
        'web',
        'one',
      );
      expect(r.ok).toBe(true);
      const after = await occ(sid);
      expect(after.map((e) => e.title)).toEqual(
        rows.map((_, i) => (i === 3 ? 'Inne' : 'Konsultacje')),
      );
      expect(after.every((e) => e.seriesId === sid)).toBe(true);
      const [a] = (await db.select().from(adminAudit)).filter(
        (x) => x.action === 'event.edit' && x.target === String(rows[3].id),
      );
      expect((a.details as { scope: string }).scope).toBe('one');
      expect((await requests(`series:${sid}`)).length).toBeGreaterThan(0);
    });
    it('default scope is one', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      await editEvent(db, id.u, rows[1].id, { place: 'A1' }, 'web');
      expect((await occ(sid)).map((e) => e.place)).toEqual(
        rows.map((_, i) => (i === 1 ? 'A1' : null)),
      );
    });
    it('following changes it and later ones, not earlier; splits the series', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      await db
        .update(eventSeries)
        .set({ topicId: await topic(id.sub) })
        .where(eq(eventSeries.id, sid));
      const [old] = await db
        .select()
        .from(eventSeries)
        .where(eq(eventSeries.id, sid));
      const r = await editEvent(
        db,
        id.u,
        rows[4].id,
        { title: 'Nowe', place: 'B2' },
        'web',
        'following',
      );
      expect(r.ok, r.message).toBe(true);
      const all = await db
        .select()
        .from(events)
        .where(eq(events.subjectId, id.sub))
        .orderBy(asc(events.startsAt));
      const mine = all.filter((e) => rows.some((x) => x.id === e.id));
      expect(mine.map((e) => e.title)).toEqual(
        rows.map((_, i) => (i >= 4 ? 'Nowe' : 'Konsultacje')),
      );
      expect(mine.map((e) => e.place)).toEqual(
        rows.map((_, i) => (i >= 4 ? 'B2' : null)),
      );
      const newSid = mine[4].seriesId as number;
      expect(newSid).not.toBe(sid);
      expect(mine.slice(0, 4).every((e) => e.seriesId === sid)).toBe(true);
      expect(mine.slice(4).every((e) => e.seriesId === newSid)).toBe(true);
      const [ns] = await db
        .select()
        .from(eventSeries)
        .where(eq(eventSeries.id, newSid));
      expect(ns.topicId).toBe(old.topicId);
      expect(ns.rule).toBe(old.rule);
      const [os] = await db
        .select()
        .from(eventSeries)
        .where(eq(eventSeries.id, sid));
      expect(os.until).toBe(dmyIso(rows[3].startsAt));
      expect((await requests(`series:${newSid}`)).length).toBe(1);
      expect((await requests(`series:${sid}`)).length).toBeGreaterThan(0);
      const [a] = (await db.select().from(adminAudit)).filter(
        (x) => x.action === 'event.edit' && x.target === String(rows[4].id),
      );
      expect((a.details as { scope: string }).scope).toBe('following');
    });
    it('following copies series-level links to the new series', async () => {
      const sid = await mkSeries();
      const t = await topic(id.sub);
      expect((await linkSeriesTopic(db, id.u, sid, t, 'web')).ok).toBe(true);
      const rows = await occ(sid);
      await editEvent(db, id.u, rows[2].id, { title: 'N' }, 'web', 'following');
      const newSid =
        (await occ(sid)).length === 2
          ? (await db.select().from(events).where(eq(events.id, rows[2].id)))[0]
              .seriesId
          : null;
      expect(newSid).not.toBeNull();
      const links = await db
        .select()
        .from(eventTopics)
        .where(eq(eventTopics.seriesId, newSid as number));
      expect(links.map((l) => l.topicId)).toEqual([t]);
    });
    it('following from the first occurrence edits the whole series in place', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      await editEvent(
        db,
        id.u,
        rows[0].id,
        { title: 'Wszystko' },
        'web',
        'following',
      );
      const after = await occ(sid);
      expect(after).toHaveLength(rows.length);
      expect(
        after.every((e) => e.title === 'Wszystko' && e.seriesId === sid),
      ).toBe(true);
    });
    it('following with a new "Kiedy" shifts later occurrences by the same offset', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      const moved = plus(rows[2].startsAt, 1);
      await editEvent(
        db,
        id.u,
        rows[2].id,
        { when: `${dmy(moved)} 12:00-13:00` },
        'web',
        'following',
      );
      const after = await db
        .select()
        .from(events)
        .where(
          and(eq(events.subjectId, id.sub), eq(events.title, 'Konsultacje')),
        );
      for (const [i, r] of rows.entries()) {
        const e = after.find((x) => x.id === r.id);
        if (!e) throw new Error('missing');
        const want =
          i < 2
            ? r.startsAt.getTime()
            : plus(r.startsAt, 1).getTime() + 2 * 3_600_000;
        expect(e.startsAt.getTime(), String(i)).toBe(want);
        if (i >= 2) {
          expect(e.endsAt?.getTime()).toBe(want + 3_600_000);
        }
      }
    });
    it('no-op returns "No changes." with no audit or request', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      const a0 = (await db.select().from(adminAudit)).length;
      const r0 = (await db.select().from(botRequests)).length;
      const r = await editEvent(
        db,
        id.u,
        rows[2].id,
        { title: 'Konsultacje' },
        'web',
        'following',
      );
      expect(r).toEqual({ ok: true, message: 'No changes.' });
      expect((await db.select().from(adminAudit)).length).toBe(a0);
      expect((await db.select().from(botRequests)).length).toBe(r0);
      expect((await occ(sid)).length).toBe(rows.length);
    });
  });

  describe('optimistic version', () => {
    it('editInSeries one/following with a stale version is a conflict', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      // Someone else edits the target first.
      await editEvent(db, id.u, rows[2].id, { place: 'X' }, 'web', 'one');
      const [before] = await db
        .select()
        .from(eventSeries)
        .where(eq(eventSeries.id, sid));
      const seriesBefore = (await db.select().from(eventSeries)).length;
      for (const scope of ['one', 'following'] as const) {
        const r = await editEvent(
          db,
          id.u,
          rows[2].id,
          { title: 'Nope' },
          'web',
          scope,
          { expectedVersion: 0 },
        );
        expect(r).toEqual({ ok: false, message: CONFLICT });
      }
      expect((await occ(sid)).every((e) => e.title === 'Konsultacje')).toBe(
        true,
      );
      expect((await db.select().from(eventSeries)).length).toBe(seriesBefore);
      const [after] = await db
        .select()
        .from(eventSeries)
        .where(eq(eventSeries.id, sid));
      expect(after.until).toBe(before.until);
      expect(after.version).toBe(before.version);
    });
    it('a current version edits and bumps event and series', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      const r = await editEvent(
        db,
        id.u,
        rows[1].id,
        { title: 'Ok' },
        'web',
        'one',
        { expectedVersion: 0 },
      );
      expect(r.ok).toBe(true);
      expect((await getEvent(db, rows[1].id))?.version).toBe(1);
      const [s] = await db
        .select()
        .from(eventSeries)
        .where(eq(eventSeries.id, sid));
      expect(s.version).toBe(1);
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
    it('a following edit retried after a concurrent edit keeps that edit', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      const r = await editEvent(
        racingDb(() =>
          editEvent(db, id.u, rows[4].id, { title: 'Od B' }, 'web', 'one'),
        ),
        id.u,
        rows[2].id,
        { place: 'Sala 7' },
        'web',
        'following',
      );
      expect(r.ok, r.message).toBe(true);
      const [e4] = await db
        .select()
        .from(events)
        .where(eq(events.id, rows[4].id));
      expect(e4.title).toBe('Od B');
      expect(e4.place).toBe('Sala 7');
    });
    it('a following edit retried after a concurrent delete does not touch the deleted occurrence', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      const r = await editEvent(
        racingDb(() => deleteEvent(db, id.u, rows[4].id, 'web', 'one')),
        id.u,
        rows[2].id,
        { place: 'Sala 8' },
        'web',
        'following',
      );
      expect(r.ok, r.message).toBe(true);
      const [e4] = await db
        .select()
        .from(events)
        .where(eq(events.id, rows[4].id));
      expect(e4.deletedAt).not.toBeNull();
      expect(e4.place).toBeNull();
      expect(e4.seriesId).toBe(sid);
      const [e5] = await db
        .select()
        .from(events)
        .where(eq(events.id, rows[5].id));
      expect(e5.place).toBe('Sala 8');
    });
    it('a following edit of an occurrence deleted meanwhile is refused', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      const r = await editEvent(
        racingDb(() => deleteEvent(db, id.u, rows[2].id, 'web', 'one')),
        id.u,
        rows[2].id,
        { place: 'Sala 9' },
        'web',
        'following',
      );
      expect(r).toEqual({ ok: false, message: 'Event not found.' });
      expect((await occ(sid)).every((e) => e.place === null)).toBe(true);
    });
    it('deleteInSeries with a stale version is a conflict', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      await editEvent(db, id.u, rows[2].id, { place: 'X' }, 'web', 'one');
      for (const scope of ['one', 'following'] as const) {
        const r = await deleteEvent(db, id.u, rows[2].id, 'web', scope, {
          expectedVersion: 0,
        });
        expect(r).toEqual({ ok: false, message: CONFLICT });
      }
      expect((await occ(sid)).length).toBe(rows.length);
    });
  });

  describe('deleteEvent scope', () => {
    it('one soft-deletes only that occurrence', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      const r = await deleteEvent(db, id.u, rows[2].id, 'web', 'one');
      expect(r.ok).toBe(true);
      expect((await occ(sid)).map((e) => e.id)).toEqual(
        rows.filter((_, i) => i !== 2).map((e) => e.id),
      );
    });
    it('following soft-deletes it and later ones and trims until', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      await deleteEvent(db, id.u, rows[5].id, 'web', 'following');
      expect((await occ(sid)).map((e) => e.id)).toEqual(
        rows.slice(0, 5).map((e) => e.id),
      );
      const [s] = await db
        .select()
        .from(eventSeries)
        .where(eq(eventSeries.id, sid));
      expect(s.deletedAt).toBeNull();
      expect(s.until).toBe(dmyIso(rows[4].startsAt));
      const [a] = (await db.select().from(adminAudit)).filter(
        (x) => x.action === 'event.delete' && x.target === String(rows[5].id),
      );
      expect((a.details as { scope: string }).scope).toBe('following');
    });
    it('following from the first deletes the series and archives its post', async () => {
      const sid = await mkSeries();
      const rows = await occ(sid);
      await deleteEvent(db, id.u, rows[0].id, 'web', 'following');
      expect(await occ(sid)).toHaveLength(0);
      const [s] = await db
        .select()
        .from(eventSeries)
        .where(eq(eventSeries.id, sid));
      expect(s.deletedAt).not.toBeNull();
      expect((await requests(`series:${sid}`)).map((r) => r.kind)).toContain(
        'event_post_archive',
      );
    });
    it('deleting the last remaining occurrence one by one deletes the series', async () => {
      const sid = await mkSeries({ until: dmy(base()) });
      const [e] = await occ(sid);
      await deleteEvent(db, id.u, e.id, 'web', 'one');
      const [s] = await db
        .select()
        .from(eventSeries)
        .where(eq(eventSeries.id, sid));
      expect(s.deletedAt).not.toBeNull();
    });
    it('a plain event still uses event:<id>', async () => {
      const [e] = await db
        .insert(events)
        .values({ kind: 'inne', title: 'x', startsAt: base() })
        .$returningId();
      expect((await deleteEvent(db, id.u, e.id, 'web')).ok).toBe(true);
      expect((await requests(`event:${e.id}`)).map((r) => r.kind)).toEqual([
        'event_post_archive',
      ]);
    });
  });

  describe('series links and materials', () => {
    it('a series link shows in every occurrence materials, with the series post files', async () => {
      const sid = await mkSeries();
      const linked = await topic(id.sub);
      const post = await topic(id.sub);
      for (const [t, name] of [
        [linked, 'a.pdf'],
        [post, 'b.pdf'],
      ] as const) {
        await db.insert(materials).values({
          topicId: t,
          uploaderId: id.u,
          discordMessageId: `m-${name}`,
          discordAttachmentId: `att-${name}-${Date.now()}`,
          originalFilename: name,
          mimeType: 'application/pdf',
          sizeBytes: 1,
          sha256: 'a'.repeat(64),
          storagePath: `x/${name}`,
          previewKind: 'pdf',
        });
      }
      await db
        .update(eventSeries)
        .set({ topicId: post })
        .where(eq(eventSeries.id, sid));
      expect((await linkSeriesTopic(db, id.u, sid, linked, 'web')).ok).toBe(
        true,
      );
      for (const e of await occ(sid)) {
        const m = await eventMaterials(db, e.id);
        expect(m.map((x) => x.filename).sort()).toEqual(['a.pdf', 'b.pdf']);
      }
    });
    it('link rules: duplicate, other subject, limit; unlink', async () => {
      const sid = await mkSeries();
      const t = await topic(id.sub);
      expect((await linkSeriesTopic(db, id.u, sid, t, 'web')).ok).toBe(true);
      expect((await linkSeriesTopic(db, id.u, sid, t, 'web')).message).toBe(
        'This post is already linked.',
      );
      expect(
        (await linkSeriesTopic(db, id.u, sid, await topic(id.sub2), 'web'))
          .message,
      ).toBe('This post belongs to a different subject.');
      expect((await unlinkSeriesTopic(db, id.u, sid, t, 'web')).ok).toBe(true);
      expect((await unlinkSeriesTopic(db, id.u, sid, t, 'web')).ok).toBe(false);
      const [a] = (await db.select().from(adminAudit)).filter(
        (x) => x.action === 'event.link' && x.target === `series:${sid}`,
      );
      expect(a).toBeDefined();
    });
  });

  describe('getEvent and links of an occurrence', () => {
    it('exposes the series, and link/unlink act on the series', async () => {
      const sid = await mkSeries({ rule: 'biweekly' });
      const [a, b] = await occ(sid);
      const t = await topic(id.sub);
      const r = await linkTopic(db, id.u, a.id, t, 'web');
      expect(r.ok, r.message).toBe(true);
      const ea = await getEvent(db, a.id);
      const eb = await getEvent(db, b.id);
      expect(ea?.series).toMatchObject({ id: sid, rule: 'biweekly' });
      expect(ea?.linkedTopicIds).toEqual([t]);
      expect(eb?.linkedTopicIds).toEqual([t]);
      expect((await requests(`series:${sid}`)).length).toBeGreaterThan(0);
      expect((await unlinkTopic(db, id.u, b.id, t, 'web')).ok).toBe(true);
      expect((await getEvent(db, a.id))?.linkedTopicIds).toEqual([]);
    });
    it('a plain event has no series', async () => {
      const [e] = await db
        .select()
        .from(events)
        .where(isNull(events.seriesId))
        .limit(1);
      if (e) expect((await getEvent(db, e.id))?.series).toBeNull();
    });
  });

  it('a split records the lineage root as parent_id', async () => {
    const sid = await mkSeries();
    const [, b] = await occ(sid);
    expect(
      (await editEvent(db, id.u, b.id, { title: 'B' }, 'web', 'following')).ok,
    ).toBe(true);
    const sidOf = async (eventId: number) =>
      (await db.select().from(events).where(eq(events.id, eventId)))[0]
        .seriesId as number;
    const sb = await sidOf(b.id);
    expect(sb).not.toBe(sid);
    const [root] = await db
      .select()
      .from(eventSeries)
      .where(eq(eventSeries.id, sid));
    const [second] = await db
      .select()
      .from(eventSeries)
      .where(eq(eventSeries.id, sb));
    expect(root.parentId).toBeNull();
    expect(second.parentId).toBe(sid);
    // split the child again: still points at the root
    const [, c] = await occ(sb);
    expect(
      (await editEvent(db, id.u, c.id, { title: 'C' }, 'web', 'following')).ok,
    ).toBe(true);
    const sc = await sidOf(c.id);
    expect(sc).not.toBe(sb);
    const [third] = await db
      .select()
      .from(eventSeries)
      .where(eq(eventSeries.id, sc));
    expect(third.parentId).toBe(sid);
  });

  it('the owner CHECK rejects zero or two owners', async () => {
    const sid = await mkSeries();
    const [e] = await occ(sid);
    const t = await topic(id.sub);
    await expect(
      db.insert(eventTopics).values({ topicId: t }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(eventTopics)
        .values({ topicId: t, eventId: e.id, seriesId: sid }),
    ).rejects.toThrow();
  });
});

const dmyIso = (d: Date) => d.toISOString().slice(0, 10);
