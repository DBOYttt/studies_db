import {
  createLoginToken,
  type Db,
  searchAll,
  upsertUser,
  users,
} from '@studies/db';
import { escapeMarkdown, MessageFlags, type User } from 'discord.js';
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

export const LINK_BANNED = 'Your access to the website is blocked.';
export const LINK_SENT = 'I sent you the link in a direct message.';
export const LINK_DM_CLOSED =
  'I cannot send a DM. Enable direct messages from server members.';

/**
 * DMs the one-time login URL; false when the user's DMs are closed. `<url>`
 * plus SuppressEmbeds: no link preview, so Discord's crawler never fetches
 * the one-time URL.
 */
export async function sendLoginDm(user: User, url: string): Promise<boolean> {
  try {
    await user.send({
      content: `Your Studies DB link (valid for 15 minutes, single use): <${url}>`,
      flags: MessageFlags.SuppressEmbeds,
    });
    return true;
  } catch {
    return false;
  }
}

export async function searchReply(
  db: Db,
  webBaseUrl: string,
  q: string,
): Promise<string> {
  const hits = await searchAll(db, { q, limit: 5 });
  if (hits.length === 0) return `No results for "${escapeMarkdown(q)}".`;
  return hits
    .slice(0, 5)
    .map((h) => {
      const file = h.filename ? ` — ${escapeMarkdown(h.filename)}` : '';
      return `**${h.subjectCode}** · ${escapeMarkdown(h.topicTitle)}${file} ${webBaseUrl}/topics/${h.topicId}`;
    })
    .join('\n');
}
