import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { getMyGroups, setMyGroup } from '../src/my-groups.js';
import { classes, classGroups, subjects, users } from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';
import {
  applyGroupImport,
  NotACalendarError,
  planGroupImport,
  previewHasNothing,
} from '../src/unitime/group-import.js';

const fixture = (n: string) =>
  readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

let db: Db;
let userId: number;
const cls: Record<string, number> = {};
const grp: Record<string, number> = {};

const CLASS_NAMES: Record<string, string> = {
  wyklad: 'Wykład',
  laboratorium: 'Laboratorium',
  cwiczenia: 'Ćwiczenia',
};

async function addSubject(
  key: string,
  unitimeName: string,
  kinds: Record<string, number[]>,
) {
  const [s] = await db
    .insert(subjects)
    .values({
      name: unitimeName.replace(/ \(1rok\)$/, ''),
      code: key,
      semester: 1,
      ects: 1,
      discordChannelId: `gi-${key}`,
      unitimeName,
    })
    .$returningId();
  for (const [kind, nums] of Object.entries(kinds)) {
    const [c] = await db
      .insert(classes)
      .values({
        subjectId: s.id,
        kind: kind as 'cwiczenia',
        name: CLASS_NAMES[kind] ?? kind,
      })
      .$returningId();
    cls[`${key}.${kind}`] = c.id;
    for (const n of nums) {
      const [g] = await db
        .insert(classGroups)
        .values({ classId: c.id, number: n, name: `Gr. ${n}` })
        .$returningId();
      grp[`${key}.${kind}.${n}`] = g.id;
    }
  }
}

beforeAll(async () => {
  db = await resetTestDb();
  await addSubject('CH', 'Chemia ogólna (1rok)', {
    cwiczenia: [1, 2, 3, 4],
    laboratorium: [3],
    wyklad: [1],
  });
  await addSubject('PY', 'Programowanie w języku Python (1rok)', {
    laboratorium: [1, 4],
  });
  await addSubject('AL', 'Algebra liniowa (1rok)', { cwiczenia: [1] });
  await addSubject('AM', 'Analiza matematyczna (1rok)', {
    cwiczenia: [1, 2, 3, 4],
  });
  [{ id: userId }] = await db
    .insert(users)
    .values({ discordUserId: 'gi-u', displayName: 'U' })
    .$returningId();
});
afterAll(async () => {
  await closeTestDb(db);
});

describe('planGroupImport', () => {
  it('plans the personal fixture', async () => {
    const p = await planGroupImport(db, userId, fixture('personal.ics'));
    expect(p.calendarName).toBe('Personal Schedule');
    expect(p.totalEvents).toBe(12);
    expect(
      p.matched.map((m) => [m.classId, m.groupId, m.currentGroupId]),
    ).toEqual([
      [cls['CH.wyklad'], grp['CH.wyklad.1'], null],
      [cls['CH.laboratorium'], grp['CH.laboratorium.3'], null],
      [cls['CH.cwiczenia'], grp['CH.cwiczenia.2'], null],
    ]);
    expect(p.matched[2]).toMatchObject({
      subjectName: 'Chemia ogólna',
      groupName: 'Gr. 2',
      className: 'Ćwiczenia',
    });
    expect(p.ambiguous).toEqual([
      {
        classId: cls['PY.laboratorium'],
        subjectName: 'Programowanie w języku Python',
        className: 'Laboratorium',
        groupNames: ['Gr. 1', 'Gr. 4'],
      },
    ]);
    expect(p.unmatched.map((u) => [u.subjectName, u.reason]).sort()).toEqual(
      [
        ['Nieznany przedmiot', 'subject'],
        ['Algebra liniowa', 'class'],
        ['Analiza matematyczna', 'group'],
      ].sort(),
    );
    expect(p.skipped).toEqual({ exam: 1, noKind: 1, noGroup: 1 });
  });

  it('reports the current group', async () => {
    await setMyGroup(db, userId, cls['CH.cwiczenia'], grp['CH.cwiczenia.1']);
    const p = await planGroupImport(db, userId, fixture('personal.ics'));
    const m = p.matched.find((x) => x.classId === cls['CH.cwiczenia']);
    expect(m?.currentGroupId).toBe(grp['CH.cwiczenia.1']);
    await setMyGroup(db, userId, cls['CH.cwiczenia'], null);
  });

  it('handles an empty calendar', async () => {
    const p = await planGroupImport(db, userId, fixture('personal-empty.ics'));
    expect(p.totalEvents).toBe(0);
    expect(previewHasNothing(p)).toBe(true);
  });

  it('rejects text that is not a calendar', async () => {
    await expect(planGroupImport(db, userId, '<html>')).rejects.toBeInstanceOf(
      NotACalendarError,
    );
  });
});

