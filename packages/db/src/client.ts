import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.js';

export type Db = MySql2Database<typeof schema>;
/** Either the root db or a transaction handle. */
export type DbExecutor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(url: string): { db: Db; pool: mysql.Pool } {
  const pool = mysql.createPool({
    uri: url,
    charset: 'utf8mb4',
    timezone: 'Z',
    connectionLimit: 10,
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool };
}
