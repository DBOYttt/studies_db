'use server';

import {
  applyGroupImport,
  fetchImportCalendar,
  GROUP_IMPORT_MAX_PAIRS,
  GROUP_IMPORT_SAVE_FAILED,
  type GroupImportPreview,
  groupImportNotice,
  importAllowedHosts,
  importErrorMessage,
  logGroupImportError,
  normalizeImportUrl,
  planGroupImport,
} from '@studies/db';
import { revalidatePath } from 'next/cache';
import { getDb } from './db';
import {
  groupImportLimiter,
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
    return { ok: true, preview, notice: groupImportNotice(preview) };
  } catch (err) {
    // Only name/code/errno of an unexpected error: the message may embed
    // the link.
    logGroupImportError(err);
    return { ok: false, error: importErrorMessage(err) };
  }
}

/**
 * Saves the chosen `{ classId, groupId }` pairs (merged into My groups);
 * only the first `GROUP_IMPORT_MAX_PAIRS` are kept, like the bot.
 */
export async function applyGroupImportAction(
  pairs: unknown,
): Promise<{ ok: true; set: number } | Fail> {
  const user = await requireUser();
  if (!Array.isArray(pairs)) return { ok: false, error: 'Invalid selection.' };
  const head: unknown[] = pairs.slice(0, GROUP_IMPORT_MAX_PAIRS);
  const valid = head.every(
    (p) =>
      typeof p === 'object' &&
      p !== null &&
      isId((p as { classId?: unknown }).classId) &&
      isId((p as { groupId?: unknown }).groupId),
  );
  if (!valid) return { ok: false, error: 'Invalid selection.' };
  const clean = (head as { classId: number; groupId: number }[]).map((p) => ({
    classId: p.classId,
    groupId: p.groupId,
  }));
  let set: number;
  try {
    ({ set } = await applyGroupImport(getDb(), user.id, clean));
  } catch (err) {
    logGroupImportError(err);
    return { ok: false, error: GROUP_IMPORT_SAVE_FAILED };
  }
  revalidatePath('/plan');
  revalidatePath('/s/plan');
  return { ok: true, set };
}
