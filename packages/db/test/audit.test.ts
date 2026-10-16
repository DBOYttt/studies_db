import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAudit, listAdmins, listAudit, writeAudit } from '../src/audit.js';
import { upsertUser } from '../src/auth.js';
import type { Db } from '../src/client.js';
import { CONTENT_TABLES, PUBLIC_VIEWS } from '../src/constants.js';
import { adminAudit, users } from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

let db: Db;
let a: number;
let b: number;

beforeAll(async () => {
  db = await resetTestDb();
  a = await upsertUser(db, {
    discordUserId: 'a',
    displayName: 'Alice',
    avatarUrl: 'http://x/a.png',
  });
  b = await upsertUser(db, {
    discordUserId: 'b',
    displayName: 'Bob',
    avatarUrl: null,
  });
});
afterAll(async () => {
  await closeTestDb(db);
});

describe('audit', () => {
  it('writeAudit returns id; getAudit round-trips; missing is null', async () => {
    const id = await writeAudit(db, {
      userId: a,
      action: 'sql.execute',
      target: 'subjects',
      statement: 'UPDATE subjects SET name = 1',
      rowsAffected: 3,
      details: { x: 1 },
    });
    expect(id).toBeGreaterThan(0);
    const row = await getAudit(db, id);
    expect(row).toMatchObject({
      id,
      userId: a,
      userName: 'Alice',
      action: 'sql.execute',
      target: 'subjects',
      statement: 'UPDATE subjects SET name = 1',
      rowsAffected: 3,
      details: { x: 1 },
    });
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(await getAudit(db, 999999)).toBeNull();
  });

  it('optional fields default to null', async () => {
    const id = await writeAudit(db, { userId: b, action: 'sql.rejected' });
    expect(await getAudit(db, id)).toMatchObject({
      target: null,
      statement: null,
      rowsAffected: null,
      details: null,
    });
  });

  it('listAudit is newest first, filters and paginates with total', async () => {
    await db.delete(adminAudit);
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        await writeAudit(db, {
          userId: i % 2 === 0 ? a : b,
          action: i < 3 ? 'sql.execute' : 'sql.rejected',
        }),
      );
    }
    const all = await listAudit(db, { limit: 10, offset: 0 });
    expect(all.total).toBe(5);
    expect(all.rows.map((r) => r.id)).toEqual([...ids].reverse());
    expect(all.rows[0].userName).toBe('Alice');

    const page = await listAudit(db, { limit: 2, offset: 2 });
    expect(page.total).toBe(5);
    expect(page.rows.map((r) => r.id)).toEqual([ids[2], ids[1]]);

    const byUser = await listAudit(db, { limit: 10, offset: 0, userId: a });
    expect(byUser.total).toBe(3);
    expect(byUser.rows.every((r) => r.userId === a)).toBe(true);

    const byAction = await listAudit(db, {
      limit: 10,
      offset: 0,
      action: 'sql.rejected',
    });
    expect(byAction.total).toBe(2);

    const both = await listAudit(db, {
      limit: 10,
      offset: 0,
      userId: b,
      action: 'sql.execute',
    });
    expect(both.rows.map((r) => r.id)).toEqual([ids[1]]);
    expect(both.total).toBe(1);
  });

  it('listAudit adminsOnly keeps rows of current admins', async () => {
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, a));
    const res = await listAudit(db, { limit: 10, offset: 0, adminsOnly: true });
    expect(res.total).toBe(3);
    expect(res.rows.every((r) => r.userId === a)).toBe(true);
    await db.update(users).set({ isAdmin: false }).where(eq(users.id, a));
  });

  it('listAdmins lists only flagged, non-banned users', async () => {
    const c = await upsertUser(db, {
      discordUserId: 'c',
      displayName: 'Carol',
      avatarUrl: null,
    });
    expect(await listAdmins(db)).toEqual([]);
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, a));
    await db
      .update(users)
      .set({ isAdmin: true, isBanned: true })
      .where(eq(users.id, c));
    expect(await listAdmins(db)).toEqual([
      { id: a, displayName: 'Alice', avatarUrl: 'http://x/a.png' },
    ]);
  });

  it('admin_audit is not a public view and not a content table', () => {
    expect(PUBLIC_VIEWS as readonly string[]).not.toContain('admin_audit');
    expect(CONTENT_TABLES as readonly string[]).not.toContain('admin_audit');
    expect(CONTENT_TABLES).toContain('subjects');
    expect(CONTENT_TABLES).toHaveLength(14);
  });
});
