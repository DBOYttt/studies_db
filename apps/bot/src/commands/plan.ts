import {
  type Db,
  getPlanSyncStatus,
  type PlanSyncStatus,
  requestPlanSync,
} from '@studies/db';

const fmt = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  dateStyle: 'short',
  timeStyle: 'short',
});

// `now` is accepted for testability/future relative formatting; timestamps are UTC instants.
export function planStatusText(s: PlanSyncStatus, _now: Date): string {
  const lines: string[] = [];
  if (s.lastOkAt) {
    const st = s.stats;
    const counts = st ? ` (+${st.created} ~${st.updated} -${st.deleted})` : '';
    lines.push(`Ostatnia synchronizacja: ${fmt.format(s.lastOkAt)}${counts}`);
  } else {
    lines.push('Nigdy nie synchronizowano.');
  }
  if (s.lastError) lines.push(`Błąd: ${s.lastError}`);
  return lines.join('\n');
}

export async function planStatusReply(db: Db, now: Date): Promise<string> {
  return planStatusText(await getPlanSyncStatus(db), now);
}

export async function planSyncReply(db: Db, now: Date): Promise<string> {
  await requestPlanSync(db, now);
  return `Zlecono synchronizację planu (wykona ją worker w ciągu minuty).\n${await planStatusReply(db, now)}`;
}
