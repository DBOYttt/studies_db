import { createDb, type Db } from '@studies/db';
import mysql from 'mysql2/promise';

interface Cache {
  db?: { db: Db; pool: mysql.Pool };
  ro?: mysql.Pool;
  views?: mysql.Pool;
  rw?: mysql.Pool;
}

// Cached on globalThis so dev hot-reloads don't leak pools.
const g = globalThis as typeof globalThis & { __studiesWeb?: Cache };
g.__studiesWeb ??= {};
const cache: Cache = g.__studiesWeb;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function getDb(): Db {
  cache.db ??= createDb(env('DATABASE_URL'));
  return cache.db.db;
}

/** Options for the read-only pool (SQL console / table browser). */
export const RO_POOL_OPTIONS = {
  charset: 'utf8mb4',
  timezone: 'Z',
  // MAX_USER_CONNECTIONS is 10: views pool 4 + RO pool 4 + 2 spare for the
  // watchdog KILL connections (they open fresh connections as studies_ro).
  connectionLimit: 4,
  // Security: one statement per query, always (the server also enforces it).
  multipleStatements: false,
  // BIGINT/DECIMAL as exact strings rather than lossy JS numbers.
  supportBigNumbers: true,
  bigNumberStrings: true,
} as const satisfies mysql.PoolOptions;

/** The views pool: same credentials, fixed application queries only. */
export const VIEWS_POOL_OPTIONS = {
  ...RO_POOL_OPTIONS,
  connectionLimit: 4,
} as const satisfies mysql.PoolOptions;

/**
 * studies_ro pool for fixed application queries on the public views (plan,
 * home, groups, counts). Kept apart so slow user SQL cannot starve pages.
 */
export function getViewsPool(): mysql.Pool {
  cache.views ??= mysql.createPool({
    ...VIEWS_POOL_OPTIONS,
    uri: env('DATABASE_RO_URL'),
  });
  return cache.views;
}

/** Waiting getConnection() calls the RO pool queues before failing fast. */
export const RO_QUEUE_LIMIT = 8;

/**
 * studies_ro pool for user-supplied SQL only (console, table browser,
 * reports). A full queue fails fast; see connectionErrorMessage.
 */
export function getRoPool(): mysql.Pool {
  cache.ro ??= mysql.createPool({
    ...RO_POOL_OPTIONS,
    queueLimit: RO_QUEUE_LIMIT,
    uri: env('DATABASE_RO_URL'),
  });
  return cache.ro;
}

/**
 * Pool of `studies_rw` for the admin SQL console, or null when
 * DATABASE_RW_URL is not set (the console is then disabled).
 * MAX_USER_CONNECTIONS is 5: leave room for watchdog KILL connections.
 */
export function getRwPool(): mysql.Pool | null {
  const uri = process.env.DATABASE_RW_URL;
  if (!uri) return null;
  cache.rw ??= mysql.createPool({
    ...RO_POOL_OPTIONS,
    connectionLimit: 3,
    uri,
  });
  return cache.rw;
}
