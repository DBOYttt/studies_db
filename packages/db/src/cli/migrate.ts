import mysql from 'mysql2/promise';
import { ensureAppUser } from '../app-user.js';
import { createDb } from '../client.js';
import { backfillTopicHierarchy } from '../hierarchy.js';
import { runMigrations } from '../migrate.js';
import { ensureReadonlyUser } from '../readonly-user.js';
import { ensureReadWriteUser } from '../readwrite-user.js';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const roPassword = process.env.DB_RO_PASSWORD;
if (!adminUrl || !roPassword) {
  console.error('DATABASE_ADMIN_URL and DB_RO_PASSWORD must be set');
  process.exit(1);
}
await runMigrations(adminUrl);
await ensureReadonlyUser(adminUrl, roPassword);
console.log('migrations applied, read-only user ensured');
const rwPassword = process.env.DB_RW_PASSWORD;
if (rwPassword) {
  await ensureReadWriteUser(adminUrl, rwPassword);
  console.log('read-write user ensured');
} else {
  console.log('DB_RW_PASSWORD not set: admin SQL console disabled');
}
const appPassword = process.env.DB_APP_PASSWORD;
if (appPassword) {
  const database = decodeURIComponent(new URL(adminUrl).pathname.slice(1));
  const conn = await mysql.createConnection({
    uri: adminUrl,
    charset: 'utf8mb4',
  });
  try {
    await ensureAppUser(conn, { database, password: appPassword });
  } finally {
    await conn.end();
  }
  console.log('app user ensured');
} else {
  console.log('DB_APP_PASSWORD not set: services keep the DATABASE_URL user');
}
const { db, pool } = createDb(adminUrl);
try {
  const n = await backfillTopicHierarchy(db);
  console.log(`backfilled ${n} topics`);
} finally {
  await pool.end();
}
