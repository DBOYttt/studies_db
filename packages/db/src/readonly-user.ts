import mysql from 'mysql2/promise';
import { PUBLIC_VIEWS } from './schema.js';

export async function ensureReadonlyUser(
  adminUrl: string,
  roPassword: string,
  username = 'studies_ro',
): Promise<void> {
  const dbName = decodeURIComponent(new URL(adminUrl).pathname.slice(1));
  const conn = await mysql.createConnection({
    uri: adminUrl,
    charset: 'utf8mb4',
  });
  try {
    const user = `${mysql.escape(username)}@'%'`;
    await conn.query(`CREATE USER IF NOT EXISTS ${user} IDENTIFIED BY ?`, [
      roPassword,
    ]);
    await conn.query(`ALTER USER ${user} IDENTIFIED BY ?`, [roPassword]);
    // Reset to a known state so manually added grants don't survive.
    await conn.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${user}`);
    await conn.query(
      `ALTER USER ${user} WITH MAX_USER_CONNECTIONS 10 MAX_STATEMENT_TIME 5`,
    );
    for (const view of PUBLIC_VIEWS) {
      await conn.query(
        `GRANT SELECT ON ${mysql.escapeId(dbName)}.${mysql.escapeId(view)} TO ${user}`,
      );
    }
  } finally {
    await conn.end();
  }
}
