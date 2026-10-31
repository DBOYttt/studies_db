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
  let r: Awaited<ReturnType<typeof setFeed>>;
  try {
    r = await setFeed(db, {
      semester,
      classUrl: classUrl === '' ? undefined : classUrl,
      examUrl: removeExam ? null : examUrl === '' ? undefined : examUrl,
      userId: user.id,
    });
  } catch (err) {
    // A driver error carries the query parameters, i.e. the link: log the
    // error code only.
    console.error('feed save failed', semester, errorCode(err));
    return { ok: false, message: 'Could not save the feed. Try again.' };
  }
  if (!r.ok) return { ok: false, message: r.error, field: r.field };
  await audit(user.id, 'plan.feed_set', semester, {
    classHost: r.classHost,
    examHost: r.examHost,
  });
  const syncOk = await requestSync('save');
  refresh();
  if (!syncOk)
    return {
      ok: true,
      message: 'Feed saved. The sync request failed; use Sync timetable.',
    };
  return {
    ok: true,
    message: `Semester ${semester} feed saved. A timetable sync is requested.`,
  };
}

function errorCode(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === 'string' ? code : 'unknown';
}

/** Requests a sync; false when that fails (the change itself stands). */
async function requestSync(after: 'save' | 'clear'): Promise<boolean> {
  try {
    await requestPlanSync(getDb());
    return true;
  } catch (err) {
    console.error(`plan sync request failed after feed ${after}`, err);
    return false;
  }
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
  const syncOk = await requestSync('clear');
  refresh();
  if (!syncOk)
    return {
      ok: true,
      message: 'Feed cleared. The sync request failed; use Sync timetable.',
    };
  return {
    ok: true,
    message: `Semester ${semester} feed cleared. A timetable sync is requested.`,
  };
}
