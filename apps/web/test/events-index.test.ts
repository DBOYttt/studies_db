import { type Db, events } from '@studies/db';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RO_POOL_OPTIONS } from '../lib/db';
import {
  EVENTS_PER_PAGE,
  eventsIndexHref,
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
});
