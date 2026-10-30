import mysql from 'mysql2/promise';

export interface AppUserOptions {
  /** The app database; the grant covers this database only. */
  database: string;
  password: string;
  user?: string;
}

/**
 * The services' user (web, bot and worker): SELECT, INSERT, UPDATE and DELETE
 * on every table and view of the app database, nothing else (no DDL, FILE,
 * GRANT, SUPER or `mysql.*`). Named locks (GET_LOCK) and row locks
 * (FOR UPDATE, LOCK IN SHARE MODE) need no further privilege. The user is
 * server-global, so `adminConn` must be a root-level connection.
 */
export async function ensureAppUser(
  adminConn: mysql.Connection,
  { database, password, user: username = 'studies_app' }: AppUserOptions,
): Promise<void> {
  const user = `${mysql.escape(username)}@'%'`;
  await adminConn.query(`CREATE USER IF NOT EXISTS ${user} IDENTIFIED BY ?`, [
    password,
  ]);
  await adminConn.query(`ALTER USER ${user} IDENTIFIED BY ?`, [password]);
  // Reset to a known state so manually added grants don't survive.
  await adminConn.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${user}`);
  await adminConn.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ${mysql.escapeId(database)}.* TO ${user}`,
  );
}
