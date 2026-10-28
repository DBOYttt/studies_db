import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  consumeLoginToken,
  createLoginToken,
  deleteSession,
  getSessionUser,
  hashToken,
  LOGIN_TOKEN_TTL_MS,
  purgeExpiredAuth,
  SESSION_TTL_MS,
  setBanned,
  upsertUser,
} from '../src/auth.js';
import type { Db } from '../src/client.js';
import { loginTokens, sessions, users } from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

let db: Db;
let n = 0;

beforeAll(async () => {
  db = await resetTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});

function must<T>(v: T | null): T {
  if (v === null) throw new Error('expected non-null');
  return v;
}

async function newUser() {
  n += 1;
  const id = await upsertUser(db, {
    discordUserId: `d${n}`,
    displayName: `User ${n}`,
    avatarUrl: null,
  });
  return { id, discordUserId: `d${n}` };
}

describe('auth', () => {
  it('valid token yields a session usable once', async () => {
    const u = await newUser();
    const now = new Date('2026-01-01T00:00:00Z');
    const token = await createLoginToken(db, u.id, now);
    const s = await consumeLoginToken(db, token, now);
    expect(s).not.toBeNull();
    const sess = must(s);
    expect(sess.expiresAt.getTime()).toBe(now.getTime() + SESSION_TTL_MS);
    const user = await getSessionUser(db, sess.sessionToken, now);
    expect(user).toEqual({
      id: u.id,
      displayName: `User ${n}`,
      avatarUrl: null,
      isAdmin: false,
    });
    expect(await consumeLoginToken(db, token, now)).toBeNull();
  });

  it('unknown token is rejected', async () => {
    expect(await consumeLoginToken(db, 'nope')).toBeNull();
  });

  it('expires login token after 15 minutes', async () => {
    const u = await newUser();
    const now = new Date('2026-01-01T00:00:00Z');
    const token = await createLoginToken(db, u.id, now);
    const late = new Date(now.getTime() + LOGIN_TOKEN_TTL_MS + 1);
    expect(await consumeLoginToken(db, token, late)).toBeNull();
  });

  it('banned user cannot consume token', async () => {
    const u = await newUser();
    const token = await createLoginToken(db, u.id);
    expect(await setBanned(db, u.discordUserId, true)).toBe(true);
    expect(await consumeLoginToken(db, token)).toBeNull();
  });

  it('banning kills existing sessions', async () => {
    const u = await newUser();
    const token = await createLoginToken(db, u.id);
    const s = must(await consumeLoginToken(db, token));
    expect(await getSessionUser(db, s.sessionToken)).not.toBeNull();
    await setBanned(db, u.discordUserId, true);
    expect(await getSessionUser(db, s.sessionToken)).toBeNull();
    expect(await setBanned(db, 'unknown-user', true)).toBe(false);
  });

  it('session expires after 30 days', async () => {
    const u = await newUser();
    const now = new Date('2026-01-01T00:00:00Z');
    const s = must(
      await consumeLoginToken(db, await createLoginToken(db, u.id, now), now),
    );
    expect(
      await getSessionUser(
        db,
        s.sessionToken,
        new Date(now.getTime() + SESSION_TTL_MS - 1),
      ),
    ).not.toBeNull();
    expect(
      await getSessionUser(
        db,
        s.sessionToken,
        new Date(now.getTime() + SESSION_TTL_MS + 1),
      ),
    ).toBeNull();
  });

  it('deleteSession removes the session', async () => {
    const u = await newUser();
    const s = must(
      await consumeLoginToken(db, await createLoginToken(db, u.id)),
    );
    await deleteSession(db, s.sessionToken);
    expect(await getSessionUser(db, s.sessionToken)).toBeNull();
  });

  it('stores only hashes', async () => {
    const u = await newUser();
    const token = await createLoginToken(db, u.id);
    const s = must(await consumeLoginToken(db, token));
    const [lt] = await db
      .select({ h: loginTokens.tokenHash })
      .from(loginTokens)
      .where(eq(loginTokens.userId, u.id));
    expect(lt.h).toBe(hashToken(token));
    expect(lt.h).not.toBe(token);
    expect(lt.h).toHaveLength(64);
    const [ss] = await db
      .select({ h: sessions.tokenHash })
      .from(sessions)
      .where(eq(sessions.userId, u.id));
    expect(ss.h).toBe(hashToken(s.sessionToken));
    expect(ss.h).toHaveLength(64);
  });

  it('upsertUser updates name and keeps id', async () => {
    const a = await upsertUser(db, {
      discordUserId: 'dup',
      displayName: 'A',
      avatarUrl: null,
    });
    const b = await upsertUser(db, {
      discordUserId: 'dup',
      displayName: 'B',
      avatarUrl: 'http://x/a.png',
    });
    expect(b).toBe(a);
    const s = must(await consumeLoginToken(db, await createLoginToken(db, a)));
    expect(await getSessionUser(db, s.sessionToken)).toEqual({
      id: a,
      displayName: 'B',
      avatarUrl: 'http://x/a.png',
      isAdmin: false,
    });
  });

  it('is_admin defaults to false and getSessionUser reflects the flag', async () => {
    const u = await newUser();
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row.isAdmin).toBe(false);
    const token = await createLoginToken(db, u.id);
    const s = must(await consumeLoginToken(db, token));
    expect(must(await getSessionUser(db, s.sessionToken)).isAdmin).toBe(false);
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, u.id));
    expect(must(await getSessionUser(db, s.sessionToken)).isAdmin).toBe(true);
  });
});

describe('purgeExpiredAuth', () => {
  it('deletes expired sessions and login tokens, keeps live ones', async () => {
    const u = await newUser();
    const t0 = new Date('2026-01-01T12:00:00Z');
    const oldToken = await createLoginToken(db, u.id, t0);
    const oldSession = must(
      await consumeLoginToken(db, await createLoginToken(db, u.id, t0), t0),
    );
    const now = new Date(t0.getTime() + SESSION_TTL_MS + 1000);
    const liveToken = await createLoginToken(db, u.id, now);
    const liveSession = must(
      await consumeLoginToken(db, await createLoginToken(db, u.id, now), now),
    );

    const removed = await purgeExpiredAuth(db, now);
    expect(removed.sessions).toBeGreaterThanOrEqual(1);
    expect(removed.loginTokens).toBeGreaterThanOrEqual(2);

    const tokenHashes = (
      await db
        .select({ h: loginTokens.tokenHash })
        .from(loginTokens)
        .where(eq(loginTokens.userId, u.id))
    ).map((r) => r.h);
    expect(tokenHashes).toContain(hashToken(liveToken));
    expect(tokenHashes).not.toContain(hashToken(oldToken));
    const sessionHashes = (
      await db
        .select({ h: sessions.tokenHash })
        .from(sessions)
        .where(eq(sessions.userId, u.id))
    ).map((r) => r.h);
    expect(sessionHashes).toEqual([hashToken(liveSession.sessionToken)]);
    expect(sessionHashes).not.toContain(hashToken(oldSession.sessionToken));
  });
});
