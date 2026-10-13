import { eq } from 'drizzle-orm';
import type { DbExecutor } from './client.js';
import { botSettings } from './schema.js';

export async function getSetting(
  db: DbExecutor,
  key: string,
): Promise<string | null> {
  const [row] = await db
    .select({ value: botSettings.value })
    .from(botSettings)
    .where(eq(botSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setSetting(
  db: DbExecutor,
  key: string,
  value: string,
): Promise<void> {
  await db
    .insert(botSettings)
    .values({ key, value, updatedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
}
