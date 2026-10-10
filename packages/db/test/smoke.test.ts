import type { RowDataPacket } from 'mysql2/promise';
import mysql from 'mysql2/promise';
import { expect, it } from 'vitest';

it('connects to the test database', async () => {
  const conn = await mysql.createConnection(
    process.env.TEST_DATABASE_URL as string,
  );
  try {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT 1 AS ok');
    expect(rows[0].ok).toBe(1);
  } finally {
    await conn.end();
  }
});
