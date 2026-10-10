import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureReadonlyUser } from '../src/admin.js';
import type { Db } from '../src/client.js';
import { closeTestDb, resetTestDb, testRoUrl } from '../src/testing.js';

describe('package entry points', () => {
  it('main index does not import the migrator or CLI', () => {
    const src = readFileSync(
      new URL('../src/index.ts', import.meta.url),
      'utf8',
    );
    expect(src).not.toMatch(/migrate|readonly-user|cli\//);
  });
  it('importing the index has no side effects', async () => {
    const idx = await import('../src/index.js');
    expect('runMigrations' in idx).toBe(false);
    expect('ensureReadonlyUser' in idx).toBe(false);
  });
});

describe('resetTestDb guard', () => {
  it('refuses databases not ending in _test', async () => {
    const prev = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = 'mysql://root:x@127.0.0.1:3307/studies';
    try {
      await expect(resetTestDb()).rejects.toThrow(/_test/);
    } finally {
      process.env.TEST_DATABASE_URL = prev;
    }
  });
});

describe('ensureReadonlyUser', () => {
  let db: Db;
  beforeAll(async () => {
    db = await resetTestDb();
  });
  afterAll(async () => {
    await closeTestDb(db);
  });

  it('removes manually added grants on re-run', async () => {
    const url = process.env.TEST_DATABASE_URL as string;
    const admin = await mysql.createConnection(url);
    try {
      await admin.query(
        "GRANT SELECT ON `studies_test`.`users` TO 'studies_ro_test'@'%'",
      );
      const ro = await mysql.createConnection(testRoUrl());
      await ro.query('SELECT * FROM users LIMIT 1');
      await ro.end();

      await ensureReadonlyUser(url, 'test-ro', 'studies_ro_test');

      const ro2 = await mysql.createConnection(testRoUrl());
      try {
        await expect(ro2.query('SELECT * FROM users LIMIT 1')).rejects.toThrow(
          /denied/i,
        );
        await ro2.query('SELECT * FROM v_users LIMIT 1');
      } finally {
        await ro2.end();
      }
    } finally {
      await admin.end();
    }
  });
});
