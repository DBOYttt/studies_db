import {
  CLASS_KINDS,
  classes,
  classGroups,
  classLecturers,
  type Db,
  lecturers,
  subjects,
} from '@studies/db';
import { asc, eq } from 'drizzle-orm';
import type { ClassSpec, SubjectSpec } from './types.js';

/** Every subject with its classes, groups and lecturers, for /setup. */
export async function loadSubjectSpecs(db: Db): Promise<SubjectSpec[]> {
  const subjectRows = await db
    .select()
    .from(subjects)
    .orderBy(asc(subjects.id));
  const classRows = await db.select().from(classes);
  const groupRows = await db
    .select({ classId: classGroups.classId, number: classGroups.number })
    .from(classGroups)
    .orderBy(asc(classGroups.number));
  const lecturerRows = await db
    .select({
      classId: classLecturers.classId,
      name: lecturers.name,
      title: lecturers.title,
      group: classGroups.number,
    })
    .from(classLecturers)
    .innerJoin(lecturers, eq(lecturers.id, classLecturers.lecturerId))
    .leftJoin(classGroups, eq(classGroups.id, classLecturers.groupId))
    .orderBy(asc(classGroups.number), asc(lecturers.name));

  const byClass = (c: (typeof classRows)[number]): ClassSpec => ({
    kind: c.kind,
    name: c.name,
    assessment: c.assessment,
    assessmentNote: c.assessmentNote,
    platformUrl: c.platformUrl,
    groups: groupRows.filter((g) => g.classId === c.id).map((g) => g.number),
    lecturers: lecturerRows
      .filter((l) => l.classId === c.id)
      .map(({ name, title, group }) => ({ name, title, group })),
  });

  return subjectRows.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    semester: s.semester,
    ects: s.ects,
    platformUrl: s.platformUrl,
    channelId: s.discordChannelId,
    classes: classRows
      .filter((c) => c.subjectId === s.id)
      .sort((a, b) => CLASS_KINDS.indexOf(a.kind) - CLASS_KINDS.indexOf(b.kind))
      .map(byClass),
  }));
}
