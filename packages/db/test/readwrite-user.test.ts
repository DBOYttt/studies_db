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

  it('may update events but not read bot_requests', async () => {
    await asRw(async (c) => {
      await c.query('UPDATE events SET title = title');
      await c.query('SELECT * FROM v_events');
      await c.query('SELECT * FROM event_topics');
      await expect(c.query('SELECT * FROM bot_requests')).rejects.toMatchObject(
        { errno: 1142 },
      );
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

  // The worker turns these columns into file paths; see resolveInStorage.
  describe('materials', () => {
    const deniedMaterials = [
      "UPDATE materials SET storage_path = '../../proc/self/environ'",
      "UPDATE materials SET preview_path = '../x.pdf'",
      "UPDATE materials SET sha256 = 'x'",
      'UPDATE materials SET size_bytes = 1',
      "UPDATE materials SET deleted_at = NULL, storage_path = 'x'",
      `INSERT INTO materials (topic_id, uploader_id, discord_message_id,
         discord_attachment_id, original_filename, mime_type, size_bytes,
         sha256, storage_path, preview_kind)
       VALUES (1, 1, 'm', 'a', 'f', 't', 1, 's', '../../etc/passwd', 'text')`,
      "REPLACE INTO materials (id, storage_path) VALUES (1, 'x')",
    ];
    it.each(deniedMaterials)('refuses: %s', async (sql) => {
      await asRw(async (c) => {
        await expect(c.query(sql)).rejects.toMatchObject({
          errno: expect.toSatisfy((n: number) => [1142, 1143].includes(n)),
        });
      });
    });

    it('may read, soft-delete, edit metadata and delete', async () => {
      await asRw(async (c) => {
        await c.query('SELECT storage_path, sha256 FROM materials');
        await c.query('UPDATE materials SET deleted_at = NOW() WHERE id = -1');
        await c.query(
          "UPDATE materials SET original_filename = 'x', status = 'ready', preview_kind = 'none' WHERE id = -1",
        );
        await c.query('DELETE FROM materials WHERE id = -1');
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

describe('materialsUpdatableColumns', () => {
  it('derives from the schema and leaves out the file columns', async () => {
    const { materialsUpdatableColumns } = await import(
      '../src/readwrite-user.js'
    );
    const cols = materialsUpdatableColumns();
    expect(cols).toContain('deleted_at');
    expect(cols).toContain('original_filename');
    for (const c of ['storage_path', 'preview_path', 'sha256', 'size_bytes']) {
      expect(cols).not.toContain(c);
    }
  });
});
