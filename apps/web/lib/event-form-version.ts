/** What the edit form knows about the row it was loaded from. */
export type FormVersion = { version: number | undefined; deleted: boolean };

/**
 * The version the edit form saves against after the page re-rendered with
 * `next`. Deleting and restoring each bump the row's version by exactly one,
 * so a delete or restore seen as that single step is adopted (the form's
 * values are still the row's). Anything else keeps the old version, so the
 * next Save is refused with CONFLICT: an edit hidden behind the delete, or a
 * plain refresh that swapped in someone else's newer version.
 */
export function nextFormVersion(
  cur: FormVersion,
  next: FormVersion,
): FormVersion {
  if (next.deleted === cur.deleted) return cur;
  const step = cur.version !== undefined && next.version === cur.version + 1;
  return { version: step ? next.version : cur.version, deleted: next.deleted };
}
