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
    for (const view of PUBLIC_VIEWS) {
      await conn.query(
        `GRANT SELECT ON ${mysql.escapeId(dbName)}.${mysql.escapeId(view)} TO ${user}`,
      );
    }
    await conn.query('FLUSH PRIVILEGES');
  } finally {
    await conn.end();
  }
}
