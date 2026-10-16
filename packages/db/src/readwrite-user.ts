import { getTableColumns } from 'drizzle-orm';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import mysql from 'mysql2/promise';
import {
  CONTENT_TABLES,
  EVENT_LINK_COLUMNS,
  EVENT_SERIES_LINK_COLUMNS,
  MATERIAL_FILE_COLUMNS,
  PUBLIC_VIEWS,
} from './constants.js';
import { eventSeries, events, materials } from './schema.js';

function columnsExcept(table: MySqlTable, denied: readonly string[]): string[] {
  return Object.values(getTableColumns(table))
    .map((c) => c.name)
    .filter((name) => !denied.includes(name));
}

/** materials columns studies_rw may UPDATE: all but MATERIAL_FILE_COLUMNS. */
export function materialsUpdatableColumns(): string[] {
  return columnsExcept(materials, MATERIAL_FILE_COLUMNS);
}

/**
 * Tables where studies_rw gets column-level INSERT/UPDATE instead of
 * table-wide: the listed columns are left out. `insert: false` drops INSERT.
 */
const RESTRICTED: Record<
  string,
  { table: MySqlTable; denied: readonly string[]; insert: boolean }
> = {
  materials: { table: materials, denied: MATERIAL_FILE_COLUMNS, insert: false },
  events: { table: events, denied: EVENT_LINK_COLUMNS, insert: true },
  event_series: {
    table: eventSeries,
    denied: EVENT_SERIES_LINK_COLUMNS,
    insert: true,
  },
};

/**
 * The admin SQL console's user: DML on content tables and SELECT on the public
 * views, nothing else (no DDL, no FILE, no auth/bot/audit tables). On
 * `materials` it gets no INSERT and no UPDATE of the file-path columns, since
 * the worker reads and writes files from those values. On `events` and
 * `event_series` it may not write the thread/owner links (the bot acts on the
 * thread they point at).
 */
export async function ensureReadWriteUser(
  adminUrl: string,
  password: string,
  username = 'studies_rw',
): Promise<void> {
  const dbName = decodeURIComponent(new URL(adminUrl).pathname.slice(1));
  const conn = await mysql.createConnection({
    uri: adminUrl,
    charset: 'utf8mb4',
  });
  try {
    const user = `${mysql.escape(username)}@'%'`;
    await conn.query(`CREATE USER IF NOT EXISTS ${user} IDENTIFIED BY ?`, [
      password,
    ]);
    await conn.query(`ALTER USER ${user} IDENTIFIED BY ?`, [password]);
    // Reset to a known state so manually added grants don't survive.
    await conn.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${user}`);
    await conn.query(
      `ALTER USER ${user} WITH MAX_USER_CONNECTIONS 5 MAX_STATEMENT_TIME 5`,
    );
    for (const table of CONTENT_TABLES) {
      const target = `${mysql.escapeId(dbName)}.${mysql.escapeId(table)}`;
      const restricted = RESTRICTED[table];
      if (restricted) {
        const cols = columnsExcept(restricted.table, restricted.denied)
          .map((c) => mysql.escapeId(c))
          .join(', ');
        const insert = restricted.insert ? `, INSERT (${cols})` : '';
        await conn.query(
          `GRANT SELECT, DELETE, UPDATE (${cols})${insert} ON ${target} TO ${user}`,
        );
        continue;
      }
      await conn.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ${target} TO ${user}`,
      );
    }
    for (const view of PUBLIC_VIEWS) {
      await conn.query(
        `GRANT SELECT ON ${mysql.escapeId(dbName)}.${mysql.escapeId(view)} TO ${user}`,
      );
    }
  } finally {
    await conn.end();
  }
}
