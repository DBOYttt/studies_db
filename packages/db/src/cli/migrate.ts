import { createDb } from '../client.js';
import { backfillTopicHierarchy } from '../hierarchy.js';
import { runMigrations } from '../migrate.js';
import { ensureReadonlyUser } from '../readonly-user.js';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const roPassword = process.env.DB_RO_PASSWORD;
if (!adminUrl || !roPassword) {
  console.error('DATABASE_ADMIN_URL and DB_RO_PASSWORD must be set');
  process.exit(1);
}
await runMigrations(adminUrl);
await ensureReadonlyUser(adminUrl, roPassword);
const { db, pool } = createDb(adminUrl);
try {
  const n = await backfillTopicHierarchy(db);
  console.log(`backfilled ${n} topics`);
} finally {
  await pool.end();
}
console.log('migrations applied, read-only user ensured');
