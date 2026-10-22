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

  it('may write class marks and skips and read their views', async () => {
    await asRw(async (c) => {
      await c.query("UPDATE class_marks SET note = 'x' WHERE id = -1");
      await c.query('DELETE FROM class_mark_skips WHERE id = -1');
      await c.query('SELECT * FROM v_class_marks');
      await c.query('SELECT * FROM v_class_mark_skips');
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

  // The bot posts into and edits the thread these columns point at.
  describe('events and event_series', () => {
    const deniedEvents = [
      'UPDATE events SET topic_id = 1',
      'UPDATE events SET series_id = 1',
      'UPDATE events SET created_by = 1',
      'UPDATE events SET updated_by = 1',
      'UPDATE event_series SET topic_id = 1',
      'UPDATE event_series SET parent_id = 1',
      'UPDATE event_series SET created_by = 1',
      `INSERT INTO events (kind, title, starts_at, topic_id)
       VALUES ('inne', 'x', '2026-01-01 10:00:00', 1)`,
      `INSERT INTO event_series (rule, until, topic_id)
       VALUES ('weekly', '2026-02-01', 1)`,
      `INSERT INTO event_series (rule, until, parent_id)
       VALUES ('weekly', '2026-02-01', 1)`,
      "REPLACE INTO events (id, kind, title, starts_at, topic_id) VALUES (1, 'inne', 'x', '2026-01-01', 1)",
    ];
    it.each(deniedEvents)('refuses: %s', async (sql) => {
      await asRw(async (c) => {
        await expect(c.query(sql)).rejects.toMatchObject({
          errno: expect.toSatisfy((n: number) => [1142, 1143].includes(n)),
        });
      });
    });

    it('may read, edit other columns, insert and delete', async () => {
      await asRw(async (c) => {
        await c.query('SELECT topic_id, series_id, created_by FROM events');
        await c.query('SELECT topic_id, parent_id FROM event_series');
        await c.query(
          "UPDATE events SET title = 'x', place = NULL, deleted_at = NOW() WHERE id = -1",
        );
        await c.query(
          "UPDATE event_series SET until = '2026-02-01' WHERE id = -1",
        );
        await c.query(
          "INSERT INTO event_series (rule, until) VALUES ('weekly', '2026-02-01')",
        );
        await c.query(
          "INSERT INTO events (kind, title, starts_at) VALUES ('inne', 'x', '2026-01-01 10:00:00')",
        );
        await c.query("DELETE FROM events WHERE title = 'x'");
        await c.query("DELETE FROM event_series WHERE until = '2026-02-01'");
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
