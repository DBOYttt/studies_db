/** Pure, client-safe helpers of the simple view. */
import { CLASS_KINDS, type ClassKind } from '@studies/db/constants';
import { formatDate } from './format';
import { wallShortDate, wallTime } from './plan-view';

/**
 * One UTF-16 unit folded like `stripMarks(...).toLowerCase()` of @studies/db
 * (which is not importable client-side), but always 1:1 so hit offsets map
 * straight back onto the original text.
 */
function foldUnit(c: string): string {
  const f = c
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase();
  return f.length === 1 ? f : c;
}

const fold = (s: string) => Array.from(s.split(''), foldUnit).join('');

/** Case- and accent-insensitive split of `text` around all hits of `q`. Never throws. */
export function highlightParts(
  text: string,
  q: string,
): { t: string; hit: boolean }[] {
  const needle = fold(q.trim());
  if (!needle || !text) return [{ t: text, hit: false }];
  const hay = fold(text);
  const parts: { t: string; hit: boolean }[] = [];
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    if (i > from) parts.push({ t: text.slice(from, i), hit: false });
    parts.push({ t: text.slice(i, i + needle.length), hit: true });
    from = i + needle.length;
  }
  if (parts.length === 0) return [{ t: text, hit: false }];
  if (from < text.length) parts.push({ t: text.slice(from), hit: false });
  return parts;
}

export const REPORT_META: { icon: 'Books' | 'Medal' | 'Exam'; desc: string }[] =
  [
    { icon: 'Books', desc: 'How many files each subject has.' },
    { icon: 'Medal', desc: 'Who has added the most files.' },
    { icon: 'Exam', desc: 'Test and Exam events in the next 30 days.' },
  ];

export const REPORT_LABELS: Record<string, string> = {
  code: 'Code',
  name: 'Subject',
  materials: 'Files',
  display_name: 'Author',
  files: 'Files',
  id: 'No.',
  title: 'Title',
  created_at: 'Added',
  starts_at: 'When',
  type: 'Type',
  subject_code: 'Subject',
};

/** A wall DATETIME as the RO console returns it (ISO with Z, or SQL text). */
const wallValue = (v: string | Date): Date =>
  v instanceof Date
    ? v
    : new Date(/[zZ]$/.test(v) ? v : `${v.replace(' ', 'T')}Z`);

/**
 * One cell of a ready-made report. `starts_at` (events) is Warsaw wall time,
 * so it shows its own date and time (`Fri 30 Oct, 23:30`) from the UTC fields;
 * `created_at` is a real instant, shown as a Warsaw date.
 */
export function reportCellText(col: string, v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (col === 'starts_at' && (typeof v === 'string' || v instanceof Date)) {
    const d = wallValue(v);
    if (!Number.isNaN(d.getTime()))
      return `${wallShortDate(d)}, ${wallTime(d)}`;
  }
  if (col === 'created_at' && (typeof v === 'string' || v instanceof Date))
    return formatDate(v);
  return String(v);
}

export type FileIconName =
  | 'FilePdf'
  | 'FileImage'
  | 'FileDoc'
  | 'FilePpt'
  | 'FileXls'
  | 'FileText'
  | 'FileCode'
  | 'File';
export type FileIconTone = 'red' | 'green' | 'accent' | 'warn' | 'muted';

const EXT = {
  doc: ['doc', 'docx', 'odt', 'rtf'],
  ppt: ['ppt', 'pptx', 'odp'],
  xls: ['xls', 'xlsx', 'ods', 'csv'],
  text: ['txt', 'md', 'log'],
  code: [
    'py',
    'c',
    'h',
    'cpp',
    'hpp',
    'cc',
    'java',
    'js',
    'ts',
    'jsx',
    'tsx',
    'cs',
    'go',
    'rs',
    'php',
    'rb',
    'sql',
    'sh',
    'json',
    'xml',
    'html',
    'css',
    'yml',
    'yaml',
    'tex',
    'asm',
    'm',
    'r',
  ],
} as const;

