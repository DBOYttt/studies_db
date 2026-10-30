import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isSemester, SEMESTERS } from '../src/admin-fields.js';
import type { Db } from '../src/client.js';
import { CONTENT_TABLES } from '../src/constants.js';
import { users } from '../src/schema.js';
import { closeTestDb, resetTestDb, testRwUrl } from '../src/testing.js';
import {
  clearFeed,
  listFeeds,
  maskFeedUrl,
  setFeed,
  validateFeedUrl,
} from '../src/unitime/feeds.js';

let db: Db;
let userId: number;
const HOSTS = ['plan.agh.edu.pl'];
const OK = 'https://plan.agh.edu.pl/UniTime/export?x=abc';

beforeAll(async () => {
  db = await resetTestDb();
  const [r] = await db
    .insert(users)
    .values({ discordUserId: 'feed-u', displayName: 'Feed U' });
  userId = r.insertId;
});
afterAll(async () => {
  await closeTestDb(db);
});

describe('semesters', () => {
  it('are 1..7', () => {
    expect([...SEMESTERS]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(isSemester(7)).toBe(true);
    expect(isSemester(8)).toBe(false);
    expect(isSemester('3')).toBe(false);
    expect(isSemester(0)).toBe(false);
  });
});

describe('validateFeedUrl', () => {
  it('accepts an allowed https url', () => {
    expect(validateFeedUrl(OK, HOSTS)).toMatchObject({
      ok: true,
      host: 'plan.agh.edu.pl',
    });
  });
  it('refuses bad urls without echoing them', () => {
    const bad = [
      'http://plan.agh.edu.pl/x',
      'https://user:p@plan.agh.edu.pl/x',
      'https://evil.example/x',
      `https://plan.agh.edu.pl/${'a'.repeat(500)}`,
    ];
    for (const raw of bad) {
      const r = validateFeedUrl(raw, HOSTS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).not.toContain(raw);
    }
  });
  it('masks', () => {
    expect(
      maskFeedUrl('https://plan.agh.edu.pl/UniTime/export?x=abcdk3x9'),
    ).toBe('plan.agh.edu.pl/…k3x9');
  });
});

describe('feeds storage', () => {
  it('sets, keeps, removes, lists, clears', async () => {
    expect(await setFeed(db, { semester: 3, userId })).toMatchObject({
      ok: false,
      field: 'class_url',
    });
    expect(
      await setFeed(db, { semester: 3, classUrl: OK, userId }),
    ).toMatchObject({ ok: true, classHost: 'plan.agh.edu.pl', examHost: null });
    await setFeed(db, { semester: 1, classUrl: OK, userId });
    const r = await setFeed(db, { semester: 3, examUrl: OK, userId });
    expect(r).toMatchObject({ ok: true, examHost: 'plan.agh.edu.pl' });
    let list = await listFeeds(db);
    expect(list.map((f) => f.semester)).toEqual([1, 3]);
    expect(list[1]).toMatchObject({
      classUrl: OK,
      examUrl: OK,
      updatedBy: userId,
    });
    await setFeed(db, { semester: 3, examUrl: null, userId });
    list = await listFeeds(db);
    expect(list[1]?.examUrl).toBeNull();
    expect(list[1]?.classUrl).toBe(OK);
    expect(await clearFeed(db, 3)).toBe(true);
    expect(await clearFeed(db, 3)).toBe(false);
  });
});

describe('studies_rw', () => {
  it('has no access to unitime_feeds', async () => {
    expect(CONTENT_TABLES as readonly string[]).not.toContain('unitime_feeds');
    const c = await mysql.createConnection({ uri: testRwUrl() });
    try {
      const [rows] = await c.query('SHOW GRANTS');
      expect(JSON.stringify(rows)).not.toContain('unitime_feeds');
      await expect(
        c.query('SELECT * FROM unitime_feeds'),
      ).rejects.toMatchObject({ errno: 1142 });
    } finally {
      await c.end();
    }
  });
});
