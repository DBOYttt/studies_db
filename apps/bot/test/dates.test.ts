import { describe, expect, it } from 'vitest';
import { instantDate, wallDate, weekTitle } from '../src/dates.js';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('dates', () => {
  it('formats wall dates and Warsaw instants', () => {
    expect(wallDate(d('2026-10-20'))).toBe('Tue 20 Oct 2026');
    // 23:30 UTC on the 19th is already the 20th in Warsaw.
    expect(instantDate(new Date('2026-10-19T23:30:00Z'))).toBe(
      'Tue 20 Oct 2026',
    );
  });

  it('spells September "Sep"', () => {
    expect(wallDate(d('2026-09-15'))).toBe('Tue 15 Sep 2026');
    expect(instantDate(new Date('2026-09-15T10:00:00Z'))).toBe(
      'Tue 15 Sep 2026',
    );
  });

  it('collapses the shared month and year in the week title', () => {
    expect(weekTitle(43, d('2026-10-19'), d('2026-10-25'))).toBe(
      'Week 43 · 19–25 Oct 2026',
    );
    expect(weekTitle(40, d('2026-09-28'), d('2026-10-04'))).toBe(
      'Week 40 · 28 Sep – 4 Oct 2026',
    );
    expect(weekTitle(1, d('2025-12-29'), d('2026-01-04'))).toBe(
      'Week 1 · 29 Dec 2025 – 4 Jan 2026',
    );
  });
});
