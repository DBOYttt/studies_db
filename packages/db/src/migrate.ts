import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import { ensureReadonlyUser } from './readonly-user.js';

const migrationsFolder = fileURLToPath(
  new URL('../migrations', import.meta.url),
);

export async function runMigrations(adminUrl: string): Promise<void> {
  const conn = await mysql.createConnection({
    uri: adminUrl,
    charset: 'utf8mb4',
  });
  try {
    await migrate(drizzle(conn), { migrationsFolder });
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const roPassword = process.env.DB_RO_PASSWORD;
  if (!adminUrl || !roPassword) {
    console.error('DATABASE_ADMIN_URL and DB_RO_PASSWORD must be set');
    process.exit(1);
  }
  await runMigrations(adminUrl);
  await ensureReadonlyUser(adminUrl, roPassword);
  console.log('migrations applied, read-only user ensured');
}
