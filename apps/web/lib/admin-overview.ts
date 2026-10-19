import {
  type AuditRow,
  type Db,
  jobs,
  listAdmins,
  listAudit,
  materials,
  subjects,
  topics,
} from '@studies/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

export interface AdminOverview {
  admins: Awaited<ReturnType<typeof listAdmins>>;
  /** The 10 newest audit entries, newest first. */
  recent: AuditRow[];
  counts: {
    subjects: number;
    /** Topics not soft-deleted. */
    topics: number;
    /** Materials with status `ready`, not soft-deleted. */
    readyFiles: number;
    jobsQueued: number;
    jobsFailed: number;
  };
}

const n = sql<number>`count(*)`;

/** Data of the /admin "Overview" screen (main pool, read only). */
export async function getAdminOverview(db: Db): Promise<AdminOverview> {
  const [admins, audit, [s], [t], [f], jobRows] = await Promise.all([
    listAdmins(db),
    listAudit(db, { limit: 10, offset: 0 }),
    db.select({ n }).from(subjects),
    db.select({ n }).from(topics).where(isNull(topics.deletedAt)),
    db
      .select({ n })
      .from(materials)
      .where(and(eq(materials.status, 'ready'), isNull(materials.deletedAt))),
    db
      .select({ status: jobs.status, n })
      .from(jobs)
      .where(inArray(jobs.status, ['queued', 'failed']))
      .groupBy(jobs.status),
  ]);
  const jobsOf = (status: string) =>
    Number(jobRows.find((r) => r.status === status)?.n ?? 0);
  return {
    admins,
    recent: audit.rows,
    counts: {
      subjects: Number(s.n),
      topics: Number(t.n),
      readyFiles: Number(f.n),
      jobsQueued: jobsOf('queued'),
      jobsFailed: jobsOf('failed'),
    },
  };
}
