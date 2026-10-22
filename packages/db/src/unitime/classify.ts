import type { ClassKind, SessionKind } from '../constants.js';
import { stripMarks } from '../search.js';
import type { IcsEvent } from './ics.js';

export interface ParsedLecturer {
  title: string | null;
  name: string;
  email: string | null;
}

export interface ClassifiedEvent {
  /** UniTime summary the subject is matched by (an exam prefix in it removed). */
  unitimeName: string;
  subjectName: string;
  yearOfStudy: number | null;
  /** 'exam' for exam entries; their class `kind` is always null. */
  sessionKind: SessionKind;
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

// Exam entries, matched like PREFIXES (longest first, not followed by a letter).
const EXAM_PREFIXES = [
  'kolokwium zaliczeniowe',
  'zaliczenie',
  'egzamin',
  'exam',
  'egz.',
].sort((a, b) => b.length - a.length);

function startsWithPrefix(folded: string, prefix: string): string | null {
  if (!folded.startsWith(prefix)) return null;
  const after = folded.slice(prefix.length);
  return /^\p{L}/u.test(after) ? null : after;
}

/** Length of the exam prefix `text` (trimmed) starts with, or null. */
function examPrefixLength(text: string): number | null {
  const folded = stripMarks(text.trim().toLowerCase());
  const p = EXAM_PREFIXES.find((x) => startsWithPrefix(folded, x) !== null);
  return p === undefined ? null : p.length;
}

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
    const after = startsWithPrefix(folded, prefix);
    if (after === null) continue;
    const m = /^\s*(\d+)/.exec(after);
    return { kind, groupNumber: m ? Number(m[1]) : null, groupName: null };
  }
  return { kind: null, groupNumber: null, groupName: null };
}

export function classifyEvent(ev: IcsEvent): ClassifiedEvent {
  const lines = ev.description.split('\n');
  const first = (lines[0] ?? '').trim();
  const line = classifyLine(first);
  const examFromLine = examPrefixLength(first) !== null;
  // The summary counts only when the line names no class type, so a class of
  // a subject called "Egzamin…" stays a class.
  const summaryPrefix =
    !examFromLine && line.kind === null ? examPrefixLength(ev.summary) : null;
  const exam = examFromLine || summaryPrefix !== null;
  // "Egzamin: Algebra liniowa (1rok)" files under "Algebra liniowa (1rok)".
  const unitimeName =
    summaryPrefix === null
      ? ev.summary
      : ev.summary
          .trim()
          .slice(summaryPrefix)
          .replace(/^[\s:\-\u2013\u2014]+/, '') || ev.summary;
  const ym = /\s*\((\d+)\s*rok\)\s*$/i.exec(unitimeName);
  const subjectName = (ym ? unitimeName.slice(0, ym.index) : unitimeName)
    .replace(/\s+/g, ' ')
    .trim();
  const c = exam ? { kind: null, groupNumber: null, groupName: null } : line;
  let lecturer: ParsedLecturer | null = null;
  if (ev.organizer?.cn) {
    lecturer = parseLecturerCn(ev.organizer.cn, ev.organizer.email);
  } else {
    const second = (lines[1] ?? '').trim();
    if (second) lecturer = parseLecturerCn(second, null);
  }
  return {
    unitimeName,
    subjectName,
    yearOfStudy: ym ? Number(ym[1]) : null,
    sessionKind: exam ? 'exam' : 'class',
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
