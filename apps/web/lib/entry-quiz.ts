/**
 * The "Entry quiz every session" section of the subject pages: the marks of
 * the shown classes as plain, serialisable rows for the client component.
 */
import { type ClassMark, type Db, listMarks } from '@studies/db';
import { MONTHS_SHORT, WEEKDAYS_SHORT } from '@studies/db/text';

export type EntryQuizMarkView = {
  id: number;
  version: number;
  groupId: number | null;
  /** "All groups" or the group name. */
  groupLabel: string;
  note: string;
  /** Skipped dates from today on: `YYYY-MM-DD` and "Wed 21 Oct". */
  skips: { date: string; label: string }[];
};

export type EntryQuizClassView = {
  id: number;
  name: string;
  groups: { id: number; name: string }[];
  /** Turned on. */
  marks: EntryQuizMarkView[];
  /** Admins only: turned off, the newest per group without an active one. */
  restorable: EntryQuizMarkView[];
};

/** `Wed 21 Oct` of a `YYYY-MM-DD` date. */
export function skipDateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/** Pure part of `loadEntryQuiz` (marks may include deleted ones). */
export function entryQuizView(
  classes: {
    id: number;
    name: string;
    groups: { id: number; name: string }[];
  }[],
  marks: ClassMark[],
  o: { isAdmin: boolean; today: string },
): EntryQuizClassView[] {
  return classes.map((c) => {
    const groupLabel = (id: number | null) =>
      id === null
        ? 'All groups'
        : (c.groups.find((g) => g.id === id)?.name ?? 'Unknown group');
    const view = (m: ClassMark): EntryQuizMarkView => ({
      id: m.id,
      version: m.version,
      groupId: m.groupId,
      groupLabel: groupLabel(m.groupId),
      note: m.note ?? '',
      skips: m.skips
        .filter((d) => d >= o.today)
        .map((date) => ({ date, label: skipDateLabel(date) })),
    });
    const own = marks.filter(
      (m) => m.classId === c.id && m.kind === 'wejsciowka',
    );
    // All groups first, then by group order of the class.
    const order = (m: ClassMark) =>
      m.groupId === null ? -1 : c.groups.findIndex((g) => g.id === m.groupId);
    const active = own
      .filter((m) => m.deletedAt === null)
      .sort((a, b) => order(a) - order(b));
    const restorable: EntryQuizMarkView[] = [];
    if (o.isAdmin) {
      const on = new Set(active.map((m) => m.groupId));
      const newest = new Map<number | null, ClassMark>();
      for (const m of own) {
        if (m.deletedAt === null || on.has(m.groupId)) continue;
        const prev = newest.get(m.groupId);
        if (!prev || m.id > prev.id) newest.set(m.groupId, m);
      }
      restorable.push(
        ...[...newest.values()].sort((a, b) => order(a) - order(b)).map(view),
      );
    }
    return {
      id: c.id,
      name: c.name,
      groups: c.groups.map((g) => ({ id: g.id, name: g.name })),
      marks: active.map(view),
      restorable,
    };
  });
}

/** The section's data for `classes` (one subject page). */
export async function loadEntryQuiz(
  db: Db,
  classes: {
    id: number;
    name: string;
    groups: { id: number; name: string }[];
  }[],
  o: { isAdmin: boolean; today: string },
): Promise<EntryQuizClassView[]> {
  const marks = await listMarks(
    db,
    classes.map((c) => c.id),
    { includeDeleted: o.isAdmin },
  );
  return entryQuizView(classes, marks, o);
}
