import { and, asc, eq, isNull } from 'drizzle-orm';
import { setBanned } from './auth.js';
import type { Db } from './client.js';
import { type Assessment, CLASS_NAMES, type ClassKind } from './constants.js';
import { ensureClass, ensureGroup, groupName } from './hierarchy.js';
import { classes, classLecturers, lecturers, subjects } from './schema.js';

/** `id` is the new row's id for actions that insert one. */
export type ActionResult = { ok: boolean; message: string; id?: number };

const ok = (message: string, id?: number): ActionResult =>
  id === undefined ? { ok: true, message } : { ok: true, message, id };
const refused = (message: string): ActionResult => ({ ok: false, message });

export type SubjectInput = {
  channelId: string | null;
  name: string;
  code: string;
  semester: 1 | 2;
  ects: number;
  description?: string;
};

function isDuplicateEntry(err: unknown): boolean {
  for (
    let e = err as { code?: string; cause?: unknown } | undefined;
    e;
    e = e.cause as typeof e
  ) {
    if (e.code === 'ER_DUP_ENTRY') return true;
  }
  return false;
}

const URL_RE = /^https?:\/\/\S+$/;
const INVALID_URL = 'Nieprawidłowy adres URL.';
const DUP_EMAIL = 'Prowadzący z tym adresem e-mail już istnieje.';

/** `-` clears the field (NULL); anything else is stored trimmed. */
export const textOrNull = (v: string): string | null => {
  const t = v.trim();
  return t === '-' || t === '' ? null : t;
};
export const urlOrNull = (v: string): string | null | undefined => {
  const t = textOrNull(v);
  return t === null || URL_RE.test(t) ? t : undefined;
};
export const emailOrNull = (v: string): string | null => {
  const t = textOrNull(v);
  return t === null ? null : t.toLowerCase();
};

const notFound = (code: string) => `Nie znaleziono przedmiotu ${code}.`;

export async function addSubject(
  db: Db,
  i: SubjectInput,
): Promise<ActionResult> {
  const code = i.code.trim().toUpperCase();
  const [existing] = await db
    .select({
      id: subjects.id,
      channel: subjects.discordChannelId,
      description: subjects.description,
    })
    .from(subjects)
    .where(eq(subjects.code, code));
  if (existing && existing.channel === null && i.channelId !== null) {
    try {
      await db
        .update(subjects)
        .set({
          discordChannelId: i.channelId,
          ...(existing.description === null && i.description !== undefined
            ? { description: i.description }
            : {}),
        })
        .where(eq(subjects.id, existing.id));
    } catch (err) {
      if (isDuplicateEntry(err)) {
        return refused('Przedmiot z tym kodem lub kanałem już istnieje.');
      }
      throw err;
    }
    return ok(`Połączono przedmiot ${code} z kanałem.`);
  }
  let ins: { insertId: number };
  try {
    [ins] = await db.insert(subjects).values({
      name: i.name,
      code,
      semester: i.semester,
      ects: i.ects,
      description: i.description ?? null,
      discordChannelId: i.channelId,
    });
  } catch (err) {
    if (isDuplicateEntry(err)) {
      return refused('Przedmiot z tym kodem lub kanałem już istnieje.');
    }
    throw err;
  }
  return ok(`Dodano przedmiot ${code} (${i.name}).`, ins.insertId);
}

export async function editSubject(
  db: Db,
  code: string,
  patch: Partial<Omit<SubjectInput, 'channelId' | 'code' | 'description'>> & {
    /** null clears it. */
    description?: string | null;
    platformUrl?: string;
  },
): Promise<ActionResult> {
  const upper = code.trim().toUpperCase();
  const set: Partial<typeof subjects.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.semester !== undefined) set.semester = patch.semester;
  if (patch.ects !== undefined) set.ects = patch.ects;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.platformUrl !== undefined) {
    const url = urlOrNull(patch.platformUrl);
    if (url === undefined) return refused(INVALID_URL);
    set.platformUrl = url;
  }
  const [row] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.code, upper));
  if (!row) return refused(notFound(upper));
  if (Object.keys(set).length > 0) {
    await db.update(subjects).set(set).where(eq(subjects.id, row.id));
  }
  return ok(`Zaktualizowano przedmiot ${upper}.`);
}

export async function listSubjects(db: Db): Promise<ActionResult> {
  const rows = await db
    .select()
    .from(subjects)
    .orderBy(asc(subjects.semester), asc(subjects.code));
  if (rows.length === 0) return ok('Brak przedmiotów.');
  return ok(
    rows
      .map(
        (s) => `**${s.code}** ${s.name} — sem. ${s.semester}, ${s.ects} ECTS`,
      )
      .join('\n'),
  );
}

const lecturerLabel = (title: string | null | undefined, name: string) =>
  title ? `${title} ${name}` : name;

export async function addLecturer(
  db: Db,
  i: {
    name: string;
    title?: string;
    email?: string;
    officeHours?: string;
    room?: string;
  },
): Promise<ActionResult> {
  let r: { insertId: number };
  try {
    [r] = await db.insert(lecturers).values({
      name: i.name,
      title: i.title === undefined ? null : textOrNull(i.title),
      email: i.email === undefined ? null : emailOrNull(i.email),
      officeHours:
        i.officeHours === undefined ? null : textOrNull(i.officeHours),
      room: i.room === undefined ? null : textOrNull(i.room),
    });
  } catch (err) {
    if (isDuplicateEntry(err)) return refused(DUP_EMAIL);
    throw err;
  }
  return ok(
    `Dodano prowadzącego ${lecturerLabel(i.title, i.name)} (id ${r.insertId}).`,
    r.insertId,
  );
}

