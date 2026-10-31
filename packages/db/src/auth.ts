import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import type { Db, DbExecutor } from './client.js';
import { loginTokens, sessions, users } from './schema.js';

export const LOGIN_TOKEN_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
/** A used session is pushed to `now + SESSION_TTL_MS` at most once per this. */
export const SESSION_RENEW_AFTER_MS = 24 * 3600_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function upsertUser(
  db: DbExecutor,
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
  db: DbExecutor,
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
  // The token is marked used before the ban check on purpose: a banned
  // user's token is burned on consume and cannot be replayed after an unban.
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
  db: DbExecutor,
  sessionToken: string,
  now: Date = new Date(),
): Promise<{
  id: number;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
} | null> {
  const [row] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      isAdmin: users.isAdmin,
      expiresAt: sessions.expiresAt,
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
  if (!row) return null;
  const { expiresAt, ...user } = row;
  // Sliding session: a session in use never runs out; one idle for
  // SESSION_TTL_MS does. Renewed at most once a day to keep writes rare.
  if (
    expiresAt.getTime() <
    now.getTime() + SESSION_TTL_MS - SESSION_RENEW_AFTER_MS
  ) {
    try {
      await db
        .update(sessions)
        .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
        .where(
          and(
            eq(sessions.tokenHash, hashToken(sessionToken)),
            gt(sessions.expiresAt, now),
          ),
        );
    } catch (err) {
      // The session is still valid; only its renewal waits for the next use.
      console.error(
        'session renew failed',
        (err as { code?: string }).code ?? 'unknown',
      );
    }
  }
  return user;
}

export async function deleteSession(
  db: DbExecutor,
  sessionToken: string,
): Promise<void> {
  await db
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashToken(sessionToken)));
}

/**
 * Deletes sessions and login tokens past their expiry (the worker runs it
 * daily). Expired rows are already refused on use; this keeps the tables small.
 */
export async function purgeExpiredAuth(
  db: DbExecutor,
  now: Date = new Date(),
): Promise<{ sessions: number; loginTokens: number }> {
  const [s] = await db.delete(sessions).where(lte(sessions.expiresAt, now));
  const [t] = await db
    .delete(loginTokens)
    .where(lte(loginTokens.expiresAt, now));
  return { sessions: s.affectedRows, loginTokens: t.affectedRows };
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
