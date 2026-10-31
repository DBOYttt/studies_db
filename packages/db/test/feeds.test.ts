import { sql } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isSemester, SEMESTERS } from '../src/admin-fields.js';
import type { Db } from '../src/client.js';
import { CONTENT_TABLES } from '../src/constants.js';
import { unitimeFeeds, users } from '../src/schema.js';
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
      'https://plan.agh.edu.pl:3306/x',
      'https://plan.agh.edu.pl:443/x',
      '',
      '   ',
      'http://plan.agh.edu.pl/x',
      'https://user:p@plan.agh.edu.pl/x',
      'https://evil.example/x',
      `https://plan.agh.edu.pl/${'a'.repeat(500)}`,
    ];
    for (const raw of bad) {
      const r = validateFeedUrl(raw, HOSTS);
      expect(r.ok).toBe(false);
      if (!r.ok && raw.trim()) expect(r.error).not.toContain(raw);
    }
  });
  it('masks an unparsable link with a fixed string', () => {
    expect(maskFeedUrl('not a url')).toBe('(invalid link)');
  });
  it('masks', () => {
    expect(
      maskFeedUrl('https://plan.agh.edu.pl/UniTime/export?x=abcdk3x9'),
    ).toMatch(/^plan\.agh\.edu\.pl\/…#[0-9a-f]{6}$/);
    const a = maskFeedUrl('https://plan.agh.edu.pl/UniTime/export?x=abcdk3x9');
    expect(a).not.toContain('k3x9');
    expect(a).not.toContain('UniTime');
    expect(
      maskFeedUrl('https://plan.agh.edu.pl/UniTime/export?x=abcdk3x8'),
    ).not.toBe(a);
    expect(a).toBe(
      maskFeedUrl('https://plan.agh.edu.pl/UniTime/export?x=abcdk3x9'),
    );
  });
});

describe('feeds storage', () => {
  it('sets, keeps, removes, lists, clears', async () => {
    expect(await setFeed(db, { semester: 3, userId }, HOSTS)).toMatchObject({
      ok: false,
      field: 'class_url',
    });
    expect(
      await setFeed(db, { semester: 3, classUrl: OK, userId }, HOSTS),
    ).toMatchObject({ ok: true, classHost: 'plan.agh.edu.pl', examHost: null });
    await setFeed(db, { semester: 1, classUrl: OK, userId }, HOSTS);
    const r = await setFeed(db, { semester: 3, examUrl: OK, userId }, HOSTS);
    expect(r).toMatchObject({ ok: true, examHost: 'plan.agh.edu.pl' });
    let list = await listFeeds(db);
    expect(list.map((f) => f.semester)).toEqual([1, 3]);
    expect(list[1]).toMatchObject({
      classUrl: OK,
      examUrl: OK,
      updatedBy: userId,
    });
    await setFeed(db, { semester: 3, examUrl: null, userId }, HOSTS);
    list = await listFeeds(db);
    expect(list[1]?.examUrl).toBeNull();
    expect(list[1]?.classUrl).toBe(OK);
    expect(await clearFeed(db, 3)).toBe(true);
    expect(await clearFeed(db, 3)).toBe(false);
  });
});

describe('feed validation in setFeed and constraints', () => {
  it('names the field and never echoes the input', async () => {
    const evil = 'https://evil.example/secret-token';
    const a = await setFeed(db, { semester: 5, classUrl: evil, userId }, HOSTS);
    expect(a).toMatchObject({ ok: false, field: 'class_url' });
    expect(JSON.stringify(a)).not.toContain('secret-token');
    const bad = 'http://plan.agh.edu.pl/secret-token';
    const b = await setFeed(
      db,
      { semester: 5, classUrl: OK, examUrl: bad, userId },
      HOSTS,
    );
    expect(b).toMatchObject({ ok: false, field: 'exam_url' });
    expect(JSON.stringify(b)).not.toContain('secret-token');
    expect(await listFeeds(db)).not.toContainEqual(
      expect.objectContaining({ semester: 5 }),
    );
  });

  it('refuses an empty and a too-long url', async () => {
    expect(
      await setFeed(db, { semester: 5, classUrl: '', userId }, HOSTS),
    ).toMatchObject({ ok: false, field: 'class_url' });
    const long = `https://plan.agh.edu.pl/${'a'.repeat(500)}`;
    expect(
      await setFeed(db, { semester: 5, classUrl: long, userId }, HOSTS),
    ).toMatchObject({ ok: false, field: 'class_url' });
  });

  it('the CHECK refuses semester 0 and 8', async () => {
    for (const semester of [0, 8]) {
      await expect(
        db.insert(unitimeFeeds).values({ semester, classUrl: OK }),
      ).rejects.toThrow();
    }
  });

  it('deleting the updating user nulls updated_by', async () => {
    const [r] = await db
      .insert(users)
      .values({ discordUserId: 'feed-gone', displayName: 'Gone' });
    await setFeed(db, { semester: 6, classUrl: OK, userId: r.insertId }, HOSTS);
    await db.execute(sql`DELETE FROM users WHERE id = ${r.insertId}`);
    const row = (await listFeeds(db)).find((f) => f.semester === 6);
    expect(row?.updatedBy).toBeNull();
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
