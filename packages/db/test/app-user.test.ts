import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureAppUser } from '../src/app-user.js';
import type { Db } from '../src/client.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

// Users are server-global: use a name only this test owns, and drop it after.
const USER = 'studies_app_t';
const PASSWORD = 'test-app';

let db: Db;
let admin: mysql.Connection;
let dbName: string;

function adminUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  return url;
}

function appUrl(password = PASSWORD): string {
  const u = new URL(adminUrl());
  u.username = USER;
  u.password = password;
  return u.toString();
}

beforeAll(async () => {
  db = await resetTestDb();
  dbName = decodeURIComponent(new URL(adminUrl()).pathname.slice(1));
  admin = await mysql.createConnection({
    uri: adminUrl(),
    charset: 'utf8mb4',
  });
  await admin.query(`DROP USER IF EXISTS ${mysql.escape(USER)}@'%'`);
  await ensureAppUser(admin, {
    database: dbName,
    password: PASSWORD,
    user: USER,
  });
});

afterAll(async () => {
  await admin.query(`DROP USER IF EXISTS ${mysql.escape(USER)}@'%'`);
  await admin.end();
  await closeTestDb(db);
});

async function asApp<T>(fn: (c: mysql.Connection) => Promise<T>): Promise<T> {
  const c = await mysql.createConnection({ uri: appUrl(), charset: 'utf8mb4' });
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describe('studies_app grants', () => {
  it('may insert, select, update and delete app tables', async () => {
    await asApp(async (c) => {
      await c.query(
        "INSERT INTO users (discord_user_id, display_name) VALUES ('app-t-1', 'App')",
      );
      const [rows] = await c.query(
        "SELECT display_name FROM users WHERE discord_user_id = 'app-t-1'",
      );
      expect(rows).toEqual([{ display_name: 'App' }]);
      await c.query(
        "UPDATE users SET display_name = 'App2' WHERE discord_user_id = 'app-t-1'",
      );
      await c.query("DELETE FROM users WHERE discord_user_id = 'app-t-1'");
      // Tables only the services use, never the consoles.
      await c.query('SELECT * FROM sessions');
      await c.query('DELETE FROM admin_audit WHERE id = -1');
      await c.query('SELECT * FROM bot_settings');
    });
  });

  it('may read public views', async () => {
    await asApp(async (c) => {
      await c.query('SELECT * FROM v_subjects');
    });
  });

  it('may take named locks and row locks', async () => {
    await asApp(async (c) => {
      const [rows] = await c.query("SELECT GET_LOCK('x', 1) AS got");
      expect(rows).toEqual([{ got: 1 }]);
      await c.query("SELECT RELEASE_LOCK('x')");
      await c.beginTransaction();
      await c.query('SELECT id FROM jobs FOR UPDATE SKIP LOCKED');
      await c.query('SELECT id FROM bot_requests LOCK IN SHARE MODE');
      await c.commit();
    });
  });

  const denied = [
    'CREATE TABLE x (a int)',
    'DROP TABLE tags',
    'ALTER TABLE subjects ADD c int',
    'TRUNCATE TABLE jobs',
    'SELECT * FROM mysql.user',
    "SELECT 1 INTO OUTFILE '/tmp/studies_app_t'",
    "GRANT SELECT ON mysql.* TO 'studies_app_t'@'%'",
    "CREATE USER 'studies_app_t2'@'%' IDENTIFIED BY 'x'",
  ];
  it.each(denied)('refuses: %s', async (sql) => {
    await asApp(async (c) => {
      await expect(c.query(sql)).rejects.toMatchObject({
        errno: expect.toSatisfy((n: number) =>
          [1044, 1045, 1142, 1227].includes(n),
        ),
      });
    });
  });

  it('sees only the app database', async () => {
    await asApp(async (c) => {
      const [rows] = await c.query('SHOW DATABASES');
      const names = (rows as { Database: string }[]).map((r) => r.Database);
      expect(names.filter((n) => n !== 'information_schema')).toEqual([dbName]);
    });
  });

  it('resets grants added by hand and follows a new password', async () => {
    await admin.query(`GRANT FILE ON *.* TO ${mysql.escape(USER)}@'%'`);
    await admin.query(
      `GRANT SELECT ON mysql.user TO ${mysql.escape(USER)}@'%'`,
    );
    await ensureAppUser(admin, {
      database: dbName,
      password: 'test-app-2',
      user: USER,
    });
    const c = await mysql.createConnection({
      uri: appUrl('test-app-2'),
      charset: 'utf8mb4',
    });
    try {
      await expect(c.query('SELECT * FROM mysql.user')).rejects.toMatchObject({
        errno: 1142,
      });
      await expect(
        c.query("SELECT 1 INTO OUTFILE '/tmp/studies_app_t'"),
      ).rejects.toMatchObject({ errno: 1227 });
    } finally {
      await c.end();
    }
    await ensureAppUser(admin, {
      database: dbName,
      password: PASSWORD,
      user: USER,
    });
  });
});