/**
 * Icon by what the file really is: MIME type and filename extension (the
 * preview kind only says how it can be previewed, e.g. a .docx rendered to PDF).
 */
export function fileIcon(f: {
  mimeType?: string | null;
  filename: string;
  previewKind?: 'pdf' | 'image' | 'text' | 'none';
}): { icon: FileIconName; tone: FileIconTone } {
  const mime = (f.mimeType ?? '').toLowerCase();
  const dot = f.filename.lastIndexOf('.');
  const ext = dot >= 0 ? f.filename.slice(dot + 1).toLowerCase() : '';
  const is = (list: readonly string[]) => list.includes(ext);
  if (mime === 'application/pdf' || ext === 'pdf')
    return { icon: 'FilePdf', tone: 'red' };
  if (mime.startsWith('image/')) return { icon: 'FileImage', tone: 'green' };
  if (
    is(EXT.doc) ||
    /msword|wordprocessingml|opendocument\.text|rtf/.test(mime)
  )
    return { icon: 'FileDoc', tone: 'accent' };
  if (
    is(EXT.ppt) ||
    /powerpoint|presentationml|opendocument\.presentation/.test(mime)
  )
    return { icon: 'FilePpt', tone: 'warn' };
  if (
    is(EXT.xls) ||
    /ms-excel|spreadsheetml|opendocument\.spreadsheet|text\/csv/.test(mime)
  )
    return { icon: 'FileXls', tone: 'green' };
  if (is(EXT.code)) return { icon: 'FileCode', tone: 'accent' };
  if (is(EXT.text) || mime.startsWith('text/'))
    return { icon: 'FileText', tone: 'accent' };
  if (ext === '' && f.previewKind === 'image')
    return { icon: 'FileImage', tone: 'green' };
  return { icon: 'File', tone: 'muted' };
}

export function statusBadge(
  s: 'pending' | 'ready' | 'failed',
): { label: string; tone: 'warn' | 'err' } | null {
  if (s === 'pending') return { label: 'Processing…', tone: 'warn' };
  if (s === 'failed') return { label: 'Preview unavailable', tone: 'err' };
  return null;
}

type Sp = Record<string, string | string[] | undefined>;

function intParam(sp: Sp, key: string): number | null {
  const raw = sp[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v !== undefined && /^[1-9]\d{0,9}$/.test(v) ? Number(v) : null;
}

/** `?class=<kind>&group=<number>&tag=<id>` (`groupsByKind` holds group numbers per kind); anything unknown or foreign becomes null. */
export function parseSimpleFilters(
  sp: Sp,
  kinds: ClassKind[],
  groupsByKind: Record<string, number[]>,
  tagIds: number[],
): { kind: ClassKind | null; group: number | null; tag: number | null } {
  const rawKind = Array.isArray(sp.class) ? sp.class[0] : sp.class;
  const kind = kinds.find((k) => k === rawKind) ?? null;
  const g = intParam(sp, 'group');
  const group =
    kind && g !== null && (groupsByKind[kind] ?? []).includes(g) ? g : null;
  const t = intParam(sp, 'tag');
  return { kind, group, tag: t !== null && tagIds.includes(t) ? t : null };
}

/** `?file=<material id>` as a positive integer, else null. */
export const parseFileParam = (sp: Sp): number | null => intParam(sp, 'file');

/** `?page=<n>` clamped to 1..max (junk → 1). */
export function parsePageParam(sp: Sp, max: number): number {
  const p = intParam(sp, 'page');
  return p === null ? 1 : Math.min(p, Math.max(1, max));
}

/** `base` plus one more query param, with the right separator. */
export function withParam(base: string, key: string, value: string | number) {
  return `${base}${base.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(String(value))}`;
}

export type SubjectFilters = {
  kind: ClassKind | null;
  group: number | null;
  tag: number | null;
};

/**
 * Subject page URL with `change` applied to the current chip filters
 * (`null` = "Wszystkie", param removed). Choosing a different kind drops
 * the group, since group numbers belong to one class kind.
 */
export function chipHref(
  code: string,
  cur: SubjectFilters,
  change: Partial<SubjectFilters>,
): string {
  const next = { ...cur, ...change };
  if ('kind' in change && change.kind !== cur.kind && !('group' in change))
    next.group = null;
  const q = new URLSearchParams();
  if (next.kind) q.set('class', next.kind);
  if (next.kind && next.group !== null) q.set('group', String(next.group));
  if (next.tag !== null) q.set('tag', String(next.tag));
  const s = q.toString();
  return `/s/subjects/${encodeURIComponent(code)}${s ? `?${s}` : ''}`;
}

/** `?q=` trimmed and capped at 200 characters ('' when missing). */
export function parseSearchQuery(sp: Sp): string {
  const raw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  return (raw ?? '').trim().slice(0, 200).trim();
}

/** `Gr. 1–3, 5`: sorted, deduplicated, consecutive runs of 3+ as ranges. */
export function formatGroupNumbers(nums: number[]): string {
  const ns = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < ns.length; ) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    if (j - i >= 2) parts.push(`${ns[i]}–${ns[j]}`);
    else for (let k = i; k <= j; k++) parts.push(String(ns[k]));
    i = j + 1;
  }
  return `Gr. ${parts.join(', ')}`;
}

