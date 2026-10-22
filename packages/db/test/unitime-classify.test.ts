import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyEvent,
  type IcsEvent,
  parseIcs,
  parseLecturerCn,
  semesterFor,
  subjectCode,
} from '../src/unitime/index.js';

function ev(over: Partial<IcsEvent>): IcsEvent {
  const d = new Date(Date.UTC(2026, 9, 6, 8, 0));
  return {
    uid: 'x',
    sequence: 0,
    status: 'confirmed',
    summary: 'Algebra liniowa (1rok)',
    description: '',
    location: '',
    organizer: null,
    start: d,
    end: d,
    rrule: null,
    rruleUnsupported: false,
    exdates: [],
    ...over,
  };
}

describe('classifyEvent', () => {
  const cases: [string, string | null, number | null, string | null][] = [
    ['Wykład 1', 'wyklad', 1, null],
    ['Wykład 1b', 'wyklad', 1, null],
    ['CWA 2a', 'cwiczenia', 2, null],
    ['Ćwiczenia audytoryjne 4', 'cwiczenia', 4, null],
    ['CWL 5c', 'laboratorium', 5, null],
    ['Ćwiczenia laboratoryjne 2', 'laboratorium', 2, null],
    ['Laboratorium 3', 'laboratorium', 3, null],
    ['Ćwiczenia projektowe 1', 'projekt', 1, null],
    ['Ćwiczenia projektowe 2f', 'projekt', 2, null],
    ['Projekt 7', 'projekt', 7, null],
    ['Zajęcia seminaryjne 3', 'seminarium', 3, null],
    ['Seminarium 2', 'seminarium', 2, null],
    ['Zajęcia praktyczne 1b', 'praktyczne', 1, null],
    ['Hala O_TPR_K-127', 'wf', 127, 'K-127'],
    ['Hala O_TPR_M-128', 'wf', 128, 'M-128'],
    ['Konsultacje 1', null, null, null],
  ];
  it.each(cases)('%s', (desc, kind, group, groupName) => {
    const r = classifyEvent(ev({ description: desc }));
    expect(r.kind).toBe(kind);
    expect(r.groupNumber).toBe(group);
    expect(r.groupName).toBe(groupName);
    expect(r.label).toBe(desc);
  });

  it.each([
    'Egzamin',
    'Egzamin 1',
    'egz. pisemny',
    'Egz.',
    'Exam',
    'Zaliczenie',
    'Zaliczenie 2',
    'Kolokwium zaliczeniowe',
  ])('%s is an exam', (desc) => {
    const r = classifyEvent(ev({ description: desc }));
    expect(r.sessionKind).toBe('exam');
    expect(r.kind).toBeNull();
    expect(r.groupNumber).toBeNull();
    expect(r.label).toBe(desc);
  });

  it.each(['Egzaminatorium', 'Examination', 'Zaliczeniowy', 'Kolokwium 1'])(
    '%s is not an exam',
    (desc) => {
      expect(classifyEvent(ev({ description: desc })).sessionKind).toBe(
        'class',
      );
    },
  );

  it('recognises an exam by the start of the summary', () => {
    const r = classifyEvent(
      ev({ summary: 'Egzamin: Algebra liniowa (1rok)', description: '' }),
    );
    expect(r.sessionKind).toBe('exam');
  });

  it('classes stay sessionKind class', () => {
    expect(classifyEvent(ev({ description: 'Wykład 1' })).sessionKind).toBe(
      'class',
    );
    expect(
      classifyEvent(ev({ description: 'Konsultacje 1' })).sessionKind,
    ).toBe('class');
  });

  it('extracts subject, year, lecturer, room', () => {
    const r = classifyEvent(
      ev({
        summary: 'Zapis konstrukcji i grafika inżynierska (1rok)',
        description: 'Wykład 1\ndr hab. inż. Piekło, J',
        location: 'D-16 1.02A',
        organizer: { cn: 'dr hab. inż. Piekło, J', email: 'l@example.edu' },
      }),
    );
    expect(r.subjectName).toBe('Zapis konstrukcji i grafika inżynierska');
    expect(r.yearOfStudy).toBe(1);
    expect(r.room).toBe('D-16 1.02A');
    expect(r.lecturer).toEqual({
      title: 'dr hab. inż.',
      name: 'J. Piekło',
      email: 'l@example.edu',
    });
  });

  it('falls back to description second line without email; no year', () => {
    const r = classifyEvent(
      ev({
        summary: 'Wychowanie Fizyczne 1',
        description: 'CWL 1\ndr Przykładowy, A',
        location: '',
      }),
    );
    expect(r.yearOfStudy).toBeNull();
    expect(r.room).toBeNull();
    expect(r.lecturer).toEqual({
      title: 'dr',
      name: 'A. Przykładowy',
      email: null,
    });
  });

  it('no lecturer when none available; label capped at 100', () => {
    const r = classifyEvent(ev({ description: 'x'.repeat(150) }));
    expect(r.lecturer).toBeNull();
    expect(r.label).toHaveLength(100);
  });

  it('classifies every fixture event except Konsultacje', () => {
    const cal = parseIcs(
      readFileSync(new URL('./fixtures/unitime.ics', import.meta.url), 'utf8'),
    );
    expect(cal.events.length).toBe(24);
    for (const e of cal.events) {
      const r = classifyEvent(e);
      if (e.description.startsWith('Konsultacje')) expect(r.kind).toBeNull();
      else expect(r.kind, e.description).not.toBeNull();
    }
  });
});

