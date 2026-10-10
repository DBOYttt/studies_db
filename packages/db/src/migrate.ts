import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';

export async function runMigrations(adminUrl: string): Promise<void> {
  // Resolved lazily so merely importing this module has no side effects.
  const migrationsFolder = fileURLToPath(
    new URL('../migrations', import.meta.url),
  );
  const conn = await mysql.createConnection({
    uri: adminUrl,
    charset: 'utf8mb4',
  });
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT @@character_set_database AS cs, @@innodb_ft_min_token_size AS ft',
    );
    const { cs, ft } = rows[0];
    if (cs !== 'utf8mb4') {
      throw new Error(
        `Database character set is '${cs}', expected 'utf8mb4'. Recreate the database with CHARACTER SET utf8mb4.`,
      );
    }
    if (Number(ft) > 2) {
      console.warn(
        `warning: innodb_ft_min_token_size=${ft} (>2); short search terms will not match`,
      );
    }
    await migrate(drizzle(conn), { migrationsFolder });
  } finally {
    await conn.end();
  }
}
