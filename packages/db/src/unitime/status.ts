import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { planSync } from '../schema.js';
import { fixSept } from '../text.js';
import type { SyncStats } from './sync.js';

/** State of the timetable import (single row id = 1). Timestamps are UTC instants. */
export interface PlanSyncStatus {
  requestedAt: Date | null;
  lastRunAt: Date | null;
  lastOkAt: Date | null;
  lastError: string | null;
  stats: SyncStats | null;
}

const ROW_ID = 1;
const MAX_ERROR = 1000;

// `json` is LONGTEXT on MariaDB, so the driver may hand back a string.
function parseStats(raw: unknown): SyncStats | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as SyncStats;
    } catch {
      return null;
    }
  }
  return raw as SyncStats;
}

export async function getPlanSyncStatus(
  db: DbExecutor,
): Promise<PlanSyncStatus> {
  const [row] = await db.select().from(planSync).where(eq(planSync.id, ROW_ID));
  return {
    requestedAt: row?.requestedAt ?? null,
    lastRunAt: row?.lastRunAt ?? null,
    lastOkAt: row?.lastOkAt ?? null,
    lastError: row?.lastError ?? null,
    stats: parseStats(row?.stats),
  };
}

export async function requestPlanSync(
  db: DbExecutor,
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(planSync)
    .values({ id: ROW_ID, requestedAt: now })
    .onDuplicateKeyUpdate({ set: { requestedAt: now } });
}

export async function recordPlanSync(
  db: DbExecutor,
  r:
    | { at: Date; ok: true; stats: SyncStats }
    | { at: Date; ok: false; error: string },
): Promise<void> {
  const set = r.ok
    ? { lastRunAt: r.at, lastOkAt: r.at, lastError: null, stats: r.stats }
    : { lastRunAt: r.at, lastError: r.error.slice(0, MAX_ERROR) };
  await db
    .insert(planSync)
    .values({ id: ROW_ID, ...set })
    .onDuplicateKeyUpdate({ set });
}

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// `now` is accepted for testability/future relative formatting; timestamps are UTC instants.
export function planStatusText(s: PlanSyncStatus, _now: Date): string {
  const lines: string[] = [];
  if (s.lastOkAt) {
    const st = s.stats;
    const counts = st ? ` (+${st.created} ~${st.updated} -${st.deleted})` : '';
    lines.push(`Last sync: ${fixSept(fmt.format(s.lastOkAt))}${counts}`);
  } else {
    lines.push('Never synced.');
  }
  for (const f of s.stats?.feeds ?? [])
    lines.push(
      f.ok
        ? `Semester ${f.semester}: +${f.created} ~${f.updated} -${f.deleted}`
        : `Semester ${f.semester}: failed`,
    );
  if (s.lastError) lines.push(`Error: ${s.lastError}`);
  return lines.join('\n');
}