describe('parseLecturerCn', () => {
  it('parses titles and names', () => {
    expect(parseLecturerCn('dr hab. inż. Piekło, J', null)).toEqual({
      title: 'dr hab. inż.',
      name: 'J. Piekło',
      email: null,
    });
    expect(
      parseLecturerCn('prof. dr hab. inż. Nowak, A', 'a@example.edu'),
    ).toEqual({
      title: 'prof. dr hab. inż.',
      name: 'A. Nowak',
      email: 'a@example.edu',
    });
    expect(parseLecturerCn('mgr Kowalski', null)).toEqual({
      title: 'mgr',
      name: 'Kowalski',
      email: null,
    });
    expect(parseLecturerCn('Strzępowicz, A', null).title).toBeNull();
  });
});

describe('subjectCode', () => {
  const none = new Set<string>();
  it.each([
    ['Programowanie w języku Python', 'PJP'],
    ['Przemysł 4.0', 'P40'],
    ['Wychowanie Fizyczne 1', 'WF1'],
    ['Zapis konstrukcji i grafika inżynierska', 'ZKGI'],
    ['', 'PRZ'],
  ])('%s -> %s', (name, code) => {
    expect(subjectCode(name, none)).toBe(code);
  });
  it('resolves collisions', () => {
    expect(subjectCode('Algebra liniowa', new Set(['AL']))).toBe('AL-2');
    expect(subjectCode('Algebra liniowa', new Set(['AL', 'AL-2']))).toBe(
      'AL-3',
    );
  });
  it('caps at 20 chars', () => {
    const long = Array.from({ length: 30 }, () => 'Abc').join(' ');
    expect(subjectCode(long, none)).toHaveLength(20);
  });
});

describe('semesterFor', () => {
  it('maps winter/summer and year', () => {
    expect(
      semesterFor('O-TPR-1 S1 harmonogram dla Semestr zimowy 2026', 1),
    ).toBe(1);
    expect(semesterFor('X Semestr letni 2027', 1)).toBe(2);
    expect(semesterFor('X Semestr zimowy 2026', 2)).toBe(3);
    expect(semesterFor('X Semestr letni 2027', 3)).toBe(6);
    expect(semesterFor('X Semestr zimowy 2026', null)).toBe(1);
    expect(semesterFor('X Semestr letni 2027', null)).toBe(2);
  });
});
