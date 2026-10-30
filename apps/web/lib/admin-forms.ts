import {
  ADMIN_REQUEST_KINDS,
  type AdminRequestKind,
  ECTS_MAX,
  ECTS_MIN,
  emailOrNull,
  FIELD_MAX,
  GROUP_MAX,
  GROUP_MIN,
  SEMESTERS,
  type SubjectInput,
  textOrNull,
  urlOrNull,
} from '@studies/db';
import {
  ASSESSMENTS,
  type Assessment,
  CLASS_KINDS,
  type ClassKind,
} from '@studies/db/constants';
import { CONFLICT_MESSAGE, origName } from './admin-form-values';

export {
  CLASS_FIELD_LABELS,
  CONFLICT_MESSAGE,
  classFormValues,
  LECTURER_FIELD_LABELS,
  lecturerFormValues,
  SUBJECT_FIELD_LABELS,
  subjectFormValues,
} from './admin-form-values';

/**
 * Pure parsers from the admin forms' `FormData` to the shared action inputs
 * (`packages/db/src/admin-actions.ts`), with the bot's rules
 * (`apps/bot/src/ui/admin.ts`). An empty field means "clear", the web
 * equivalent of the bot's `-`.
 */

/**
 * The state of every admin form (`useActionState`). `unchanged` marks an
 * edit that matched the stored row (`No changes.`): nothing was applied.
 */
export type ActionState = {
  ok: boolean;
  message: string;
  unchanged?: true;
} | null;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const fail = (message: string): { ok: false; message: string } => ({
  ok: false,
  message,
});

export const SEMESTER_TEXT = 'Semester must be 1 or 2.';
export const ECTS_TEXT = `ECTS must be a whole number from ${ECTS_MIN} to ${ECTS_MAX}.`;
export const GROUP_TEXT = `Group must be a whole number from ${GROUP_MIN} to ${GROUP_MAX}.`;
export const CODE_TEXT =
  'The code may contain only letters, digits, dots, hyphens and underscores (up to 20 characters).';
export const EMPTY_NAME = 'The name cannot be empty.';
export const INVALID_URL = 'Invalid URL.';
export const INVALID_EMAIL = 'Invalid email address.';

/** The bot's subject code rule (case-insensitive; stored upper-cased). */
export const CODE_RE = /^[A-Za-z0-9._-]{1,20}$/;
const NUM_RE = /^\d+$/;
const ID_RE = /^[1-9]\d{0,9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A text field; a missing or non-text entry reads as empty. Line breaks are
 * normalised to LF: browsers submit a textarea's newlines as CRLF, while the
 * bot, the seed and `maxLength` count them as one LF, so an untouched
 * multi-line value would otherwise read as changed and twice as long.
 */
export function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n') : '';
}

const tooLong = (label: string, max: number) =>
  `The ${label} must be at most ${max} characters.`;

function within(
  v: string,
  label: string,
  max: number,
): { ok: false; message: string } | null {
  return v.trim().length > max ? fail(tooLong(label, max)) : null;
}

/**
 * The stored values of the row being edited. A submitted field equal to its
 * stored value is not validated again, as the bot keeps an untouched prefill:
 * a value stored by another path (a slash command, the SQL console) may break
 * today's limits and must not block editing the other fields.
 */
type Stored<K extends string> = Partial<Record<K, string | null>>;

const unchangedText = (v: string, stored: string | null | undefined) =>
  stored !== undefined && textOrNull(v) === stored;

