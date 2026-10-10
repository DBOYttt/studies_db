import {
  createLoginToken,
  type Db,
  searchAll,
  upsertUser,
  users,
} from '@studies/db';
import { eq } from 'drizzle-orm';
import type { DiscordUser } from '../types.js';

export async function linkFor(
  db: Db,
  webBaseUrl: string,
  user: DiscordUser,
): Promise<{ ok: true; url: string } | { ok: false; reason: 'banned' }> {
  const userId = await upsertUser(db, user);
  const [row] = await db
    .select({ isBanned: users.isBanned })
    .from(users)
    .where(eq(users.id, userId));
  if (row?.isBanned) return { ok: false, reason: 'banned' };
  const token = await createLoginToken(db, userId);
  return { ok: true, url: `${webBaseUrl}/auth/callback?token=${token}` };
}

export async function searchReply(
  db: Db,
  webBaseUrl: string,
  q: string,
): Promise<string> {
  const hits = await searchAll(db, { q, limit: 5 });
  if (hits.length === 0) return `Brak wyników dla „${q}”.`;
  return hits
    .slice(0, 5)
    .map((h) => {
      const file = h.filename ? ` — ${h.filename}` : '';
      return `**${h.subjectCode}** · ${h.topicTitle}${file} ${webBaseUrl}/topics/${h.topicId}`;
    })
    .join('\n');
}
