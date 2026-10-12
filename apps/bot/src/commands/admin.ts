import {
  type Assessment,
  CLASS_NAMES,
  type ClassKind,
  classes,
  classLecturers,
  type Db,
  ensureClass,
  ensureGroup,
  groupName,
  lecturers,
  setBanned,
  subjects,
} from '@studies/db';
import { and, asc, eq, isNull } from 'drizzle-orm';

export type SubjectInput = {
  channelId: string;
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
const textOrNull = (v: string): string | null => {
  const t = v.trim();
  return t === '-' || t === '' ? null : t;
};
const urlOrNull = (v: string): string | null | undefined => {
  const t = textOrNull(v);
  return t === null || URL_RE.test(t) ? t : undefined;
};
const emailOrNull = (v: string): string | null => {
  const t = textOrNull(v);
  return t === null ? null : t.toLowerCase();
};

const notFound = (code: string) => `Nie znaleziono przedmiotu ${code}.`;

export async function addSubject(db: Db, i: SubjectInput): Promise<string> {
  const code = i.code.trim().toUpperCase();
  const [existing] = await db
    .select({
      id: subjects.id,
      channel: subjects.discordChannelId,
      description: subjects.description,
    })
    .from(subjects)
    .where(eq(subjects.code, code));
  if (existing && existing.channel === null) {
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
        return 'Przedmiot z tym kodem lub kanałem już istnieje.';
      }
      throw err;
    }
    return `Połączono przedmiot ${code} z kanałem.`;
  }
  try {
    await db.insert(subjects).values({
      name: i.name,
      code,
      semester: i.semester,
      ects: i.ects,
      description: i.description ?? null,
      discordChannelId: i.channelId,
    });
  } catch (err) {
    if (isDuplicateEntry(err)) {
      return 'Przedmiot z tym kodem lub kanałem już istnieje.';
    }
    throw err;
  }
  return `Dodano przedmiot ${code} (${i.name}).`;
}

export async function editSubject(
  db: Db,
  code: string,
  patch: Partial<Omit<SubjectInput, 'channelId' | 'code'>> & {
    platformUrl?: string;
  },
): Promise<string> {
  const upper = code.trim().toUpperCase();
  const set: Partial<typeof subjects.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.semester !== undefined) set.semester = patch.semester;
  if (patch.ects !== undefined) set.ects = patch.ects;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.platformUrl !== undefined) {
    const url = urlOrNull(patch.platformUrl);
    if (url === undefined) return INVALID_URL;
    set.platformUrl = url;
  }
  const [row] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.code, upper));
  if (!row) return notFound(upper);
  if (Object.keys(set).length > 0) {
    await db.update(subjects).set(set).where(eq(subjects.id, row.id));
  }
  return `Zaktualizowano przedmiot ${upper}.`;
}

export async function listSubjects(db: Db): Promise<string> {
  const rows = await db
    .select()
    .from(subjects)
    .orderBy(asc(subjects.semester), asc(subjects.code));
  if (rows.length === 0) return 'Brak przedmiotów.';
  return rows
    .map((s) => `**${s.code}** ${s.name} — sem. ${s.semester}, ${s.ects} ECTS`)
    .join('\n');
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
): Promise<string> {
  let r: { insertId: number };
  try {
    [r] = await db.insert(lecturers).values({
      name: i.name,
      title: i.title ?? null,
      email: i.email === undefined ? null : emailOrNull(i.email),
      officeHours:
        i.officeHours === undefined ? null : textOrNull(i.officeHours),
      room: i.room === undefined ? null : textOrNull(i.room),
    });
  } catch (err) {
    if (isDuplicateEntry(err)) return DUP_EMAIL;
    throw err;
  }
  return `Dodano prowadzącego ${lecturerLabel(i.title, i.name)} (id ${r.insertId}).`;
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
): Promise<string> {
  const set: Partial<typeof lecturers.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.title !== undefined) set.title = textOrNull(patch.title);
  if (patch.email !== undefined) set.email = emailOrNull(patch.email);
  if (patch.officeHours !== undefined)
    set.officeHours = textOrNull(patch.officeHours);
  if (patch.room !== undefined) set.room = textOrNull(patch.room);
  const [row] = await db
    .select({ id: lecturers.id })
    .from(lecturers)
    .where(eq(lecturers.id, id));
  if (!row) return `Nie znaleziono prowadzącego o id ${id}.`;
  if (Object.keys(set).length > 0) {
    try {
      await db.update(lecturers).set(set).where(eq(lecturers.id, id));
    } catch (err) {
      if (isDuplicateEntry(err)) return DUP_EMAIL;
      throw err;
    }
  }
  const [after] = await db
    .select({ title: lecturers.title, name: lecturers.name })
    .from(lecturers)
    .where(eq(lecturers.id, id));
  return `Zaktualizowano prowadzącego ${lecturerLabel(after?.title, after?.name ?? '')}.`;
}

export async function editClass(
  db: Db,
  i: {
    subjectCode: string;
    kind: ClassKind;
    assessment?: Assessment;
    note?: string;
    platformUrl?: string;
  },
): Promise<string> {
  const code = i.subjectCode.trim().toUpperCase();
  const set: Partial<typeof classes.$inferInsert> = {};
  if (i.assessment !== undefined) set.assessment = i.assessment;
  if (i.note !== undefined) set.assessmentNote = textOrNull(i.note);
  if (i.platformUrl !== undefined) {
    const url = urlOrNull(i.platformUrl);
    if (url === undefined) return INVALID_URL;
    set.platformUrl = url;
  }
  const [subject] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.code, code));
  if (!subject) return notFound(code);
  const [cls] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.subjectId, subject.id), eq(classes.kind, i.kind)));
  if (!cls)
    return `Przedmiot ${code} nie ma zajęć typu ${CLASS_NAMES[i.kind]}.`;
  if (Object.keys(set).length > 0) {
    await db.update(classes).set(set).where(eq(classes.id, cls.id));
  }
  return `Zaktualizowano ${code} / ${CLASS_NAMES[i.kind]}.`;
}

export async function assignLecturer(
  db: Db,
  i: {
    subjectCode: string;
    lecturerId: number;
    classKind: ClassKind;
    groupNumber?: number;
  },
): Promise<string> {
  const code = i.subjectCode.trim().toUpperCase();
  const [subject] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.code, code));
  if (!subject) return `Nie znaleziono przedmiotu ${i.subjectCode}.`;
  const [lecturer] = await db
    .select({ id: lecturers.id })
    .from(lecturers)
    .where(eq(lecturers.id, i.lecturerId));
  if (!lecturer) return `Nie znaleziono prowadzącego o id ${i.lecturerId}.`;
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
  return `Przypisano prowadzącego do ${code} / ${where}.`;
}

export async function banReply(
  db: Db,
  discordUserId: string,
  banned: boolean,
): Promise<string> {
  const found = await setBanned(db, discordUserId, banned);
  if (!found) return 'Ten użytkownik nie korzystał jeszcze z bota.';
  return banned
    ? 'Zablokowano dostęp do strony.'
    : 'Odblokowano dostęp do strony.';
}
