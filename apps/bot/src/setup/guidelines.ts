// Forum guidelines text generated from the DB; /setup rewrites it on each run.
import { ASSESSMENT_NAMES, groupName } from '@studies/db';
import type { ClassSpec, LecturerSpec, SubjectSpec } from './types.js';

export const MAX_GUIDELINES = 4096;
const TAGGING_HINT =
  'Tag posts with the class and group, e.g. Laboratorium + Gr. 1.';

const lecturer = (l: LecturerSpec) =>
  [l.title, l.name].filter(Boolean).join(' ') +
  (l.group === null ? '' : ` (${groupName(l.group)})`);

function classBlock(c: ClassSpec): string[] {
  const assessment = c.assessment
    ? ` — ${ASSESSMENT_NAMES[c.assessment]}${c.assessmentNote ? ` (${c.assessmentNote})` : ''}`
    : '';
  const lines = [`${c.name}${assessment}`];
  if (c.lecturers.length > 0) {
    lines.push(`Lecturers: ${c.lecturers.map(lecturer).join(', ')}`);
  }
  if (c.platformUrl) lines.push(c.platformUrl);
  return lines;
}

export function renderGuidelines(s: SubjectSpec): string {
  const head = [`${s.name} — Semester ${s.semester}, ${s.ects} ECTS`];
  if (s.platformUrl) head.push(`Platform: ${s.platformUrl}`);
  const blocks = [head, ...s.classes.map(classBlock)].map((b) => b.join('\n'));
  const body = blocks.join('\n\n');
  // The hint stays last even when the body has to be cut.
  const room = MAX_GUIDELINES - TAGGING_HINT.length - 2;
  const cut = body.length > room ? `${body.slice(0, room - 1)}…` : body;
  return `${cut}\n\n${TAGGING_HINT}`;
}
