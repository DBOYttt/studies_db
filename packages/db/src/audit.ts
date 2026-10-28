import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
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

export type AuditFilter = {
  limit: number;
  offset: number;
  userId?: number;
  action?: string;
  /** Actions starting with this text, e.g. `event.`. */
  actionPrefix?: string;
  /** One target, or any of several. */
  target?: string | string[];
  /** Only rows written by users who are currently admins. */
  adminsOnly?: boolean;
};

function auditWhere(o: AuditFilter): SQL | undefined {
  const conds: SQL[] = [];
  if (o.userId !== undefined) conds.push(eq(adminAudit.userId, o.userId));
  if (o.action !== undefined) conds.push(eq(adminAudit.action, o.action));
  if (typeof o.target === 'string') {
    conds.push(eq(adminAudit.target, o.target));
  } else if (o.target !== undefined) {
    conds.push(
      o.target.length > 0 ? inArray(adminAudit.target, o.target) : sql`FALSE`,
    );
  }
  if (o.adminsOnly) conds.push(eq(users.isAdmin, true));
  if (o.actionPrefix !== undefined) {
    const esc = o.actionPrefix.replace(/[\\%_]/g, '\\$&');
    conds.push(sql`${adminAudit.action} LIKE ${`${esc}%`}`);
  }
  return conds.length ? and(...conds) : undefined;
}

/**
 * One page of audit rows, newest first, without the total. A LEFT JOIN
 * (`user_id` is NOT NULL with an FK, so the rows are the same as with an
 * inner join) lets MariaDB read `admin_audit` backwards by id and stop after
 * `limit` rows instead of sorting the whole table.
 */
export async function listAuditRows(
  db: DbExecutor,
  o: AuditFilter,
): Promise<AuditRow[]> {
  const rows = await db
    .select(auditColumns)
    .from(adminAudit)
    .leftJoin(users, eq(users.id, adminAudit.userId))
    .where(auditWhere(o))
    .orderBy(desc(adminAudit.id))
    .limit(o.limit)
    .offset(o.offset);
  return rows.map((r) => ({ ...r, userName: r.userName ?? '' }));
}

export async function listAudit(
  db: DbExecutor,
  o: AuditFilter,
): Promise<{ rows: AuditRow[]; total: number }> {
  const rows = await listAuditRows(db, o);
  const [count] = await db
    .select({ n: sql<number>`count(*)` })
    .from(adminAudit)
    .leftJoin(users, eq(users.id, adminAudit.userId))
    .where(auditWhere(o));
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
