/** Helpers of the admin Subjects and Lecturers pages. */
import { CODE_RE } from './admin-forms';

/**
 * The `[code]` segment of /admin/subjects/[code], trimmed and upper-cased
 * (`/admin/subjects/%20ana1` is ANA1); null for anything that cannot be a
 * subject code, which the page answers with 404.
 */
export function parseSubjectParam(raw: string): string | null {
  let v = raw;
  // A code never contains `%`, so decoding an already decoded value is safe.
  if (v.includes('%')) {
    try {
      v = decodeURIComponent(v);
    } catch {
      return null;
    }
  }
  const code = v.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** `dr Jan Kowalski`, or the bare name without a title. */
export const lecturerLabel = (l: { title: string | null; name: string }) =>
  l.title ? `${l.title} ${l.name}` : l.name;
