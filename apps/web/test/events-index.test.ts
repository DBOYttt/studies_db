import { type Db, events, subjects } from '@studies/db';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RO_POOL_OPTIONS } from '../lib/db';
import {
  EVENTS_PER_PAGE,
  eventsIndexHref,
  hasNextPage,
  MAX_EVENTS_PAGE,
  parseEventsPage,
  upcomingEventsPage,
} from '../lib/events-index';

/** Wall Date: UTC fields equal the Warsaw wall clock. */
const W = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi));

describe('parseEventsPage', () => {
  it('reads ?page as a page number from 1, capped', () => {
    expect(parseEventsPage({})).toBe(1);
    expect(parseEventsPage({ page: '3' })).toBe(3);
    for (const bad of ['0', '-2', 'x', '1.5', '', ['2', '3']]) {
      expect(parseEventsPage({ page: bad })).toBe(1);
    }
    expect(parseEventsPage({ page: '999999' })).toBe(MAX_EVENTS_PAGE);
  });
});

describe('hasNextPage', () => {
  it('needs a 26th row and stops at the page cap', () => {
    expect(hasNextPage(EVENTS_PER_PAGE + 1, 1)).toBe(true);
    expect(hasNextPage(EVENTS_PER_PAGE, 1)).toBe(false);
    expect(hasNextPage(EVENTS_PER_PAGE + 1, MAX_EVENTS_PAGE - 1)).toBe(true);
    expect(hasNextPage(EVENTS_PER_PAGE + 1, MAX_EVENTS_PAGE)).toBe(false);
  });
});

describe('eventsIndexHref', () => {
  it('stays in the mode and leaves page 1 bare', () => {
    expect(eventsIndexHref(true, 1)).toBe('/s/wydarzenia');
    expect(eventsIndexHref(false, 1)).toBe('/wydarzenia');
    expect(eventsIndexHref(true, 2)).toBe('/s/wydarzenia?page=2');
  });
});

describe('upcomingEventsPage', () => {
  let db: Db;
  let ro: mysql.Pool;
  const ids: number[] = [];
  const now = W(2031, 5, 10, 12);

  beforeAll(async () => {
    db = await resetTestDb();
    ro = mysql.createPool({
      ...RO_POOL_OPTIONS,
      uri: testRoUrl(),
      connectionLimit: 2,
    });
    // Already over: never listed.
    await db
      .insert(events)
      .values({ kind: 'inne', title: 'Stare', startsAt: W(2031, 5, 9, 9) });
    for (let i = 0; i < EVENTS_PER_PAGE + 2; i++) {
      const [r] = await db
        .insert(events)
        .values({
          kind: 'kolokwium',
          title: `Kolokwium ${i}`,
          startsAt: W(2031, 5, 11 + i, 10),
        })
        .$returningId();
      ids.push(r.id);
    }
  });

  afterAll(async () => {
    await ro?.end();
    await closeTestDb(db);
  });

  it('pages the upcoming events 25 at a time, from now', async () => {
    const p1 = await upcomingEventsPage(ro, now, 1);
    expect(p1.events.map((e) => e.id)).toEqual(ids.slice(0, EVENTS_PER_PAGE));
    expect(p1.hasNext).toBe(true);
    const p2 = await upcomingEventsPage(ro, now, 2);
    expect(p2.events.map((e) => e.id)).toEqual(ids.slice(EVENTS_PER_PAGE));
    expect(p2.hasNext).toBe(false);
    const p3 = await upcomingEventsPage(ro, now, 3);
    expect(p3.events).toEqual([]);
    expect(p3.hasNext).toBe(false);
  });

  it('keeps subject-less events and only subjects of the semester', async () => {
    const mk = async (code: string, semester: number) =>
      (
        await db
          .insert(subjects)
          .values({ name: code, code, semester, ects: 1 })
          .$returningId()
      )[0].id;
    const s3 = await mk('IX3', 3);
    const s5 = await mk('IX5', 5);
    const day = W(2032, 1, 5, 10);
    const ev = async (title: string, subjectId: number | null) =>
      (
        await db
          .insert(events)
          .values({ kind: 'inne', title, startsAt: day, subjectId })
          .$returningId()
      )[0].id;
    const e3 = await ev('S3', s3);
    const e5 = await ev('S5', s5);
    const eN = await ev('None', null);
    const far = W(2031, 12, 31, 12);
    const all = (await upcomingEventsPage(ro, far, 1)).events.map((e) => e.id);
    expect(all).toEqual(expect.arrayContaining([e3, e5, eN]));
    const f = (await upcomingEventsPage(ro, far, 1, 3)).events.map((e) => e.id);
    expect(f).toContain(e3);
    expect(f).toContain(eN);
    expect(f).not.toContain(e5);
  });
});
