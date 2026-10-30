import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Semester } from './admin-fields.js';
import { setBanned } from './auth.js';
import type { Db } from './client.js';
import { type Assessment, CLASS_NAMES, type ClassKind } from './constants.js';
import { ensureClassRow, ensureGroupRow, groupName } from './hierarchy.js';
import {
  classes,
  classGroups,
  classLecturers,
  lecturers,
  subjects,
} from './schema.js';

/** `id` is the new row's id for actions that insert one. */
export type ActionResult = { ok: boolean; message: string; id?: number };

const ok = (message: string, id?: number): ActionResult =>
  id === undefined ? { ok: true, message } : { ok: true, message, id };
const refused = (message: string): ActionResult => ({ ok: false, message });

export type SubjectInput = {
  channelId: string | null;
  name: string;
  code: string;
  semester: Semester;
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
const INVALID_URL = 'Invalid URL.';
const DUP_EMAIL = 'A lecturer with this email address already exists.';

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

const notFound = (code: string) => `Subject ${code} not found.`;

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
        return refused('A subject with this code or channel already exists.');
      }
      throw err;
    }
    return ok(`Linked subject ${code} to the channel.`);
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
      return refused('A subject with this code or channel already exists.');
    }
    throw err;
  }
  return ok(`Added subject ${code} (${i.name}).`, ins.insertId);
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
  return ok(`Updated subject ${upper}.`);
}

export async function listSubjects(db: Db): Promise<ActionResult> {
  const rows = await db
    .select()
    .from(subjects)
    .orderBy(asc(subjects.semester), asc(subjects.code));
  if (rows.length === 0) return ok('No subjects.');
  return ok(
    rows
      .map(
        (s) =>
          `**${s.code}** ${s.name} — semester ${s.semester}, ${s.ects} ECTS`,
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
    `Added lecturer ${lecturerLabel(i.title, i.name)} (id ${r.insertId}).`,
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
      return refused('The name cannot be empty.');
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
  if (!row) return refused(`Lecturer with id ${id} not found.`);
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
    `Updated lecturer ${lecturerLabel(after?.title, after?.name ?? '')}.`,
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
    return refused(`Subject ${code} has no ${CLASS_NAMES[i.kind]} class.`);
  if (Object.keys(set).length > 0) {
    await db.update(classes).set(set).where(eq(classes.id, cls.id));
  }
  return ok(`Updated ${code} / ${CLASS_NAMES[i.kind]}.`);
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
  if (!subject) return refused(`Subject ${i.subjectCode} not found.`);
  const [lecturer] = await db
    .select({ id: lecturers.id, title: lecturers.title, name: lecturers.name })
    .from(lecturers)
    .where(eq(lecturers.id, i.lecturerId));
  if (!lecturer) return refused(`Lecturer with id ${i.lecturerId} not found.`);
  const cls = await ensureClassRow(db, subject.id, i.classKind);
  const group =
    i.groupNumber === undefined
      ? null
      : await ensureGroupRow(db, cls.id, i.groupNumber);
  const classId = cls.id;
  const groupId = group?.id ?? null;
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
  const className = CLASS_NAMES[i.classKind];
  let msg = `Assigned ${lecturerLabel(lecturer.title, lecturer.name)} to ${assignmentPlace(code, className, i.groupNumber ?? null)}.`;
  if (cls.created) msg += ` Created the ${className} class.`;
  if (group?.created) msg += ` Created group ${i.groupNumber}.`;
  return ok(msg);
}

const assignmentPlace = (
  code: string,
  className: string,
  groupNumber: number | null,
) =>
  groupNumber === null
    ? `${code} / ${className}`
    : `${code} / ${className}, ${groupName(groupNumber)}`;

/** What `unassignLecturer` removed, for the caller's audit row. */
export type RemovedAssignment = {
  subjectCode: string;
  lecturerId: number;
  lecturerName: string;
  classKind: ClassKind;
  groupNumber: number | null;
};

/**
 * Removes one `class_lecturers` row by its id. The class and the group stay
 * (other topics and sessions hang off them).
 */
export async function unassignLecturer(
  db: Db,
  classLecturerId: number,
): Promise<ActionResult & { assignment?: RemovedAssignment }> {
  const [row] = await db
    .select({
      subjectCode: subjects.code,
      lecturerId: lecturers.id,
      title: lecturers.title,
      name: lecturers.name,
      classKind: classes.kind,
      groupNumber: classGroups.number,
    })
    .from(classLecturers)
    .innerJoin(classes, eq(classes.id, classLecturers.classId))
    .innerJoin(subjects, eq(subjects.id, classes.subjectId))
    .innerJoin(lecturers, eq(lecturers.id, classLecturers.lecturerId))
    .leftJoin(classGroups, eq(classGroups.id, classLecturers.groupId))
    .where(eq(classLecturers.id, classLecturerId));
  if (!row) return refused('Assignment not found.');
  const [del] = await db
    .delete(classLecturers)
    .where(eq(classLecturers.id, classLecturerId));
  // Removed meanwhile by someone else: nothing was undone by this call.
  if (del.affectedRows === 0) return refused('Assignment not found.');
  const assignment: RemovedAssignment = {
    subjectCode: row.subjectCode,
    lecturerId: row.lecturerId,
    lecturerName: lecturerLabel(row.title, row.name),
    classKind: row.classKind,
    groupNumber: row.groupNumber,
  };
  return {
    ok: true,
    message: `Removed ${assignment.lecturerName} from ${assignmentPlace(row.subjectCode, CLASS_NAMES[row.classKind], row.groupNumber)}.`,
    assignment,
  };
}

export async function banUser(
  db: Db,
  discordUserId: string,
  banned: boolean,
): Promise<ActionResult> {
  const found = await setBanned(db, discordUserId, banned);
  if (!found) return refused('This user has not used the bot yet.');
  return ok(
    banned
      ? 'Blocked access to the website.'
      : 'Unblocked access to the website.',
  );
}
