import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from './client.js';
import { loginTokens, sessions, users } from './schema.js';

export const LOGIN_TOKEN_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 3600_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function upsertUser(
  db: Db,
  u: { discordUserId: string; displayName: string; avatarUrl: string | null },
): Promise<number> {
  await db
    .insert(users)
    .values(u)
    .onDuplicateKeyUpdate({
      set: { displayName: u.displayName, avatarUrl: u.avatarUrl },
    });
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.discordUserId, u.discordUserId));
  return row.id;
}

export async function createLoginToken(
  db: Db,
  userId: number,
  now: Date = new Date(),
): Promise<string> {
  const token = newToken();
  await db.insert(loginTokens).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + LOGIN_TOKEN_TTL_MS),
  });
  return token;
}

export async function consumeLoginToken(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<{ sessionToken: string; expiresAt: Date } | null> {
  const tokenHash = hashToken(token);
  return db.transaction(async (tx) => {
    const [res] = await tx
      .update(loginTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(loginTokens.tokenHash, tokenHash),
          isNull(loginTokens.usedAt),
          gt(loginTokens.expiresAt, now),
        ),
      );
    if (res.affectedRows !== 1) return null;
    const [row] = await tx
      .select({ userId: loginTokens.userId, banned: users.isBanned })
      .from(loginTokens)
      .innerJoin(users, eq(users.id, loginTokens.userId))
      .where(eq(loginTokens.tokenHash, tokenHash));
    if (!row || row.banned) return null;
    const sessionToken = newToken();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await tx.insert(sessions).values({
      userId: row.userId,
      tokenHash: hashToken(sessionToken),
      expiresAt,
      createdAt: now,
    });
    return { sessionToken, expiresAt };
  });
}

export async function getSessionUser(
  db: Db,
  sessionToken: string,
  now: Date = new Date(),
): Promise<{
  id: number;
  displayName: string;
  avatarUrl: string | null;
} | null> {
  const [row] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(sessionToken)),
        gt(sessions.expiresAt, now),
        eq(users.isBanned, false),
      ),
    );
  return row ?? null;
}

export async function deleteSession(
  db: Db,
  sessionToken: string,
): Promise<void> {
  await db
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashToken(sessionToken)));
}

export async function setBanned(
  db: Db,
  discordUserId: string,
  banned: boolean,
): Promise<boolean> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.discordUserId, discordUserId));
  if (!user) return false;
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isBanned: banned })
      .where(eq(users.id, user.id));
    if (banned) await tx.delete(sessions).where(eq(sessions.userId, user.id));
  });
  return true;
}
