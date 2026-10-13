import { type Db, getSetting, upsertUser, users } from '@studies/db';
import type { ChatInputCommandInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { ADMIN_ROLE_SETTING } from './config.js';
import type { DiscordUser } from './types.js';

/** Role ids of the invoking member (plain array or GuildMemberRoleManager). */
export function memberRoleIds(i: ChatInputCommandInteraction): string[] {
  const roles = i.member?.roles;
  if (!roles) return [];
  return Array.isArray(roles) ? [...roles] : [...roles.cache.keys()];
}

/**
 * Mirrors "has the stored admin role" into users.is_admin so the web app can
 * check it. Writes only when the value changes; returns the resulting flag.
 */
export async function syncAdminFlag(
  db: Db,
  user: DiscordUser,
  roleIds: string[],
): Promise<boolean> {
  const adminRoleId = await getSetting(db, ADMIN_ROLE_SETTING);
  const want = adminRoleId !== null && roleIds.includes(adminRoleId);
  await upsertUser(db, user);
  const [row] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.discordUserId, user.discordUserId));
  if (row && row.isAdmin !== want) {
    await db
      .update(users)
      .set({ isAdmin: want })
      .where(eq(users.discordUserId, user.discordUserId));
  }
  return want;
}
