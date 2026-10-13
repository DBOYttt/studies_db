import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { PUBLIC_VIEWS } from '../src/schema.js';
import { getSetting, setSetting } from '../src/settings.js';
import { closeTestDb, resetTestDb, testRoUrl } from '../src/testing.js';

let db: Db;
beforeAll(async () => {
  db = await resetTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});

describe('bot settings', () => {
  it('returns null for a missing key', async () => {
    expect(await getSetting(db, 'admin_role_id')).toBeNull();
  });

  it('stores and overwrites a value', async () => {
    await setSetting(db, 'admin_role_id', 'r1');
    expect(await getSetting(db, 'admin_role_id')).toBe('r1');
    await setSetting(db, 'admin_role_id', 'r2');
    expect(await getSetting(db, 'admin_role_id')).toBe('r2');
    expect(await getSetting(db, 'other')).toBeNull();
  });

  it('is exported from the package index', async () => {
    const idx = await import('../src/index.js');
    expect(typeof idx.getSetting).toBe('function');
    expect(typeof idx.setSetting).toBe('function');
  });

  it('is not readable by the read-only user', async () => {
    expect(PUBLIC_VIEWS).not.toContain('bot_settings' as never);
    const ro = await mysql.createConnection(testRoUrl());
    try {
      await expect(ro.query('SELECT * FROM bot_settings')).rejects.toThrow();
    } finally {
      await ro.end();
    }
  });
});
