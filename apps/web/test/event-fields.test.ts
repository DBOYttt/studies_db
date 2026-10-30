import {
  type DbExecutor,
  type EventInput,
  parseWhen,
  validateEvent,
} from '@studies/db';
import { describe, expect, it } from 'vitest';
import { eventFieldOf, withEventField } from '@/lib/event-fields';
import { composeWhen } from '@/lib/event-view';

// The messages come from the real validators, so rewording one in
// @studies/db fails here instead of silently becoming a general alert.

const now = new Date(Date.UTC(2026, 9, 30, 12));

/** validateEvent refuses these before its first query, so no DB is needed. */
const noDb = {} as DbExecutor;
const valid: EventInput = {
  kind: 'kolokwium',
  title: 'Kolokwium',
  subjectId: null,
  classId: null,
  groupId: null,
  when: '05.11.2026 10:00-11:00',
  place: '',
  note: '',
};

async function eventMessage(patch: Partial<EventInput>): Promise<string> {
  const r = await validateEvent(noDb, { ...valid, ...patch }, now);
  if (r.ok) throw new Error('expected a refusal');
  return r.message;
}

function whenMessage(text: string): string {
  const r = parseWhen(text, now);
  if (r.ok) throw new Error(`expected a refusal for ${text}`);
  return r.message;
}

function composeMessage(date: string, start: string, end: string): string {
  const r = composeWhen(date, start, end);
  if (r.ok) throw new Error('expected a refusal');
  return r.message;
}

describe('event refusals map to their field', () => {
  it('the event validator', async () => {
    expect(eventFieldOf(await eventMessage({ title: '  ' }))).toBe('title');
    expect(eventFieldOf(await eventMessage({ title: 'x'.repeat(101) }))).toBe(
      'title',
    );
    expect(
      eventFieldOf(await eventMessage({ kind: 'nope' as EventInput['kind'] })),
    ).toBe('kind');
    expect(eventFieldOf(await eventMessage({ place: 'p'.repeat(101) }))).toBe(
      'place',
    );
    expect(eventFieldOf(await eventMessage({ note: 'n'.repeat(1001) }))).toBe(
      'note',
    );
    expect(eventFieldOf(await eventMessage({ classId: 1 }))).toBe('subjectId');
  });

  it('the date parser', () => {
    expect(eventFieldOf(whenMessage('31.02.2026'))).toBe('date');
    expect(eventFieldOf(whenMessage('01.01.2020'))).toBe('date');
    expect(eventFieldOf(whenMessage('01.01.2030'))).toBe('date');
    expect(eventFieldOf(whenMessage('05.11.2026 11:00-10:00'))).toBe('end');
  });

  it("the form's own When messages", () => {
    expect(eventFieldOf(composeMessage('', '', ''))).toBe('date');
    expect(eventFieldOf(composeMessage('2026-11-05', '', '10:00'))).toBe(
      'start',
    );
  });

  it('"Invalid time." names the input that is not a time', () => {
    const fromStart = composeMessage('2026-11-05', '25:00', '');
    const fromEnd = composeMessage('2026-11-05', '10:00', '99:99');
    const fromDb = whenMessage('05.11.2026 10:00-24:30');
    expect(eventFieldOf(fromStart, { start: '25:00', end: '' })).toBe('start');
    expect(eventFieldOf(fromEnd, { start: '10:00', end: '99:99' })).toBe('end');
    // Both inputs read as times: it cannot be told, so no field is blamed.
    expect(eventFieldOf(fromDb, { start: '10:00', end: '11:00' })).toBe(
      undefined,
    );
  });

  it('leaves other refusals general', () => {
    expect(eventFieldOf('You are banned.')).toBeUndefined();
    expect(eventFieldOf('toString')).toBeUndefined();
  });

  it('adds the field to a refusal only, reading the times from the form', () => {
    const f = new FormData();
    f.set('start', '10:00');
    f.set('end', '7:7');
    expect(
      withEventField(
        { ok: false, message: composeMessage('2026-11-05', '10:00', '7:7') },
        f,
      ),
    ).toEqual({ ok: false, message: 'Invalid time.', field: 'end' });
    expect(
      withEventField({ ok: false, message: 'Event not found.' }, f),
    ).toEqual({ ok: false, message: 'Event not found.' });
    expect(withEventField({ ok: true, message: 'Invalid time.' }, f)).toEqual({
      ok: true,
      message: 'Invalid time.',
    });
  });
});
