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

/**
 * Pure parsers from the admin forms' `FormData` to the shared action inputs
 * (`packages/db/src/admin-actions.ts`), with the bot's rules
 * (`apps/bot/src/ui/admin.ts`). An empty field means "clear", the web
 * equivalent of the bot's `-`.
 */

/** The state of every admin form (`useActionState`). */
export type ActionState = { ok: boolean; message: string } | null;

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

const CODE_RE = /^[A-Za-z0-9._-]{1,20}$/;
const NUM_RE = /^\d+$/;
const ID_RE = /^[1-9]\d{0,9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A text field; a missing or non-text entry reads as empty. */
export function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
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

function parseName(form: FormData, max: number): Parsed<string> {
  const name = field(form, 'name').trim();
  if (!name) return fail(EMPTY_NAME);
  if (name.length > max) return fail(tooLong('name', max));
  return { ok: true, value: name };
}

/** A URL field: '' clears (null); otherwise it must be http(s). */
function parseUrl(form: FormData, name: string): Parsed<string> {
  const v = field(form, name);
  const bad = within(v, 'URL', FIELD_MAX.platformUrl);
  if (bad) return bad;
  if (urlOrNull(v) === undefined) return fail(INVALID_URL);
  return { ok: true, value: v.trim() };
}

function parseSemesterEcts(
  form: FormData,
): Parsed<{ semester: 1 | 2; ects: number }> {
  const s = wholeIn(field(form, 'semester'), 0, 9);
  if (s === null || !(SEMESTERS as readonly number[]).includes(s))
    return fail(SEMESTER_TEXT);
  const ects = wholeIn(field(form, 'ects'), ECTS_MIN, ECTS_MAX);
  if (ects === null) return fail(ECTS_TEXT);
  return { ok: true, value: { semester: s as 1 | 2, ects } };
}

function parseCode(form: FormData): Parsed<string> {
  const code = field(form, 'code').trim();
  if (!CODE_RE.test(code)) return fail(CODE_TEXT);
  return { ok: true, value: code.toUpperCase() };
}

function parseDescription(form: FormData): Parsed<string | null> {
  const v = field(form, 'description');
  const bad = within(v, 'description', FIELD_MAX.description);
  if (bad) return bad;
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
      ...se.value,
      ...(description.value === null ? {} : { description: description.value }),
    },
  };
}

export type SubjectEdit = {
  code: string;
  name: string;
  semester: 1 | 2;
  ects: number;
  description: string | null;
  /** '' clears it. */
  platformUrl: string;
};

export function parseSubjectEdit(form: FormData): Parsed<SubjectEdit> {
  const code = parseCode(form);
  if (!code.ok) return code;
  const name = parseName(form, FIELD_MAX.subjectName);
  if (!name.ok) return name;
  const se = parseSemesterEcts(form);
  if (!se.ok) return se;
  const description = parseDescription(form);
  if (!description.ok) return description;
  const url = parseUrl(form, 'platformUrl');
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

export function parseClassEdit(form: FormData): Parsed<ClassEdit> {
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
  const bad = within(note, 'note', FIELD_MAX.classNote);
  if (bad) return bad;
  const url = parseUrl(form, 'platformUrl');
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
export function parseLecturer(form: FormData): Parsed<LecturerInput> {
  const name = parseName(form, FIELD_MAX.lecturerName);
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
    const bad = within(v, label, max);
    if (bad) return bad;
    out[key] = v.trim();
  }
  const email = emailOrNull(out.email);
  if (email !== null && !EMAIL_RE.test(email)) return fail(INVALID_EMAIL);
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
