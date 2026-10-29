'use server';

import {
  applyGroupImport,
  fetchImportCalendar,
  GROUP_IMPORT_MAX_PAIRS,
  type GroupImportPreview,
  importAllowedHosts,
  NO_CLASSES_MESSAGE,
  NOT_A_CALENDAR_MESSAGE,
  NotACalendarError,
  normalizeImportUrl,
  planGroupImport,
  previewHasNothing,
  SafeSyncError,
} from '@studies/db';
import { revalidatePath } from 'next/cache';
import { getDb } from './db';
import {
  groupImportLimiter,
  IMPORT_FAILED,
  NOTHING_TO_IMPORT,
  readIcsFile,
  TOO_MANY_IMPORTS,
} from './group-import';
import { requireUser } from './session';

type Fail = { ok: false; error: string };

const isId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/**
 * Server Actions for "Import from UniTime". They are reachable by direct
 * POST, so each one authenticates and validates its input itself. The
 * calendar link is a secret: it is never returned, stored or logged.
 */

/** Reads a calendar (an uploaded file wins over a link) and plans the import. */
export async function previewGroupImportAction(
  form: FormData,
): Promise<
  { ok: true; preview: GroupImportPreview; notice: string | null } | Fail
> {
  const user = await requireUser();
  if (!(form instanceof FormData))
    return { ok: false, error: NOTHING_TO_IMPORT };
  const file = form.get('file');
  const rawUrl = form.get('url');
  let source: { text: string } | { url: string };
  if (file instanceof File && file.size > 0) {
    const text = await readIcsFile(file);
    if (typeof text !== 'string') return { ok: false, error: text.error };
    source = { text };
  } else if (typeof rawUrl === 'string' && rawUrl.trim() !== '') {
    const guard = normalizeImportUrl(rawUrl, importAllowedHosts());
    if (!guard.ok) return { ok: false, error: guard.error };
    source = { url: guard.url };
  } else {
    return { ok: false, error: NOTHING_TO_IMPORT };
  }
  if (!groupImportLimiter.check(String(user.id)))
    return { ok: false, error: TOO_MANY_IMPORTS };
  try {
    const text =
      'text' in source ? source.text : await fetchImportCalendar(source.url);
    const preview = await planGroupImport(getDb(), user.id, text);
    const empty =
      previewHasNothing(preview) ||
      (preview.matched.length === 0 && preview.ambiguous.length === 0);
    return { ok: true, preview, notice: empty ? NO_CLASSES_MESSAGE : null };
  } catch (err) {
    if (err instanceof NotACalendarError)
      return { ok: false, error: NOT_A_CALENDAR_MESSAGE };
    if (err instanceof SafeSyncError) return { ok: false, error: err.message };
    // Not logged: the error may embed the link.
    return { ok: false, error: IMPORT_FAILED };
  }
}

/** Saves the chosen `{ classId, groupId }` pairs (merged into My groups). */
export async function applyGroupImportAction(
  pairs: unknown,
): Promise<{ ok: true; set: number } | Fail> {
  const user = await requireUser();
  const valid =
    Array.isArray(pairs) &&
    pairs.length <= GROUP_IMPORT_MAX_PAIRS &&
    pairs.every(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        isId((p as { classId?: unknown }).classId) &&
        isId((p as { groupId?: unknown }).groupId),
    );
  if (!valid) return { ok: false, error: 'Invalid selection.' };
  const clean = (pairs as { classId: number; groupId: number }[]).map((p) => ({
    classId: p.classId,
    groupId: p.groupId,
  }));
  const { set } = await applyGroupImport(getDb(), user.id, clean);
  revalidatePath('/plan');
  revalidatePath('/s/plan');
  return { ok: true, set };
}
