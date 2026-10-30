'use server';

import {
  clearMyGroups,
  importMyGroups,
  type MyGroups,
  saveMyGroups,
  setMyGroup,
  setReminderPrefs,
} from '@studies/db';
import { getDb } from './db';
import { requireUser } from './session';

const MAX_IMPORT = 50;
/** More classes than any timetable has; bounds one Save's work. */
const MAX_SAVE = 500;

const isId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/**
 * Server Actions for "Moje grupy". They are reachable by direct POST, so each
 * one authenticates and validates its arguments itself.
 */

/** Pick (or with `null` drop) the user's group in one class. */
export async function saveMyGroupAction(
  classId: number,
  groupId: number | null,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!isId(classId) || (groupId !== null && !isId(groupId))) {
    return { ok: false };
  }
  return setMyGroup(getDb(), user.id, classId, groupId);
}

/**
 * Save: writes the classes the form changed (`null` = "All groups"), so
 * they stay as shown even if another tab changed them meanwhile.
 * Keys must be canonical class ids; anything malformed writes nothing.
 */
export async function saveMyGroupsAction(
  choice: Record<string, number | null>,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (typeof choice !== 'object' || choice === null || Array.isArray(choice)) {
    return { ok: false };
  }
  const entries = Object.entries(choice);
  if (entries.length > MAX_SAVE) return { ok: false };
  const clean: Record<string, number | null> = {};
  for (const [k, v] of entries) {
    if (!/^[1-9]\d{0,9}$/.test(k) || (v !== null && !isId(v))) {
      return { ok: false };
    }
    clean[k] = v;
  }
  return saveMyGroups(getDb(), user.id, clean);
}

export async function clearMyGroupsAction(): Promise<void> {
  const user = await requireUser();
  await clearMyGroups(getDb(), user.id);
}

/** One-time import of the old browser-only choice; true if anything was stored. */
export async function importMyGroupsAction(groups: MyGroups): Promise<boolean> {
  const user = await requireUser();
  if (typeof groups !== 'object' || groups === null) return false;
  const clean: MyGroups = {};
  for (const [k, v] of Object.entries(groups).slice(0, MAX_IMPORT)) {
    if (/^[1-9]\d*$/.test(k) && isId(v)) clean[k] = v;
  }
  return importMyGroups(getDb(), user.id, clean);
}

/**
 * Saves the Reminders checkboxes (24 h / 1 h before). Banned users have
 * no session, so `requireUser` already turns them away.
 */
export async function saveRemindersAction(
  dayBefore: boolean,
  hourBefore: boolean,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (typeof dayBefore !== 'boolean' || typeof hourBefore !== 'boolean') {
    return { ok: false };
  }
  await setReminderPrefs(getDb(), user.id, { dayBefore, hourBefore }, 'web');
  return { ok: true };
}
