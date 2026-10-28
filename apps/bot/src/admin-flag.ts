import { type Db, getSetting, users } from '@studies/db';
import type { Interaction } from 'discord.js';
import { eq, sql } from 'drizzle-orm';
import { ADMIN_ROLE_SETTING } from './config.js';
import type { DiscordUser } from './types.js';

/**
 * Role ids of the invoking member (plain array or GuildMemberRoleManager), for
 * any interaction that carries a member.
 */
export function memberRoleIds(i: Pick<Interaction, 'member'>): string[] {
  const roles = i.member?.roles;
  if (!roles) return [];
  return Array.isArray(roles) ? [...roles] : [...roles.cache.keys()];
}

/**
 * Mirrors "has the stored admin role" into users.is_admin so the web app can
 * check it, upserting the user in the same statement. Returns the resulting
 * flag, the users.id, whether the user is banned (a banned admin is refused
 * on every admin path) and the stored admin role id (null before the first
 * /setup).
 */
export async function syncAdminFlag(
  db: Db,
  user: DiscordUser,
  roleIds: string[],
): Promise<{
  isAdmin: boolean;
  isBanned: boolean;
  roleId: string | null;
  userId: number;
}> {
  const roleId = await getSetting(db, ADMIN_ROLE_SETTING);
  const isAdmin = roleId !== null && roleIds.includes(roleId);
  const [res] = await db
    .insert(users)
    .values({
      discordUserId: user.discordUserId,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isAdmin,
    })
    .onDuplicateKeyUpdate({
      set: {
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isAdmin,
        // Makes insertId carry the existing row's id on the update path.
        id: sql`LAST_INSERT_ID(${users.id})`,
      },
    });
  const userId = res.insertId;
  const [row] = await db
    .select({ isBanned: users.isBanned })
    .from(users)
    .where(eq(users.id, userId));
  // No row would be a bug; refuse rather than allow.
  return { isAdmin, isBanned: row?.isBanned ?? true, roleId, userId };
}

/** users.is_banned of a Discord user; false when they have no row yet. */
export async function isBannedDiscordUser(
  db: Db,
  discordUserId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ isBanned: users.isBanned })
    .from(users)
    .where(eq(users.discordUserId, discordUserId));
  return row?.isBanned ?? false;
}
