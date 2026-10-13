import mysql from 'mysql2/promise';
import { CONTENT_TABLES, PUBLIC_VIEWS } from './constants.js';

/**
 * The admin SQL console's user: DML on content tables and SELECT on the public
 * views, nothing else (no DDL, no FILE, no auth/bot/audit tables).
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
      await conn.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ${mysql.escapeId(dbName)}.${mysql.escapeId(table)} TO ${user}`,
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
