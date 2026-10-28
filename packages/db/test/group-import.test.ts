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
      .values({ subjectId: s.id, kind: kind as 'cwiczenia', name: kind })
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
  // subjects are hard-deleted (no deleted_at), so 'Usunięty' is simply absent.
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
    expect(p.totalEvents).toBe(13);
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
    });
    expect(p.ambiguous).toEqual([
      {
        classId: cls['PY.laboratorium'],
        subjectName: 'Programowanie w języku Python',
        className: 'laboratorium',
        groupNames: ['Gr. 1', 'Gr. 4'],
      },
    ]);
    expect(p.unmatched.map((u) => [u.subjectName, u.reason]).sort()).toEqual(
      [
        ['Nieznany przedmiot', 'subject'],
        ['Algebra liniowa', 'class'],
        ['Analiza matematyczna', 'group'],
        ['Usunięty', 'subject'],
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
    const pair = {
      classId: cls['CH.cwiczenia'],
      groupId: grp['CH.cwiczenia.3'],
    };
    const res = await applyGroupImport(
      db,
      userId,
      Array.from({ length: 150 }, () => pair),
    );
    expect(res.set).toBeLessThanOrEqual(100);
    expect(res.set + res.skipped).toBe(150);
  });
});
