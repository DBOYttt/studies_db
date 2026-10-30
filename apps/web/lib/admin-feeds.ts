'use server';

import {
  clearFeed,
  isSemester,
  requestPlanSync,
  type Semester,
  setFeed,
  writeAudit,
} from '@studies/db';
import { revalidatePath } from 'next/cache';
import { type ActionState, field } from './admin-forms';
import { invalidateCounts } from './count-cache';
import { getDb } from './db';
import { requireAdmin } from './session';

/**
 * Server Actions of the "Timetable feeds" card (/admin/sync): one UniTime
 * iCal link per semester. A link is a secret, so no message, audit row or
 * log line here ever contains one: the audit payload carries hosts only.
 */

const BAD_SEMESTER = 'Choose a semester from 1 to 7.';

function parseSemester(form: FormData): Semester | null {
  const t = field(form, 'semester').trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return isSemester(n) ? n : null;
}

async function audit(
  userId: number,
  action: string,
  semester: Semester,
  details: object,
): Promise<void> {
  // The change is committed: a failed audit write is logged, not reported.
  try {
    await writeAudit(getDb(), {
      userId,
      action,
      target: `semester:${semester}`,
      details: { ...details, source: 'web' },
    });
  } catch (err) {
    console.error('admin audit write failed', action, semester, err);
  }
}

function refresh() {
  invalidateCounts();
  revalidatePath('/admin');
  revalidatePath('/admin/audit');
  revalidatePath('/admin/sync');
}

export async function saveFeedAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  const semester = parseSemester(form);
  if (semester === null) return { ok: false, message: BAD_SEMESTER };
  // Empty means "keep what is stored"; the exam link is removed only by the
  // explicit checkbox.
  const classUrl = field(form, 'class_url').trim();
  const examUrl = field(form, 'exam_url').trim();
  const removeExam = form.get('remove_exam') !== null;
  const db = getDb();
  const r = await setFeed(db, {
    semester,
    classUrl: classUrl === '' ? undefined : classUrl,
    examUrl: removeExam ? null : examUrl === '' ? undefined : examUrl,
    userId: user.id,
  });
  if (!r.ok) return { ok: false, message: r.error, field: r.field };
  await audit(user.id, 'plan.feed_set', semester, {
    classHost: r.classHost,
    examHost: r.examHost,
  });
  await requestPlanSync(db);
  refresh();
  return {
    ok: true,
    message: `Semester ${semester} feed saved. A timetable sync is requested.`,
  };
}

export async function clearFeedAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  const semester = parseSemester(form);
  if (semester === null) return { ok: false, message: BAD_SEMESTER };
  const removed = await clearFeed(getDb(), semester);
  if (!removed)
    return { ok: false, message: `Semester ${semester} has no feed.` };
  await audit(user.id, 'plan.feed_clear', semester, {});
  refresh();
  return { ok: true, message: `Semester ${semester} feed cleared.` };
}
