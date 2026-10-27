import { describe, expect, it } from 'vitest';
import { blockDayPrefix, quizStatus, STATUS } from '../lib/status-text';

describe('quizStatus', () => {
  it('names the groups a change applies to', () => {
    expect(quizStatus('on', { groupLabel: 'All groups' })).toBe(
      'Entry quiz turned on for all groups.',
    );
    expect(quizStatus('on', { groupLabel: 'Gr. 2' })).toBe(
      'Entry quiz turned on for Gr. 2.',
    );
    expect(quizStatus('off', { groupLabel: 'All groups' })).toBe(
      'Entry quiz turned off for all groups.',
    );
    expect(quizStatus('restore', { groupLabel: 'Gr. 1' })).toBe(
      'Entry quiz restored for Gr. 1.',
    );
    expect(quizStatus('note', { groupLabel: 'Gr. 1' })).toBe('Note saved.');
    expect(
      quizStatus('unskip', { groupLabel: 'All groups', date: 'Tue 29 Sep' }),
    ).toBe('Entry quiz back on Tue 29 Sep.');
  });

  it('prefixes the class when the section lists several', () => {
    expect(
      quizStatus('on', { className: 'Wykład', groupLabel: 'All groups' }),
    ).toBe('Wykład: entry quiz turned on for all groups.');
    expect(
      quizStatus('note', { className: 'Ćwiczenia', groupLabel: 'Gr. 1' }),
    ).toBe('Ćwiczenia: note saved.');
  });
});

describe('STATUS', () => {
  it('has the fixed success messages', () => {
    expect(STATUS).toEqual({
      groupSaved: 'Group saved.',
      groupsCleared: 'Groups cleared.',
      remindersSaved: 'Reminders saved.',
      sessionFilled: 'Date, time and place filled in.',
      postLinked: 'Post linked.',
      postUnlinked: 'Post unlinked.',
    });
  });
});

describe('blockDayPrefix', () => {
  it('starts a timetable block name with its day and time', () => {
    const d = new Date(Date.UTC(2026, 9, 13, 10));
    expect(blockDayPrefix(d, '10:00–11:30')).toBe('Tue 13 Oct, 10:00–11:30 ');
    expect(blockDayPrefix(d, 'all day')).toBe('Tue 13 Oct, all day ');
  });
});
