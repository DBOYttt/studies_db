/**
 * "Import from UniTime" in the #panel My groups view: the summary text and
 * the per-process rate limiter. The calendar link is a secret: it is never
 * stored, logged or echoed.
 */
import {
  createRateLimiter,
  GROUP_IMPORT_LIMIT,
  GROUP_IMPORT_WINDOW_MS,
  type GroupImportPreview,
  groupImportNotice,
  plural,
} from '@studies/db';
import { escapeUserText } from '../markdown.js';
import { MAX_TEXT } from './limits.js';
import { clip } from './views/parts.js';

/** Imports per Discord user (key `discord:<userId>`): 6 per 10 minutes. */
export const groupImportLimiter = createRateLimiter(
  GROUP_IMPORT_LIMIT,
  GROUP_IMPORT_WINDOW_MS,
);

/** Matched groups listed by name; the rest are counted. */
const SHOWN = 15;

/** Ambiguous classes named in the summary; the rest are "…". */
const AMBIGUOUS_SHOWN = 3;
/** Characters per name in the summary. */
const NAME_MAX = 100;

const name = (s: string) => escapeUserText(clip(s, NAME_MAX));

/**
 * The import result. `result.set` is what was saved; `result.changed` holds
 * the class ids the import changed, so the other matched classes were
 * already saved.
 */
export function groupImportSummary(
  preview: GroupImportPreview,
  result: { set: number; changed: ReadonlySet<number> },
): string {
  const { matched, ambiguous, unmatched } = preview;
  const empty = groupImportNotice(preview);
  if (empty !== null) return empty;
  const already = matched.filter((m) => !result.changed.has(m.classId)).length;
  const lines = [
    `Saved ${plural(result.set, 'group', 'groups')}${already > 0 ? ` (${already} already saved)` : ''}.`,
  ];
  for (const m of matched.slice(0, SHOWN)) {
    const tag = result.changed.has(m.classId) ? '' : ' (already saved)';
    lines.push(
      `• ${name(m.subjectName)} · ${name(m.className)}: ${name(m.groupName)}${tag}`,
    );
  }
  if (matched.length > SHOWN) lines.push(`…and ${matched.length - SHOWN} more`);
  if (ambiguous.length > 0) {
    const names = ambiguous
      .slice(0, AMBIGUOUS_SHOWN)
      .map((a) => `${name(a.subjectName)} · ${name(a.className)}`);
    if (ambiguous.length > AMBIGUOUS_SHOWN) names.push('…');
    lines.push(
      `Several groups for ${names.join(', ')}; pick one in My groups.`,
    );
  }
  if (unmatched.length > 0) {
    lines.push(`${plural(unmatched.length, 'entry', 'entries')} not matched.`);
  }
  return clip(lines.join('\n'), MAX_TEXT);
}
