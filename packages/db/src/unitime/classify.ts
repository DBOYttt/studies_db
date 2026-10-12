import type { ClassKind } from '../constants.js';
import { stripMarks } from '../search.js';
import type { IcsEvent } from './ics.js';

export interface ParsedLecturer {
  title: string | null;
  name: string;
  email: string | null;
}

export interface ClassifiedEvent {
  subjectName: string;
  yearOfStudy: number | null;
  kind: ClassKind | null;
  groupNumber: number | null;
  groupName: string | null;
  label: string;
  lecturer: ParsedLecturer | null;
  room: string | null;
}

// Longest prefix first; matched against stripMarks(lowercase) text.
const PREFIXES: [string, ClassKind][] = [
  ['cwiczenia laboratoryjne', 'laboratorium'],
  ['cwiczenia audytoryjne', 'cwiczenia'],
  ['cwiczenia projektowe', 'projekt'],
  ['zajecia seminaryjne', 'seminarium'],
  ['zajecia praktyczne', 'praktyczne'],
  ['laboratorium', 'laboratorium'],
  ['seminarium', 'seminarium'],
  ['wyklad', 'wyklad'],
  ['projekt', 'projekt'],
  ['cwa', 'cwiczenia'],
  ['cwl', 'laboratorium'],
].sort((a, b) => b[0].length - a[0].length) as [string, ClassKind][];

const TITLE_TOKENS = new Set(['prof.', 'dr', 'hab.', 'inż.', 'mgr', 'lic.']);

export function parseLecturerCn(
  cn: string,
  email: string | null,
): ParsedLecturer {
  const tokens = cn.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && TITLE_TOKENS.has((tokens[i] ?? '').toLowerCase()))
    i++;
  const title = i > 0 ? tokens.slice(0, i).join(' ') : null;
  const rest = tokens.slice(i).join(' ');
  const comma = rest.indexOf(',');
  let name = rest;
  if (comma >= 0) {
    const surname = rest.slice(0, comma).trim();
    const given = rest
      .slice(comma + 1)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((g) => (g.length === 1 ? `${g}.` : g))
      .join(' ');
    name = given ? `${given} ${surname}` : surname;
  }
  return { title, name, email };
}

function classifyLine(line: string): {
  kind: ClassKind | null;
  groupNumber: number | null;
  groupName: string | null;
} {
  const folded = stripMarks(line.trim().toLowerCase());
  const hala = /^hala\s+(\S+?)-(\d+)(?![\d])/.exec(folded);
  if (hala) {
    const code = hala[1] ?? '';
    const seg = (code.split('_').pop() ?? '').toUpperCase();
    return {
      kind: 'wf',
      groupNumber: Number(hala[2]),
      groupName: `${seg}-${hala[2]}`,
    };
  }
  for (const [prefix, kind] of PREFIXES) {
    if (!folded.startsWith(prefix)) continue;
    const after = folded.slice(prefix.length);
    if (/^\p{L}/u.test(after)) continue;
    const m = /^\s*(\d+)/.exec(after);
    return { kind, groupNumber: m ? Number(m[1]) : null, groupName: null };
  }
  return { kind: null, groupNumber: null, groupName: null };
}

export function classifyEvent(ev: IcsEvent): ClassifiedEvent {
  const ym = /\s*\((\d+)\s*rok\)\s*$/i.exec(ev.summary);
  const subjectName = (ym ? ev.summary.slice(0, ym.index) : ev.summary)
    .replace(/\s+/g, ' ')
    .trim();
  const lines = ev.description.split('\n');
  const first = (lines[0] ?? '').trim();
  const c = classifyLine(first);
  let lecturer: ParsedLecturer | null = null;
  if (ev.organizer?.cn) {
    lecturer = parseLecturerCn(ev.organizer.cn, ev.organizer.email);
  } else {
    const second = (lines[1] ?? '').trim();
    if (second) lecturer = parseLecturerCn(second, null);
  }
  return {
    subjectName,
    yearOfStudy: ym ? Number(ym[1]) : null,
    ...c,
    label: first.slice(0, 100),
    lecturer,
    room: ev.location.trim() || null,
  };
}

export function subjectCode(name: string, taken: ReadonlySet<string>): string {
  const words = stripMarks(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let base = '';
  for (const w of words) {
    const digits = w.replace(/\D/g, '');
    if (digits) base += digits;
    else if (w.length >= 3) base += w[0];
  }
  base = base.toUpperCase().slice(0, 20) || 'PRZ';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const code = base.slice(0, 20 - suffix.length) + suffix;
    if (!taken.has(code)) return code;
  }
}

export function semesterFor(
  calendarName: string,
  yearOfStudy: number | null,
): number {
  const summer = /\bletni/.test(stripMarks(calendarName).toLowerCase());
  const year = yearOfStudy && yearOfStudy > 0 ? yearOfStudy : 1;
  return (year - 1) * 2 + (summer ? 2 : 1);
}
