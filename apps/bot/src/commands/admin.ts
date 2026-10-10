import {
  CLASS_NAMES,
  type ClassKind,
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

const notFound = (code: string) => `Nie znaleziono przedmiotu ${code}.`;

export async function addSubject(db: Db, i: SubjectInput): Promise<string> {
  const code = i.code.trim().toUpperCase();
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
  patch: Partial<Omit<SubjectInput, 'channelId' | 'code'>>,
): Promise<string> {
  const upper = code.trim().toUpperCase();
  const set: Partial<typeof subjects.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.semester !== undefined) set.semester = patch.semester;
  if (patch.ects !== undefined) set.ects = patch.ects;
  if (patch.description !== undefined) set.description = patch.description;
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

export async function addLecturer(
  db: Db,
  i: { name: string; title?: string; email?: string },
): Promise<string> {
  const [r] = await db.insert(lecturers).values({
    name: i.name,
    title: i.title ?? null,
    email: i.email ?? null,
  });
  const label = i.title ? `${i.title} ${i.name}` : i.name;
  return `Dodano prowadzącego ${label} (id ${r.insertId}).`;
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
