import { inArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import { CLASS_KINDS, type ClassKind } from '../constants.js';
import { getMyGroups } from '../my-groups.js';
import { classes, classGroups, subjects, userGroups } from '../schema.js';
import { classifyEvent } from './classify.js';
import { SafeSyncError } from './fetch.js';
import { expandOccurrences, parseIcs } from './ics.js';

export interface GroupImportPreview {
  calendarName: string | null;
  totalEvents: number;
  matched: {
    classId: number;
    groupId: number;
    subjectName: string;
    className: string;
    groupName: string;
    currentGroupId: number | null;
  }[];
  ambiguous: {
    classId: number;
    subjectName: string;
    className: string;
    groupNames: string[];
  }[];
  unmatched: {
    subjectName: string;
    label: string;
    reason: 'subject' | 'class' | 'group';
  }[];
  skipped: { exam: number; noKind: number; noGroup: number };
}

export class NotACalendarError extends Error {}

export const GROUP_IMPORT_MAX_PAIRS = 100;
const UNMATCHED_CAP = 50;
export const NO_CLASSES_MESSAGE =
  'This calendar has no classes yet. UniTime may not have published your timetable; try again later or pick your groups below.';
export const NOT_A_CALENDAR_MESSAGE = 'That is not a UniTime calendar (.ics).';

export const TOO_MANY_IMPORTS = 'Too many imports. Try again in a few minutes.';
export const IMPORT_FAILED = 'Could not read the calendar.';
/** Imports (previews and uploads) per user per window: 6 per 10 minutes. */
export const GROUP_IMPORT_LIMIT = 6;
export const GROUP_IMPORT_WINDOW_MS = 10 * 60_000;

/**
 * The message a failed import may show: our own host-only messages pass
 * through, anything else (which may embed the link) becomes a generic one.
 */
export function importErrorMessage(err: unknown): string {
  if (err instanceof NotACalendarError) return NOT_A_CALENDAR_MESSAGE;
  if (err instanceof SafeSyncError) return err.message;
  return IMPORT_FAILED;
}

/** The matched pairs that change My groups (already saved ones are left out). */
export function changedPairs(
  p: GroupImportPreview,
): { classId: number; groupId: number }[] {
  return p.matched
    .filter((m) => m.currentGroupId !== m.groupId)
    .map((m) => ({ classId: m.classId, groupId: m.groupId }));
}

export function previewHasNothing(p: GroupImportPreview): boolean {
  return (
    p.matched.length === 0 &&
    p.ambiguous.length === 0 &&
    p.unmatched.length === 0
  );
}

export async function planGroupImport(
  db: Db,
  userId: number,
  icsText: string,
): Promise<GroupImportPreview> {
  if (!/BEGIN:VCALENDAR/i.test(icsText)) throw new NotACalendarError();
  let cal: ReturnType<typeof parseIcs>;
  try {
    cal = parseIcs(icsText);
  } catch {
    throw new NotACalendarError();
  }
  const preview: GroupImportPreview = {
    calendarName: cal.name || null,
    totalEvents: cal.events.length,
    matched: [],
    ambiguous: [],
    unmatched: [],
    skipped: { exam: 0, noKind: 0, noGroup: 0 },
  };

  type Entry = {
    unitimeName: string;
    subjectName: string;
    label: string;
    kind: ClassKind;
    number: number;
    weight: number;
  };
  const entries: Entry[] = [];
  for (const ev of cal.events) {
    if (ev.status === 'cancelled') continue;
    const c = classifyEvent(ev);
    if (c.sessionKind === 'exam') {
      preview.skipped.exam++;
      continue;
    }
    if (c.kind === null) {
      preview.skipped.noKind++;
      continue;
    }
    if (c.groupNumber === null) {
      preview.skipped.noGroup++;
      continue;
    }
    entries.push({
      unitimeName: c.unitimeName,
      subjectName: c.subjectName,
      label: c.label,
      kind: c.kind,
      number: c.groupNumber,
      weight: expandOccurrences(ev).length,
    });
  }
  if (entries.length === 0) return preview;

  const subjectRows = await db
    .select({
      id: subjects.id,
      name: subjects.name,
      unitimeName: subjects.unitimeName,
    })
    .from(subjects)
    .where(
      inArray(subjects.unitimeName, [
        ...new Set(entries.map((e) => e.unitimeName)),
      ]),
    );
  const subjectByName = new Map(subjectRows.map((s) => [s.unitimeName, s]));
  const classRows = subjectRows.length
    ? await db
        .select({
          id: classes.id,
          subjectId: classes.subjectId,
          kind: classes.kind,
          name: classes.name,
        })
        .from(classes)
        .where(
          inArray(
            classes.subjectId,
            subjectRows.map((s) => s.id),
          ),
        )
    : [];
  const classByKey = new Map(
    classRows.map((c) => [`${c.subjectId}:${c.kind}`, c]),
  );
  const groupRows = classRows.length
    ? await db
        .select({
          id: classGroups.id,
          classId: classGroups.classId,
          number: classGroups.number,
          name: classGroups.name,
        })
        .from(classGroups)
        .where(
          inArray(
            classGroups.classId,
            classRows.map((c) => c.id),
          ),
        )
    : [];
  const groupByKey = new Map(
    groupRows.map((g) => [`${g.classId}:${g.number}`, g]),
  );

  const unmatchedSeen = new Set<string>();
  const addUnmatched = (
    subjectName: string,
    label: string,
    reason: 'subject' | 'class' | 'group',
  ) => {
    const key = `${subjectName}\u0000${label}\u0000${reason}`;
    if (unmatchedSeen.has(key) || preview.unmatched.length >= UNMATCHED_CAP)
      return;
    unmatchedSeen.add(key);
    preview.unmatched.push({ subjectName, label, reason });
  };

  // classId -> groupId -> weight
  const weights = new Map<number, Map<number, number>>();
  for (const e of entries) {
    const subject = subjectByName.get(e.unitimeName);
    if (!subject) {
      addUnmatched(e.subjectName, e.label, 'subject');
      continue;
    }
    const cls = classByKey.get(`${subject.id}:${e.kind}`);
    if (!cls) {
      addUnmatched(subject.name, e.label, 'class');
      continue;
    }
    const group = groupByKey.get(`${cls.id}:${e.number}`);
    if (!group) {
      addUnmatched(subject.name, e.label, 'group');
      continue;
    }
    const m = weights.get(cls.id) ?? new Map<number, number>();
    m.set(group.id, (m.get(group.id) ?? 0) + e.weight);
    weights.set(cls.id, m);
  }

  const mine = await getMyGroups(db, userId);
  const classById = new Map(classRows.map((c) => [c.id, c]));
  const subjectById = new Map(subjectRows.map((s) => [s.id, s]));
  const groupById = new Map(groupRows.map((g) => [g.id, g]));
  const matched: (GroupImportPreview['matched'][number] & { kind: string })[] =
    [];
  for (const [classId, m] of weights) {
    const cls = classById.get(classId);
    const subject = cls && subjectById.get(cls.subjectId);
    if (!cls || !subject) continue;
    const top = Math.max(...m.values());
    const winners = [...m.entries()]
      .filter(([, w]) => w === top)
      .map(([gid]) => groupById.get(gid))
      .filter((g): g is NonNullable<typeof g> => !!g)
      .sort((a, b) => a.number - b.number);
    if (winners.length === 1 && winners[0]) {
      matched.push({
        classId,
        groupId: winners[0].id,
        subjectName: subject.name,
        className: cls.name,
        groupName: winners[0].name,
        currentGroupId: mine[String(classId)] ?? null,
        kind: cls.kind,
      });
    } else if (winners.length > 1) {
      preview.ambiguous.push({
        classId,
        subjectName: subject.name,
        className: cls.name,
        groupNames: winners.map((g) => g.name),
      });
    }
  }
  const order = (kind: string) => CLASS_KINDS.indexOf(kind as ClassKind);
  matched.sort(
    (a, b) =>
      a.subjectName.localeCompare(b.subjectName, 'pl') ||
      order(a.kind) - order(b.kind),
  );
  preview.matched = matched.map(({ kind: _k, ...rest }) => rest);
  const kindOf = (id: number) => order(classById.get(id)?.kind ?? '');
  preview.ambiguous.sort(
    (a, b) =>
      a.subjectName.localeCompare(b.subjectName, 'pl') ||
      kindOf(a.classId) - kindOf(b.classId),
  );
  return preview;
}

export async function applyGroupImport(
  db: Db,
  userId: number,
  pairs: { classId: number; groupId: number }[],
): Promise<{ set: number; skipped: number }> {
  const total = pairs.length;
  const kept = pairs
    .filter(
      (p) =>
        Number.isSafeInteger(p.classId) &&
        p.classId > 0 &&
        Number.isSafeInteger(p.groupId) &&
        p.groupId > 0,
    )
    .slice(0, GROUP_IMPORT_MAX_PAIRS);
  if (kept.length === 0) return { set: 0, skipped: total };
  const found = await db
    .select({ id: classGroups.id, classId: classGroups.classId })
    .from(classGroups)
    .where(
      inArray(
        classGroups.id,
        kept.map((p) => p.groupId),
      ),
    );
  const classOf = new Map(found.map((g) => [g.id, g.classId]));
  // One group per class; a later pair for the same class wins.
  const byClass = new Map<number, number>();
  for (const p of kept)
    if (classOf.get(p.groupId) === p.classId) byClass.set(p.classId, p.groupId);
  if (byClass.size === 0) return { set: 0, skipped: total };
  await db.transaction(async (tx) => {
    for (const [classId, groupId] of byClass)
      await tx
        .insert(userGroups)
        .values({ userId, classId, groupId })
        .onDuplicateKeyUpdate({ set: { groupId } });
  });
  return { set: byClass.size, skipped: total - byClass.size };
}
