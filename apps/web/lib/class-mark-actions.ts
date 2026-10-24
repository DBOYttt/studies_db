'use server';

import {
  addMark,
  editMark,
  MARK_NOT_FOUND,
  type MarkResult,
  removeMark,
  restoreMark,
  skipDate,
  unskipDate,
} from '@studies/db';
import { revalidatePath } from 'next/cache';
import { getDb } from './db';
import { requireAdmin, requireUser } from './session';

/**
 * Server Actions for entry quizzes (`class_marks`): the timetable popover
 * ("Not this week") and the class section of the subject pages. They are
 * reachable by direct POST, so each authenticates itself and checks its
 * arguments; the ban check, rules and audit rows live in `@studies/db`
 * (`class-marks.ts`). Restore is admin only (404 for everyone else).
 */

const isId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const isVersion = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const noteOf = (v: unknown): string | null | 'bad' =>
  v === null || v === undefined ? null : typeof v === 'string' ? v : 'bad';

const fail = (message: string): MarkResult => ({ ok: false, message });

/** The timetables and subject pages that show marks. */
function refresh() {
  revalidatePath('/plan');
  revalidatePath('/s/plan');
  revalidatePath('/subjects/[code]', 'page');
  revalidatePath('/s/subjects/[code]', 'page');
  revalidatePath('/lecturers/[id]', 'page');
}

const after = (r: MarkResult): MarkResult => {
  if (r.ok) refresh();
  return r;
};

/** "Turn on": an entry quiz every session of the class (or one group). */
export async function addMarkAction(
  classId: number,
  groupId: number | null,
  note: string | null,
): Promise<MarkResult> {
  const user = await requireUser();
  if (!isId(classId)) return fail('Class not found.');
  if (groupId !== null && !isId(groupId)) {
    return fail('This group is not part of the class.');
  }
  const n = noteOf(note);
  if (n === 'bad') return fail('Invalid note.');
  return after(
    await addMark(
      getDb(),
      user.id,
      { classId, groupId, kind: 'wejsciowka', note: n },
      'web',
    ),
  );
}

/** Saves the note; refused when the mark changed since the form loaded. */
export async function editMarkAction(
  markId: number,
  note: string | null,
  expectedVersion: number,
): Promise<MarkResult> {
  const user = await requireUser();
  if (!isId(markId)) return fail(MARK_NOT_FOUND);
  const n = noteOf(note);
  if (n === 'bad') return fail('Invalid note.');
  if (!isVersion(expectedVersion)) return fail(MARK_NOT_FOUND);
  return after(
    await editMark(
      getDb(),
      user.id,
      markId,
      { note: n },
      { expectedVersion },
      'web',
    ),
  );
}

/** "Turn off" (soft delete). */
export async function removeMarkAction(
  markId: number,
  expectedVersion?: number,
): Promise<MarkResult> {
  const user = await requireUser();
  if (!isId(markId)) return fail(MARK_NOT_FOUND);
  return after(
    await removeMark(
      getDb(),
      user.id,
      markId,
      {
        expectedVersion: isVersion(expectedVersion)
          ? expectedVersion
          : undefined,
      },
      'web',
    ),
  );
}

/** Admin only. */
export async function restoreMarkAction(markId: number): Promise<MarkResult> {
  const admin = await requireAdmin();
  if (!isId(markId)) return fail(MARK_NOT_FOUND);
  return after(await restoreMark(getDb(), admin.id, markId, 'web'));
}

/** "Not this week": no entry quiz on `onDate` (`YYYY-MM-DD`). */
export async function skipMarkAction(
  markId: number,
  onDate: string,
): Promise<MarkResult> {
  const user = await requireUser();
  if (!isId(markId)) return fail(MARK_NOT_FOUND);
  if (!isDate(onDate)) {
    return fail('There is no session of this class on that date.');
  }
  return after(await skipDate(getDb(), user.id, markId, onDate, 'web'));
}

/** "Undo" of a skipped date. */
export async function unskipMarkAction(
  markId: number,
  onDate: string,
): Promise<MarkResult> {
  const user = await requireUser();
  if (!isId(markId)) return fail(MARK_NOT_FOUND);
  if (!isDate(onDate)) return fail('This week is not skipped.');
  return after(await unskipDate(getDb(), user.id, markId, onDate, 'web'));
}
