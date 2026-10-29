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
  NO_CLASSES_MESSAGE,
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

export function groupImportSummary(
  preview: GroupImportPreview,
  result: { set: number },
): string {
  const { matched, ambiguous, unmatched } = preview;
  if (matched.length === 0 && ambiguous.length === 0) return NO_CLASSES_MESSAGE;
  const lines = [`Saved ${plural(result.set, 'group', 'groups')}.`];
  for (const m of matched.slice(0, SHOWN)) {
    lines.push(
      `• ${escapeUserText(m.subjectName)} · ${escapeUserText(m.className)}: ${escapeUserText(m.groupName)}`,
    );
  }
  if (matched.length > SHOWN) lines.push(`…and ${matched.length - SHOWN} more`);
  if (ambiguous.length > 0) {
    lines.push(
      `Several groups for ${plural(ambiguous.length, 'class', 'classes')}; pick them below.`,
    );
  }
  if (unmatched.length > 0) {
    lines.push(`${plural(unmatched.length, 'entry', 'entries')} not matched.`);
  }
  return clip(lines.join('\n'), MAX_TEXT);
}