export async function editLecturer(
  db: Db,
  id: number,
  patch: {
    name?: string;
    title?: string;
    email?: string;
    officeHours?: string;
    room?: string;
  },
): Promise<ActionResult> {
  const set: Partial<typeof lecturers.$inferInsert> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name === '' || name === '-')
      return refused('Nazwa nie może być pusta.');
    set.name = name;
  }
  if (patch.title !== undefined) set.title = textOrNull(patch.title);
  if (patch.email !== undefined) set.email = emailOrNull(patch.email);
  if (patch.officeHours !== undefined)
    set.officeHours = textOrNull(patch.officeHours);
  if (patch.room !== undefined) set.room = textOrNull(patch.room);
  const [row] = await db
    .select({ id: lecturers.id })
    .from(lecturers)
    .where(eq(lecturers.id, id));
  if (!row) return refused(`Nie znaleziono prowadzącego o id ${id}.`);
  if (Object.keys(set).length > 0) {
    try {
      await db.update(lecturers).set(set).where(eq(lecturers.id, id));
    } catch (err) {
      if (isDuplicateEntry(err)) return refused(DUP_EMAIL);
      throw err;
    }
  }
  const [after] = await db
    .select({ title: lecturers.title, name: lecturers.name })
    .from(lecturers)
    .where(eq(lecturers.id, id));
  return ok(
    `Zaktualizowano prowadzącego ${lecturerLabel(after?.title, after?.name ?? '')}.`,
  );
}

export async function editClass(
  db: Db,
  i: {
    subjectCode: string;
    kind: ClassKind;
    /** `brak` clears the assessment (NULL). */
    assessment?: Assessment | 'brak';
    note?: string;
    platformUrl?: string;
  },
): Promise<ActionResult> {
  const code = i.subjectCode.trim().toUpperCase();
  const set: Partial<typeof classes.$inferInsert> = {};
  if (i.assessment !== undefined)
    set.assessment = i.assessment === 'brak' ? null : i.assessment;
  if (i.note !== undefined) set.assessmentNote = textOrNull(i.note);
  if (i.platformUrl !== undefined) {
    const url = urlOrNull(i.platformUrl);
    if (url === undefined) return refused(INVALID_URL);
    set.platformUrl = url;
  }
  const [subject] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.code, code));
  if (!subject) return refused(notFound(code));
  const [cls] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.subjectId, subject.id), eq(classes.kind, i.kind)));
  if (!cls)
    return refused(
      `Przedmiot ${code} nie ma zajęć typu ${CLASS_NAMES[i.kind]}.`,
    );
  if (Object.keys(set).length > 0) {
    await db.update(classes).set(set).where(eq(classes.id, cls.id));
  }
  return ok(`Zaktualizowano ${code} / ${CLASS_NAMES[i.kind]}.`);
}

export async function assignLecturer(
  db: Db,
  i: {
    subjectCode: string;
    lecturerId: number;
    classKind: ClassKind;
    groupNumber?: number;
  },
): Promise<ActionResult> {
  const code = i.subjectCode.trim().toUpperCase();
  const [subject] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.code, code));
  if (!subject) return refused(`Nie znaleziono przedmiotu ${i.subjectCode}.`);
  const [lecturer] = await db
    .select({ id: lecturers.id })
    .from(lecturers)
    .where(eq(lecturers.id, i.lecturerId));
  if (!lecturer)
    return refused(`Nie znaleziono prowadzącego o id ${i.lecturerId}.`);
  const classId = await ensureClass(db, subject.id, i.classKind);
  const groupId =
    i.groupNumber === undefined
      ? null
      : await ensureGroup(db, classId, i.groupNumber);
  // NULL group_id is not unique-enforced, so check for an existing row.
  const [existing] = await db
    .select({ id: classLecturers.id })
    .from(classLecturers)
    .where(
      and(
        eq(classLecturers.classId, classId),
        eq(classLecturers.lecturerId, i.lecturerId),
        groupId === null
          ? isNull(classLecturers.groupId)
          : eq(classLecturers.groupId, groupId),
      ),
    );
  if (!existing)
    await db
      .insert(classLecturers)
      .values({ classId, lecturerId: i.lecturerId, groupId });
  const where =
    i.groupNumber === undefined
      ? CLASS_NAMES[i.classKind]
      : `${CLASS_NAMES[i.classKind]}, ${groupName(i.groupNumber)}`;
  return ok(`Przypisano prowadzącego do ${code} / ${where}.`);
}

export async function banUser(
  db: Db,
  discordUserId: string,
  banned: boolean,
): Promise<ActionResult> {
  const found = await setBanned(db, discordUserId, banned);
  if (!found) return refused('Ten użytkownik nie korzystał jeszcze z bota.');
  return ok(
    banned ? 'Zablokowano dostęp do strony.' : 'Odblokowano dostęp do strony.',
  );
}
