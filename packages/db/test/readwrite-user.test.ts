import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { ensureReadWriteUser } from '../src/readwrite-user.js';
import { closeTestDb, resetTestDb, testRwUrl } from '../src/testing.js';

let db: Db;

beforeAll(async () => {
  db = await resetTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});

async function asRw<T>(fn: (c: mysql.Connection) => Promise<T>): Promise<T> {
  const c = await mysql.createConnection({
    uri: testRwUrl(),
    charset: 'utf8mb4',
  });
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describe('studies_rw grants', () => {
  it('may write content tables and read public views', async () => {
    await asRw(async (c) => {
      await c.query('UPDATE subjects SET ects = ects');
      await c.query('SELECT * FROM v_subjects');
      await c.query('SELECT * FROM jobs');
    });
  });

  const denied = [
    'SELECT * FROM users',
    'SELECT * FROM sessions',
    'DELETE FROM admin_audit',
    'SELECT * FROM bot_settings',
    'CREATE TABLE x (a int)',
    'DROP TABLE tags',
    'ALTER TABLE subjects ADD c int',
    "SELECT 1 INTO OUTFILE '/tmp/x'",
  ];
  it.each(denied)('refuses: %s', async (sql) => {
    await asRw(async (c) => {
      await expect(c.query(sql)).rejects.toMatchObject({
        errno: expect.toSatisfy((n: number) =>
          [1142, 1044, 1045, 1227].includes(n),
        ),
      });
    });
  });

  it('is idempotent and resets manual extra grants', async () => {
    const url = process.env.TEST_DATABASE_URL as string;
    const admin = await mysql.createConnection({ uri: url });
    try {
      await admin.query(
        "GRANT SELECT ON `studies_test`.`users` TO 'studies_rw_test'@'%'",
      );
    } finally {
      await admin.end();
    }
    await asRw(async (c) => {
      await c.query('SELECT * FROM users');
    });
    await ensureReadWriteUser(url, 'test-rw', 'studies_rw_test');
    await ensureReadWriteUser(url, 'test-rw', 'studies_rw_test');
    await asRw(async (c) => {
      await expect(c.query('SELECT * FROM users')).rejects.toMatchObject({
        errno: 1142,
      });
      await c.query('UPDATE subjects SET ects = ects');
    });
  });
});