export type LecturerRow = {
  id: number;
  kind: ClassKind;
  className: string;
  groupNumber: number | null;
  name: string;
  title: string | null;
  email: string | null;
  officeHours: string | null;
  room: string | null;
};

export type LecturerCard = {
  id: number;
  name: string;
  email: string | null;
  officeHours: string | null;
  room: string | null;
  classes: { kind: ClassKind; label: string }[];
};

/**
 * One card per lecturer (first-appearance order) with one line per class in
 * kind order: `<class> · all groups` when any assignment covers the whole
 * class, else `<class> · Gr. 1–3, 5`.
 */
export function groupLecturers(rows: LecturerRow[]): LecturerCard[] {
  const by = new Map<
    number,
    {
      row: LecturerRow;
      classes: Map<ClassKind, { name: string; all: boolean; nums: number[] }>;
    }
  >();
  for (const r of rows) {
    let l = by.get(r.id);
    if (!l) {
      l = { row: r, classes: new Map() };
      by.set(r.id, l);
    }
    let c = l.classes.get(r.kind);
    if (!c) {
      c = { name: r.className, all: false, nums: [] };
      l.classes.set(r.kind, c);
    }
    if (r.groupNumber === null) c.all = true;
    else c.nums.push(r.groupNumber);
  }
  return [...by.values()].map(({ row: r, classes }) => ({
    id: r.id,
    name: [r.title, r.name].filter(Boolean).join(' '),
    email: r.email,
    officeHours: r.officeHours,
    room: r.room,
    classes: [...classes.entries()]
      .sort(([a], [b]) => CLASS_KINDS.indexOf(a) - CLASS_KINDS.indexOf(b))
      .map(([kind, c]) => ({
        kind,
        label: `${c.name} · ${c.all ? 'all groups' : formatGroupNumbers(c.nums)}`,
      })),
  }));
}

/** Max rows of a ready-made report (page and CSV). */
export const MAX_ROWS = 1000;

/** CSV file names of the three ready-made reports (same order as EXAMPLE_QUERIES). */
export const REPORT_SLUGS = [
  'files-per-subject',
  'most-active-uploaders',
  'tests-exams-next-30-days',
] as const;

/** `?r=0|1|2`; anything else (missing, junk, out of range) is the first report. */
export function parseReportIndex(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v !== undefined && /^[0-2]$/.test(v) ? Number(v) : 0;
}

/** The same search in Advanced mode (it also lists topic hits). */
export const advancedSearchHref = (q: string): string =>
  `/mode?to=advanced&next=${encodeURIComponent(`/search?q=${encodeURIComponent(q)}`)}`;
