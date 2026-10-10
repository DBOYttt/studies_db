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

export function getRoPool(): mysql.Pool {
  cache.ro ??= mysql.createPool({
    uri: env('DATABASE_RO_URL'),
    charset: 'utf8mb4',
    timezone: 'Z',
    connectionLimit: 5,
  });
  return cache.ro;
}
