import { describe, expect, it } from 'vitest';
import { renderGuidelines } from '../src/setup/guidelines.js';
import type { SubjectSpec } from '../src/setup/types.js';

const ASD: SubjectSpec = {
  id: 1,
  code: 'ASD',
  name: 'Algorytmy i struktury danych',
  semester: 3,
  ects: 6,
  platformUrl: 'https://upel.example.edu/course/asd',
  channelId: null,
  classes: [
    {
      kind: 'laboratorium',
      name: 'Laboratorium',
      assessment: 'sprawozdania',
      assessmentNote: 'co tydzień',
      platformUrl: 'https://upel.example.edu/course/asd-lab',
      groups: [1, 2, 3],
      lecturers: [
        { name: 'Tomasz Zieliński', title: 'dr inż.', group: null },
        { name: 'Michał Kamiński', title: 'mgr', group: 3 },
      ],
    },
  ],
};

describe('renderGuidelines', () => {
  it('describes the subject, classes, lecturers and how to tag posts', () => {
    const g = renderGuidelines(ASD);
    for (const part of [
      'Algorytmy i struktury danych',
      'Semester 3',
      '6 ECTS',
      'https://upel.example.edu/course/asd',
      'Laboratorium',
      'Lab reports',
      'co tydzień',
      'https://upel.example.edu/course/asd-lab',
      'dr inż. Tomasz Zieliński',
      'mgr Michał Kamiński (Gr. 3)',
    ]) {
      expect(g).toContain(part);
    }
    expect(g.split('\n').at(-1)).toContain('Gr.');
  });

  it('prints no null/undefined for missing fields and no empty class block', () => {
    const g = renderGuidelines({
      ...ASD,
      platformUrl: null,
      classes: [
        {
          kind: 'wyklad',
          name: 'Wykład',
          assessment: null,
          assessmentNote: null,
          platformUrl: null,
          groups: [],
          lecturers: [{ name: 'Jan Nowak', title: null, group: null }],
        },
      ],
    });
    expect(g).not.toMatch(/null|undefined/);
    expect(g).toContain('Jan Nowak');
    const bare = renderGuidelines({ ...ASD, platformUrl: null, classes: [] });
    expect(bare).not.toMatch(/null|undefined|Lecturers/);
    expect(bare).not.toMatch(/\n\n\n/);
  });

  it('is capped at 4096 characters', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      name: `Wykładowca Numer ${i}`,
      title: 'prof. dr hab.',
      group: i,
    }));
    const g = renderGuidelines({
      ...ASD,
      classes: [{ ...ASD.classes[0], lecturers: many }],
    });
    expect(g.length).toBeLessThanOrEqual(4096);
  });
});