function wholeIn(v: string, min: number, max: number): number | null {
  const t = v.trim();
  if (!NUM_RE.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

export function parseId(v: string): number | null {
  const t = v.trim();
  return ID_RE.test(t) ? Number(t) : null;
}

/** Required; `-` is the bot's "clear" and is refused as a name. */
function parseName(
  form: FormData,
  max: number,
  stored?: string | null,
): Parsed<string> {
  const name = field(form, 'name').trim();
  if (stored !== undefined && name === stored) return { ok: true, value: name };
  if (!name || name === '-') return fail(EMPTY_NAME);
  if (name.length > max) return fail(tooLong('name', max));
  return { ok: true, value: name };
}

/** A URL field: '' clears (null); otherwise it must be http(s). */
function parseUrl(
  form: FormData,
  name: string,
  stored?: string | null,
): Parsed<string> {
  const v = field(form, name);
  if (stored !== undefined && v.trim() === (stored ?? ''))
    return { ok: true, value: v.trim() };
  const bad = within(v, 'URL', FIELD_MAX.platformUrl);
  if (bad) return bad;
  if (urlOrNull(v) === undefined) return fail(INVALID_URL);
  return { ok: true, value: v.trim() };
}

/** A submitted whole number equal to the stored one, even out of range. */
const sameNumber = (v: string, stored: number | undefined) =>
  stored !== undefined && v.trim() === String(stored);

/**
 * The semester and ECTS. On edit, a value equal to the stored one is accepted
 * even when today's range refuses it (one written through the SQL console),
 * so it does not block editing the other fields; the action then leaves it
 * as it is. Any other value is in range, so a changed semester is 1 or 2.
 */
function parseSemesterEcts(
  form: FormData,
  stored: { semester?: number; ects?: number } = {},
): Parsed<{ semester: number; ects: number }> {
  const sv = field(form, 'semester');
  const s = sameNumber(sv, stored.semester)
    ? (stored.semester as number)
    : wholeIn(sv, 0, 9);
  if (
    s === null ||
    (s !== stored.semester && !(SEMESTERS as readonly number[]).includes(s))
  )
    return fail(SEMESTER_TEXT);
  const ev = field(form, 'ects');
  const ects = sameNumber(ev, stored.ects)
    ? (stored.ects as number)
    : wholeIn(ev, ECTS_MIN, ECTS_MAX);
  if (ects === null) return fail(ECTS_TEXT);
  return { ok: true, value: { semester: s, ects } };
}

/** The `code` field (a subject code), upper-cased. */
export function parseCode(form: FormData): Parsed<string> {
  const code = field(form, 'code').trim();
  if (!CODE_RE.test(code)) return fail(CODE_TEXT);
  return { ok: true, value: code.toUpperCase() };
}

function parseDescription(
  form: FormData,
  stored?: string | null,
): Parsed<string | null> {
  const v = field(form, 'description');
  if (!unchangedText(v, stored)) {
    const bad = within(v, 'description', FIELD_MAX.description);
    if (bad) return bad;
  }
  return { ok: true, value: textOrNull(v) };
}

export function parseSubjectAdd(form: FormData): Parsed<SubjectInput> {
  const name = parseName(form, FIELD_MAX.subjectName);
  if (!name.ok) return name;
  const code = parseCode(form);
  if (!code.ok) return code;
  const se = parseSemesterEcts(form);
  if (!se.ok) return se;
  const description = parseDescription(form);
  if (!description.ok) return description;
  return {
    ok: true,
    value: {
      channelId: null,
      name: name.value,
      code: code.value,
      // No stored value on add: the semester passed the range check.
      semester: se.value.semester as 1 | 2,
      ects: se.value.ects,
      ...(description.value === null ? {} : { description: description.value }),
    },
  };
}

export type SubjectEdit = {
  code: string;
  name: string;
  /** 1 or 2, unless it is the stored value (see `parseSemesterEcts`). */
  semester: number;
  ects: number;
  description: string | null;
  /** '' clears it. */
  platformUrl: string;
};

export function parseSubjectEdit(
  form: FormData,
  stored: Stored<'name' | 'description' | 'platformUrl'> & {
    semester?: number;
    ects?: number;
  } = {},
): Parsed<SubjectEdit> {
  const code = parseCode(form);
  if (!code.ok) return code;
  const name = parseName(form, FIELD_MAX.subjectName, stored.name);
  if (!name.ok) return name;
  const se = parseSemesterEcts(form, stored);
  if (!se.ok) return se;
  const description = parseDescription(form, stored.description);
  if (!description.ok) return description;
  const url = parseUrl(form, 'platformUrl', stored.platformUrl);
  if (!url.ok) return url;
  return {
    ok: true,
    value: {
      code: code.value,
      name: name.value,
      ...se.value,
      description: description.value,
      platformUrl: url.value,
    },
  };
}

export type ClassEdit = {
  code: string;
  kind: ClassKind;
  /** `brak` clears it. */
  assessment: Assessment | 'brak';
  /** '' clears these. */
  note: string;
  platformUrl: string;
};

export function parseKind(v: string): ClassKind | null {
  return (CLASS_KINDS as readonly string[]).includes(v)
    ? (v as ClassKind)
    : null;
}

export function parseClassEdit(
  form: FormData,
  stored: Stored<'note' | 'platformUrl'> = {},
): Parsed<ClassEdit> {
  const code = parseCode(form);
  if (!code.ok) return code;
  const kind = parseKind(field(form, 'kind'));
  if (!kind) return fail('Unknown class type.');
  const a = field(form, 'assessment').trim();
  if (
    a !== '' &&
    a !== 'brak' &&
    !(ASSESSMENTS as readonly string[]).includes(a)
  )
    return fail('Unknown assessment.');
  const note = field(form, 'note');
  if (!unchangedText(note, stored.note)) {
    const bad = within(note, 'note', FIELD_MAX.classNote);
    if (bad) return bad;
  }
  const url = parseUrl(form, 'platformUrl', stored.platformUrl);
  if (!url.ok) return url;
  return {
    ok: true,
    value: {
      code: code.value,
      kind,
      assessment: a === '' ? 'brak' : (a as Assessment | 'brak'),
      note: note.trim(),
      platformUrl: url.value,
    },
  };
}

export type LecturerInput = {
  name: string;
  title: string;
  email: string;
  officeHours: string;
  room: string;
};

const LECTURER_FIELDS = [
  ['title', 'title', FIELD_MAX.lecturerTitle],
  ['email', 'email', FIELD_MAX.email],
  ['officeHours', 'office hours', FIELD_MAX.officeHours],
  ['room', 'room', FIELD_MAX.room],
] as const;

/** Every field trimmed; '' clears it. */
export function parseLecturer(
  form: FormData,
  stored: Stored<keyof LecturerInput> = {},
): Parsed<LecturerInput> {
  const name = parseName(form, FIELD_MAX.lecturerName, stored.name);
  if (!name.ok) return name;
  const out: LecturerInput = {
    name: name.value,
    title: '',
    email: '',
    officeHours: '',
    room: '',
  };
  for (const [key, label, max] of LECTURER_FIELDS) {
    const v = field(form, key);
    out[key] = v.trim();
    const same =
      key === 'email'
        ? stored.email !== undefined && emailOrNull(v) === stored.email
        : unchangedText(v, stored[key]);
    if (same) continue;
    const bad = within(v, label, max);
    if (bad) return bad;
    if (key === 'email') {
      const email = emailOrNull(v);
      if (email !== null && !EMAIL_RE.test(email)) return fail(INVALID_EMAIL);
    }
  }
  return { ok: true, value: out };
}

export type AssignInput = {
  code: string;
  lecturerId: number;
  kind: ClassKind;
  group?: number;
};

export function parseAssign(form: FormData): Parsed<AssignInput> {
  const code = parseCode(form);
  if (!code.ok) return code;
  const lecturerId = parseId(field(form, 'lecturerId'));
  if (lecturerId === null) return fail('Choose a lecturer.');
  const kind = parseKind(field(form, 'kind'));
  if (!kind) return fail('Unknown class type.');
  const g = field(form, 'group').trim();
  if (g === '')
    return { ok: true, value: { code: code.value, lecturerId, kind } };
  const group = wholeIn(g, GROUP_MIN, GROUP_MAX);
  if (group === null) return fail(GROUP_TEXT);
  return { ok: true, value: { code: code.value, lecturerId, kind, group } };
}

export function parseBan(
  form: FormData,
): Parsed<{ discordUserId: string; banned: boolean }> {
  const discordUserId = field(form, 'discordUserId').trim();
  if (!discordUserId || discordUserId.length > 64)
    return fail('User not found.');
  const b = field(form, 'banned');
  if (b !== '1' && b !== '0') return fail('Invalid request.');
  return { ok: true, value: { discordUserId, banned: b === '1' } };
}

export function parseRequestKind(form: FormData): Parsed<AdminRequestKind> {
  const k = field(form, 'kind');
  return (ADMIN_REQUEST_KINDS as readonly string[]).includes(k)
    ? { ok: true, value: k as AdminRequestKind }
    : fail('Unknown request.');
}

const lf = (v: string) => v.replace(/\r\n?/g, '\n');

/** Two URL field values that mean the same link (as `urlChanged` reads them). */
export function sameUrl(a: string, b: string): boolean {
  if (a === b) return true;
  const n = urlOrNull(a);
  return n !== undefined && n === urlOrNull(b);
}

export type ResolvedEdit<K extends string> =
  | {
      ok: true;
      /** The form to parse: untouched fields carry the stored value. */
      form: FormData;
      /** The fields the admin changed; only these may go into the patch. */
      touched: ReadonlySet<K>;
    }
  | { ok: false; message: string };

/**
 * Compares an edit form with the values it was rendered from (the hidden
 * `orig_<field>` inputs) and with the stored row now (`current`, the
 * `*FormValues` strings), so an edit never reverts a concurrent change:
 * - a field without its `orig_` input (a direct POST) counts as touched and
 *   is diffed against the stored row, as before;
 * - an untouched field (submitted equals orig) is replaced by the stored
 *   value, so it is neither validated nor patched;
 * - a touched field whose stored value no longer equals orig was changed by
 *   someone else meanwhile: the edit is refused, naming the fields.
 * URL fields compare by `sameUrl`; text compares after LF normalisation.
 */
export function resolveEdit<K extends string>(
  form: FormData,
  current: Record<K, string>,
  labels: Record<K, string>,
  urlFields: readonly string[] = ['platformUrl'],
): ResolvedEdit<K> {
  const out = new FormData();
  for (const [k, v] of form.entries()) out.append(k, v);
  const touched = new Set<K>();
  const conflicts: string[] = [];
  for (const f of Object.keys(labels) as K[]) {
    if (!form.has(origName(f))) {
      touched.add(f);
      continue;
    }
    const same = urlFields.includes(f)
      ? sameUrl
      : (a: string, b: string) => a === b;
    const orig = field(form, origName(f));
    const now = lf(current[f]);
    if (same(field(form, f), orig)) out.set(f, now);
    else if (!same(now, orig)) conflicts.push(labels[f]);
    else touched.add(f);
  }
  if (conflicts.length > 0) return fail(CONFLICT_MESSAGE(conflicts));
  return { ok: true, form: out, touched };
}
