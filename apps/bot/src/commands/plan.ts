import {
  type Db,
  getPlanSyncStatus,
  type PlanSyncStatus,
  requestPlanSync,
} from '@studies/db';
import { fixSept } from '@studies/db/text';

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
  if (s.lastError) lines.push(`Error: ${s.lastError}`);
  return lines.join('\n');
}

export async function planStatusReply(db: Db, now: Date): Promise<string> {
  return planStatusText(await getPlanSyncStatus(db), now);
}

export async function planSyncReply(db: Db, now: Date): Promise<string> {
  await requestPlanSync(db, now);
  return `Timetable sync requested (the worker will run it within a minute).\n${await planStatusReply(db, now)}`;
}
