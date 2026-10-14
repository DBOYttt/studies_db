import {
  createLoginToken,
  type Db,
  searchAll,
  upsertUser,
  users,
} from '@studies/db';
import { escapeMarkdown } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { DiscordUser } from '../types.js';

export async function linkFor(
  db: Db,
  webBaseUrl: string,
  user: DiscordUser,
  next?: '/admin',
): Promise<{ ok: true; url: string } | { ok: false; reason: 'banned' }> {
  const userId = await upsertUser(db, user);
  const [row] = await db
    .select({ isBanned: users.isBanned })
    .from(users)
    .where(eq(users.id, userId));
  if (row?.isBanned) return { ok: false, reason: 'banned' };
  const token = await createLoginToken(db, userId);
  const suffix = next ? `&next=${encodeURIComponent(next)}` : '';
  return {
    ok: true,
    url: `${webBaseUrl}/auth/callback?token=${token}${suffix}`,
  };
}

export async function searchReply(
  db: Db,
  webBaseUrl: string,
  q: string,
): Promise<string> {
  const hits = await searchAll(db, { q, limit: 5 });
  if (hits.length === 0) return `Brak wyników dla „${escapeMarkdown(q)}”.`;
  return hits
    .slice(0, 5)
    .map((h) => {
      const file = h.filename ? ` — ${escapeMarkdown(h.filename)}` : '';
      return `**${h.subjectCode}** · ${escapeMarkdown(h.topicTitle)}${file} ${webBaseUrl}/topics/${h.topicId}`;
    })
    .join('\n');
}
