/** Human names and links for the targets of audit rows (Audit log, Overview). */
import {
  classes,
  classGroups,
  classMarks,
  type Db,
  events,
  subjects,
} from '@studies/db';
import { eq, inArray } from 'drizzle-orm';
import { eventTargetLabel, parseAuditTarget } from './admin-audit';

export type AuditTarget = { label: string; href?: string };

type Row = { id: number; action: string; target: string | null };

const uniq = (xs: number[]) => [...new Set(xs)];

/**
 * Looks up every nameable target of `rows` in a few batched queries and
 * returns a label (and a link where one exists) per audit row id. Rows whose
 * target can't be named (tables, user ids, unknown subjects) are left out.
 */
export async function loadAuditTargets(
  db: Db,
  rows: Row[],
): Promise<Map<number, AuditTarget>> {
  const refs = rows.flatMap((r) => {
    const ref = parseAuditTarget(r.action, r.target);
    return ref ? [{ row: r.id, ref }] : [];
  });
  const ids = (type: 'event' | 'series' | 'class_mark') =>
    uniq(refs.flatMap(({ ref }) => (ref.type === type ? [ref.id] : [])));
  const eventIds = ids('event');
  const seriesIds = ids('series');
  const markIds = ids('class_mark');
  const codes = [
    ...new Set(
      refs.flatMap(({ ref }) => (ref.type === 'subject' ? [ref.code] : [])),
    ),
  ];

  const eventCols = {
    id: events.id,
    kind: events.kind,
    title: events.title,
    startsAt: events.startsAt,
    deletedAt: events.deletedAt,
    seriesId: events.seriesId,
    subjectCode: subjects.code,
  };
  const [eventRows, seriesRows, markRows, subjectRows] = await Promise.all([
    eventIds.length
      ? db
          .select(eventCols)
          .from(events)
          .leftJoin(subjects, eq(subjects.id, events.subjectId))
          .where(inArray(events.id, eventIds))
      : [],
    seriesIds.length
      ? db
          .select(eventCols)
          .from(events)
          .leftJoin(subjects, eq(subjects.id, events.subjectId))
          .where(inArray(events.seriesId, seriesIds))
          .orderBy(events.startsAt, events.id)
      : [],
    markIds.length
      ? db
          .select({
            id: classMarks.id,
            className: classes.name,
            groupName: classGroups.name,
            subjectCode: subjects.code,
            deletedAt: classMarks.deletedAt,
          })
          .from(classMarks)
          .innerJoin(classes, eq(classes.id, classMarks.classId))
          .innerJoin(subjects, eq(subjects.id, classes.subjectId))
          .leftJoin(classGroups, eq(classGroups.id, classMarks.groupId))
          .where(inArray(classMarks.id, markIds))
      : [],
    codes.length
      ? db
          .select({ code: subjects.code })
          .from(subjects)
          .where(inArray(subjects.code, codes))
      : [],
  ]);

  const deleted = (d: Date | null) => (d ? ' (deleted)' : '');
  const byEvent = new Map(eventRows.map((e) => [e.id, e]));
  // The first occurrence stands for its series (rows are ordered by start).
  const bySeries = new Map<number, (typeof seriesRows)[number]>();
  for (const e of seriesRows) {
    if (e.seriesId !== null && !bySeries.has(e.seriesId))
      bySeries.set(e.seriesId, e);
  }
  const byMark = new Map(markRows.map((m) => [m.id, m]));
  // Subject codes are unique case-insensitively (utf8mb4_unicode_ci).
  const byCode = new Map(
    subjectRows.map((s) => [s.code.toUpperCase(), s.code]),
  );

  const out = new Map<number, AuditTarget>();
  for (const { row, ref } of refs) {
    if (ref.type === 'event') {
      const e = byEvent.get(ref.id);
      out.set(
        row,
        e
          ? {
              label: `${eventTargetLabel(e)}${deleted(e.deletedAt)}`,
              href: `/wydarzenia/${e.id}`,
            }
          : { label: `Event #${ref.id} (removed)` },
      );
    } else if (ref.type === 'series') {
      const e = bySeries.get(ref.id);
      out.set(
        row,
        e
          ? {
              label: `${eventTargetLabel(e)} (series)`,
              href: `/wydarzenia/${e.id}`,
            }
          : { label: `Series #${ref.id} (removed)` },
      );
    } else if (ref.type === 'class_mark') {
      const m = byMark.get(ref.id);
      out.set(
        row,
        m
          ? {
              label: `Entry quiz: ${m.subjectCode}, ${m.className}${
                m.groupName ? ` ${m.groupName}` : ''
              }${deleted(m.deletedAt)}`,
              href: `/subjects/${encodeURIComponent(m.subjectCode)}`,
            }
          : { label: `Entry quiz #${ref.id} (removed)` },
      );
    } else {
      const code = byCode.get(ref.code.toUpperCase());
      if (code)
        out.set(row, {
          label: code,
          href: `/subjects/${encodeURIComponent(code)}`,
        });
    }
  }
  return out;
}