// Weekly Thursdays from 2026-10-01: occurrences -> last day.
const UNTIL: Record<number, string> = { 3: '20261015', 5: '20261029' };

function ics(
  events: { desc: string; start: string; count?: number; status?: string }[],
) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:T'];
  events.forEach((e, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `DTSTART;TZID=Europe/Warsaw:${e.start}T094500`,
      `DTEND;TZID=Europe/Warsaw:${e.start}T104500`,
      `STATUS:${e.status ?? 'CONFIRMED'}`,
    );
    if (e.count)
      lines.push(
        `RRULE:FREQ=WEEKLY;UNTIL=${UNTIL[e.count] ?? '20261231'}T101500Z;BYDAY=TH;WKST=MO`,
      );
    lines.push(
      `UID:w${i}`,
      'SUMMARY:Analiza matematyczna (1rok)',
      `DESCRIPTION:${e.desc}`,
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

describe('weighting and cancellation', () => {
  it('the group with more occurrences wins', async () => {
    const p = await planGroupImport(
      db,
      userId,
      ics([
        { desc: 'CWA 2', start: '20261001', count: 3 },
        { desc: 'CWA 3', start: '20261002' },
      ]),
    );
    expect(p.ambiguous).toEqual([]);
    expect(p.matched.map((m) => m.groupId)).toEqual([grp['AM.cwiczenia.2']]);
  });

  it('ignores cancelled events', async () => {
    const p = await planGroupImport(
      db,
      userId,
      ics([
        { desc: 'CWA 2', start: '20261001', count: 3 },
        { desc: 'CWA 3', start: '20261001', count: 5, status: 'CANCELLED' },
        { desc: 'CWA 9', start: '20261003', status: 'CANCELLED' },
      ]),
    );
    expect(p.totalEvents).toBe(3);
    expect(p.matched.map((m) => m.groupId)).toEqual([grp['AM.cwiczenia.2']]);
    expect(p.unmatched).toEqual([]);
  });
});

describe('applyGroupImport', () => {
  it('merges valid pairs and skips invalid ones', async () => {
    await setMyGroup(db, userId, cls['AM.cwiczenia'], grp['AM.cwiczenia.2']);
    const res = await applyGroupImport(db, userId, [
      { classId: cls['CH.cwiczenia'], groupId: grp['CH.cwiczenia.2'] },
      { classId: cls['CH.laboratorium'], groupId: grp['CH.laboratorium.3'] },
      { classId: cls['CH.wyklad'], groupId: grp['CH.wyklad.1'] },
      { classId: cls['CH.cwiczenia'], groupId: grp['PY.laboratorium.1'] },
      { classId: 1.5, groupId: 2 },
    ]);
    expect(res).toEqual({ set: 3, skipped: 2 });
    const mine = await getMyGroups(db, userId);
    expect(mine[String(cls['AM.cwiczenia'])]).toBe(grp['AM.cwiczenia.2']);
    expect(mine[String(cls['CH.cwiczenia'])]).toBe(grp['CH.cwiczenia.2']);
  });

  it('caps the pairs at 100', async () => {
    const pairs: { classId: number; groupId: number }[] = [];
    for (let i = 0; i < 105; i++) {
      const [s] = await db
        .insert(subjects)
        .values({
          name: `Cap ${i}`,
          code: `CAP${i}`,
          semester: 1,
          ects: 1,
          discordChannelId: `gi-cap-${i}`,
        })
        .$returningId();
      const [c] = await db
        .insert(classes)
        .values({ subjectId: s.id, kind: 'cwiczenia', name: `C${i}` })
        .$returningId();
      const [g] = await db
        .insert(classGroups)
        .values({ classId: c.id, number: 1, name: 'Gr. 1' })
        .$returningId();
      pairs.push({ classId: c.id, groupId: g.id });
    }
    const res = await applyGroupImport(db, userId, pairs);
    expect(res).toEqual({ set: 100, skipped: 5 });
    const mine = await getMyGroups(db, userId);
    expect(mine[String(pairs[99]?.classId)]).toBe(pairs[99]?.groupId);
    expect(mine[String(pairs[100]?.classId)]).toBeUndefined();
  });

  it('lets the last pair win for the same class', async () => {
    const res = await applyGroupImport(db, userId, [
      { classId: cls['AM.cwiczenia'], groupId: grp['AM.cwiczenia.1'] },
      { classId: cls['AM.cwiczenia'], groupId: grp['AM.cwiczenia.4'] },
    ]);
    expect(res).toEqual({ set: 1, skipped: 1 });
    const mine = await getMyGroups(db, userId);
    expect(mine[String(cls['AM.cwiczenia'])]).toBe(grp['AM.cwiczenia.4']);
  });
});
