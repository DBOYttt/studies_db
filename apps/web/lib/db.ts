import { createDb, type Db } from '@studies/db';
import mysql from 'mysql2/promise';

interface Cache {
  db?: { db: Db; pool: mysql.Pool };
  ro?: mysql.Pool;
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
  // MAX_USER_CONNECTIONS is 10: leave room for watchdog KILL connections.
  connectionLimit: 4,
  // Security: one statement per query, always (the server also enforces it).
  multipleStatements: false,
  // BIGINT/DECIMAL as exact strings rather than lossy JS numbers.
  supportBigNumbers: true,
  bigNumberStrings: true,
} as const satisfies mysql.PoolOptions;

export function getRoPool(): mysql.Pool {
  cache.ro ??= mysql.createPool({
    ...RO_POOL_OPTIONS,
    uri: env('DATABASE_RO_URL'),
  });
  return cache.ro;
}
