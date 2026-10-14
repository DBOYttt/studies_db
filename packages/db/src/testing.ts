import mysql from 'mysql2/promise';
import { createDb, type Db } from './client.js';
import { runMigrations } from './migrate.js';
import { ensureReadonlyUser } from './readonly-user.js';
import { ensureReadWriteUser } from './readwrite-user.js';

const TEST_RO_USER = 'studies_ro_test';
const TEST_RO_PASSWORD = 'test-ro';
const TEST_RW_USER = 'studies_rw_test';
const TEST_RW_PASSWORD = 'test-rw';

function testUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  return url;
}

export function testRoUrl(): string {
  const u = new URL(testUrl());
  u.username = TEST_RO_USER;
  u.password = TEST_RO_PASSWORD;
  return u.toString();
}

export function testRwUrl(): string {
  const u = new URL(testUrl());
  u.username = TEST_RW_USER;
  u.password = TEST_RW_PASSWORD;
  return u.toString();
}

export async function resetTestDb(): Promise<Db> {
  const url = testUrl();
  const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to reset database '${dbName}': name must end with '_test'`,
    );
  }
  const server = new URL(url);
  server.pathname = '/';
  const admin = await mysql.createConnection({
    uri: server.toString(),
    charset: 'utf8mb4',
  });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(dbName)}`);
    await admin.query(
      `CREATE DATABASE ${mysql.escapeId(dbName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await admin.end();
  }
  await runMigrations(url);
  await ensureReadonlyUser(url, TEST_RO_PASSWORD, TEST_RO_USER);
  await ensureReadWriteUser(url, TEST_RW_PASSWORD, TEST_RW_USER);
  return createDb(url).db;
}

export async function closeTestDb(db: Db): Promise<void> {
  await (db as unknown as { $client: mysql.Pool }).$client.end();
}
