import {
  type Db,
  getPlanSyncStatus,
  planStatusText,
  requestPlanSync,
} from '@studies/db';

export { planStatusText };

export async function planStatusReply(db: Db, now: Date): Promise<string> {
  return planStatusText(await getPlanSyncStatus(db), now);
}

export async function planSyncReply(db: Db, now: Date): Promise<string> {
  await requestPlanSync(db, now);
  return `Timetable sync requested (the worker will run it within a minute).\n${await planStatusReply(db, now)}`;
}
