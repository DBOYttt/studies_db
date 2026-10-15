import { and, desc, eq, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from './client.js';
import { adminAudit, users } from './schema.js';

export type AuditEntry = {
  userId: number;
  action: string;
  target?: string | null;
  statement?: string | null;
  rowsAffected?: number | null;
  details?: unknown;
};

export type AuditRow = {
  id: number;
  userId: number;
  userName: string;
  action: string;
  target: string | null;
  statement: string | null;
  rowsAffected: number | null;
  details: unknown;
  createdAt: Date;
};

const auditColumns = {
  id: adminAudit.id,
  userId: adminAudit.userId,
  userName: users.displayName,
  action: adminAudit.action,
  target: adminAudit.target,
  statement: adminAudit.statement,
  rowsAffected: adminAudit.rowsAffected,
  details: adminAudit.details,
  createdAt: adminAudit.createdAt,
};

export async function writeAudit(
  db: DbExecutor,
  e: AuditEntry,
): Promise<number> {
  const [res] = await db.insert(adminAudit).values({
    userId: e.userId,
    action: e.action,
    target: e.target ?? null,
    statement: e.statement ?? null,
    rowsAffected: e.rowsAffected ?? null,
    details: e.details ?? null,
  });
  return res.insertId;
}

export async function listAudit(
  db: DbExecutor,
  o: {
    limit: number;
    offset: number;
    userId?: number;
    action?: string;
    /** Actions starting with this text, e.g. `event.`. */
    actionPrefix?: string;
    target?: string;
  },
): Promise<{ rows: AuditRow[]; total: number }> {
  const conds: SQL[] = [];
  if (o.userId !== undefined) conds.push(eq(adminAudit.userId, o.userId));
  if (o.action !== undefined) conds.push(eq(adminAudit.action, o.action));
  if (o.target !== undefined) conds.push(eq(adminAudit.target, o.target));
  if (o.actionPrefix !== undefined) {
    const esc = o.actionPrefix.replace(/[\\%_]/g, '\\$&');
    conds.push(sql`${adminAudit.action} LIKE ${`${esc}%`}`);
  }
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select(auditColumns)
    .from(adminAudit)
    .innerJoin(users, eq(users.id, adminAudit.userId))
    .where(where)
    .orderBy(desc(adminAudit.id))
    .limit(o.limit)
    .offset(o.offset);
  const [count] = await db
    .select({ n: sql<number>`count(*)` })
    .from(adminAudit)
    .where(where);
  return { rows, total: Number(count.n) };
}

export async function getAudit(
  db: DbExecutor,
  id: number,
): Promise<AuditRow | null> {
  const [row] = await db
    .select(auditColumns)
    .from(adminAudit)
    .innerJoin(users, eq(users.id, adminAudit.userId))
    .where(eq(adminAudit.id, id));
  return row ?? null;
}

export async function listAdmins(
  db: DbExecutor,
): Promise<{ id: number; displayName: string; avatarUrl: string | null }[]> {
  return db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(and(eq(users.isAdmin, true), eq(users.isBanned, false)))
    .orderBy(users.displayName);
}
