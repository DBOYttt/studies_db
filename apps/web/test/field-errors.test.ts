import { describe, expect, it } from 'vitest';
import {
  parseAssign,
  parseClassEdit,
  parseLecturer,
  parseSubjectAdd,
  parseSubjectEdit,
} from '@/lib/admin-forms';
import { composeWhen } from '@/lib/event-view';
import {
  eventFieldOf,
  fieldAria,
  fieldErrorId,
  withEventField,
} from '@/lib/field-errors';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

const subject = {
  name: 'Algorytmy',
  code: 'ASD',
  semester: '1',
  ects: '5',
  description: '',
};

describe('admin parse refusals name their field', () => {
  it.each([
    [{ ...subject, name: '  ' }, 'name'],
    [{ ...subject, code: 'a b' }, 'code'],
    [{ ...subject, semester: '3' }, 'semester'],
    [{ ...subject, ects: 'x' }, 'ects'],
    [{ ...subject, description: 'x'.repeat(5000) }, 'description'],
  ])('subject add %#', (o, fieldName) => {
    const p = parseSubjectAdd(form(o));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.field).toBe(fieldName);
  });

  it('subject edit: a bad link names platformUrl', () => {
    const p = parseSubjectEdit(form({ ...subject, platformUrl: 'ftp://x' }));
    expect(p).toMatchObject({ ok: false, field: 'platformUrl' });
  });

  it('class edit: an unknown assessment names assessment', () => {
    const p = parseClassEdit(
      form({ code: 'ASD', kind: 'wyklad', assessment: 'nope' }),
    );
    expect(p).toMatchObject({ ok: false, field: 'assessment' });
  });

  it('lecturer: empty name and a bad email name their fields', () => {
    expect(parseLecturer(form({ name: '' }))).toMatchObject({
      ok: false,
      field: 'name',
    });
    expect(
      parseLecturer(form({ name: 'Jan Nowak', email: 'not-an-email' })),
    ).toMatchObject({ ok: false, field: 'email' });
  });

  it('assign: no lecturer and a bad group name their fields', () => {
    expect(parseAssign(form({ code: 'ASD', kind: 'wyklad' }))).toMatchObject({
      ok: false,
      field: 'lecturerId',
    });
    expect(
      parseAssign(
        form({ code: 'ASD', lecturerId: '1', kind: 'wyklad', group: '0' }),
      ),
    ).toMatchObject({ ok: false, field: 'group' });
  });
});

describe('event refusals map to their field', () => {
  it.each([
    ['The title must be 1 to 100 characters.', 'title'],
    ['The place can be at most 100 characters.', 'place'],
    ['The note can be at most 1000 characters.', 'note'],
    ['The end must be after the start.', 'end'],
    ['The date cannot be more than a year ahead.', 'date'],
    ['Enter the date until which the event repeats.', 'until'],
  ])('%s', (message, fieldName) => {
    expect(eventFieldOf(message)).toBe(fieldName);
  });

  it("maps the form's own When messages", () => {
    const missing = composeWhen('', '', '');
    const noStart = composeWhen('2026-11-05', '', '10:00');
    if (missing.ok || noStart.ok) throw new Error('expected refusals');
    expect(eventFieldOf(missing.message)).toBe('date');
    expect(eventFieldOf(noStart.message)).toBe('start');
  });

  it('leaves other refusals general', () => {
    expect(eventFieldOf('You are banned.')).toBeUndefined();
    expect(eventFieldOf('toString')).toBeUndefined();
    expect(withEventField({ ok: false, message: 'Event not found.' })).toEqual({
      ok: false,
      message: 'Event not found.',
    });
  });

  it('adds the field to a refusal only', () => {
    expect(
      withEventField({
        ok: false,
        message: 'The title must be 1 to 100 characters.',
      }),
    ).toMatchObject({ field: 'title' });
    expect(withEventField({ ok: true, message: 'Invalid time.' })).toEqual({
      ok: true,
      message: 'Invalid time.',
    });
  });
});

describe('fieldAria', () => {
  it('marks only the field the error is about', () => {
    const err = { field: 'title' };
    expect(fieldAria(err, 'ev', 'title')).toEqual({
      'aria-invalid': true,
      'aria-describedby': fieldErrorId('ev', 'title'),
    });
    expect(fieldAria(err, 'ev', 'place')).toEqual({});
    expect(fieldAria(null, 'ev', 'title')).toEqual({});
  });

  it("keeps the input's own description first", () => {
    expect(fieldAria({ field: 'start' }, 'ev', 'start', 'hint')).toEqual({
      'aria-invalid': true,
      'aria-describedby': 'hint ev-start-error',
    });
    expect(fieldAria(null, 'ev', 'start', 'hint')).toEqual({
      'aria-describedby': 'hint',
    });
  });
});
