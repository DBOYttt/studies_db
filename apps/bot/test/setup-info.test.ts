import { describe, expect, it } from 'vitest';
import { INFO_TITLE, renderInfoPost } from '../src/setup/info.js';
import type { SessionSpec, SubjectSpec } from '../src/setup/types.js';

const W = 'https://studies.example';
const wall = (d: number, h: number, m = 0) =>
  new Date(Date.UTC(2026, 9, d, h, m));
const session = (over: Partial<SessionSpec>): SessionSpec => ({
  uid: 'u-w',
  classKind: 'wyklad',
  group: null,
  label: 'ASD — Wykład',
  room: 'A-1 101',
  startsAt: wall(12, 8),
  endsAt: wall(12, 9, 30),
  status: 'confirmed',
  ...over,
});

const ASD: SubjectSpec = {
  id: 1,
  code: 'ASD',
  name: 'Algorytmy i struktury danych',
  semester: 1,
  ects: 6,
  platformUrl: 'https://upel.example/asd',
  channelId: 'f-asd',
  classes: [
    {
      kind: 'wyklad',
      name: 'Wykład',
      assessment: 'egzamin',
      assessmentNote: 'próg 50%',
      platformUrl: null,
      groups: [],
      lecturers: [
        {
          name: 'Jan Kowalski',
          title: 'prof.',
          group: null,
          email: 'jan@example.edu',
          officeHours: 'śr. 10:00-11:30',
          room: 'B-1 301',
        },
      ],
    },
    {
      kind: 'laboratorium',
      name: 'Laboratorium',
      assessment: null,
      assessmentNote: null,
      platformUrl: 'https://upel.example/asd-lab',
      groups: [1],
      lecturers: [
        {
          name: 'Michał Kamiński',
          title: 'mgr',
          group: 1,
          email: null,
          officeHours: null,
          room: null,
        },
      ],
    },
  ],
  sessions: [
    session({}),
    session({ startsAt: wall(19, 8), endsAt: wall(19, 9, 30) }),
    session({
      uid: 'u-l1',
      classKind: 'laboratorium',
      group: 1,
      room: 'C-2 015',
      startsAt: wall(13, 10),
      endsAt: wall(13, 11, 30),
    }),
    session({ startsAt: wall(20, 8), status: 'cancelled', uid: 'u-x' }),
  ],
};

describe('renderInfoPost', () => {
  it('has the fixed title', () => {
    expect(INFO_TITLE).toBe('ℹ️ Informacje o przedmiocie');
  });

  it('renders subject, classes, lecturers and the weekly plan', () => {
    const t = renderInfoPost(ASD, W);
    for (const part of [
      '**Algorytmy i struktury danych** (ASD) — Semestr 1, 6 ECTS',
      'https://upel.example/asd',
      `${W}/s/subjects/ASD`,
      'Exam',
      'próg 50%',
      'prof. Jan Kowalski',
      'jan@example.edu',
      'śr. 10:00-11:30',
      'B-1 301',
      'mgr Michał Kamiński (Gr. 1)',
      'https://upel.example/asd-lab',
      'pon. 08:00–09:30 · Wykład · A-1 101',
      'wt. 10:00–11:30 · Laboratorium Gr. 1 · C-2 015',
      'odwołane: 2026-10-20 Wykład',
      `${W}/s/plan`,
    ]) {
      expect(t).toContain(part);
    }
    // one line per series, Monday before Tuesday
    expect(t.match(/pon\. 08:00/g)).toHaveLength(1);
    expect(t.indexOf('pon. 08:00')).toBeLessThan(t.indexOf('wt. 10:00'));
  });

  it('omits empty parts and never prints null/undefined', () => {
    const t = renderInfoPost(
      { ...ASD, platformUrl: null, classes: [], sessions: [] },
      W,
    );
    expect(t).not.toMatch(/null|undefined|Plan zajęć|Prowadzący/);
    expect(t).toContain(`${W}/s/subjects/ASD`);
  });

  it('caps the text at 2000 characters with a link to the subject page', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      name: `Wykładowca Numer ${i}`,
      title: 'prof. dr hab.',
      group: null,
      email: `w${i}@example.edu`,
      officeHours: 'pon. 10:00-12:00',
      room: 'X-1 100',
    }));
    const t = renderInfoPost(
      { ...ASD, classes: [{ ...ASD.classes[0], lecturers: many }] },
      W,
    );
    expect(t.length).toBeLessThanOrEqual(2000);
    expect(t.endsWith(`Więcej: ${W}/s/subjects/ASD`)).toBe(true);
  });
});
