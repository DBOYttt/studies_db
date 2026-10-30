import type mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

// Indexes from the 2026-10-25 performance audit (M1, M2, L1, L5).
let db: Db;
let pool: mysql.Pool;

beforeAll(async () => {
  db = await resetTestDb();
  pool = (db as unknown as { $client: mysql.Pool }).$client;
});

afterAll(async () => {
  await closeTestDb(db);
});

async function indexColumns(table: string, index: string): Promise<string[]> {
  const [rows] = (await pool.query(
    `SELECT column_name AS c FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
      ORDER BY seq_in_index`,
    [table, index],
  )) as unknown as [{ c: string }[]];
  return rows.map((r) => r.c);
}

describe('performance indexes', () => {
  it('bot_requests (kind, target, status, id)', async () => {
    expect(
      await indexColumns('bot_requests', 'idx_bot_requests_kind_target'),
    ).toEqual(['kind', 'target', 'status', 'id']);
  });

  it('admin_audit (target, action, id)', async () => {
    expect(await indexColumns('admin_audit', 'idx_admin_audit_target')).toEqual(
      ['target', 'action', 'id'],
    );
  });

  it('bot_requests (status, kind, id) for the queue claim', async () => {
    expect(
      await indexColumns('bot_requests', 'idx_bot_requests_status_kind_id'),
    ).toEqual(['status', 'kind', 'id']);
  });

  it('admin_audit (action, id) for the audit log filter', async () => {
    expect(await indexColumns('admin_audit', 'idx_admin_audit_action')).toEqual(
      ['action', 'id'],
    );
  });

  it('materials (deleted_at, created_at, id) for recent lists', async () => {
    expect(await indexColumns('materials', 'idx_materials_recent')).toEqual([
      'deleted_at',
      'created_at',
      'id',
    ]);
  });

  it('materials (status) for the finalize sweep', async () => {
    expect(await indexColumns('materials', 'idx_materials_status')).toEqual([
      'status',
    ]);
  });
});
