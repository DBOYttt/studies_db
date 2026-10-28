import { describe, expect, it } from 'vitest';
import { newEventDefaults, newEventHeading } from '../lib/event-form-page';

describe('newEventDefaults', () => {
  it('prefills the title from ?title= (trimmed, at most 100 characters)', () => {
    expect(
      newEventDefaults({ title: '  Test – ASD Laboratorium ' }).title,
    ).toBe('Test – ASD Laboratorium');
    expect(newEventDefaults({ title: 'x'.repeat(150) }).title).toHaveLength(
      100,
    );
    expect(newEventDefaults({}).title).toBe('');
    expect(newEventDefaults({ title: ['a', 'b'] }).title).toBe('');
  });
});

describe('newEventHeading', () => {
  it('says "Add test" only when the link asks for a Test', () => {
    expect(newEventHeading({ kind: 'kolokwium' })).toBe('Add test');
    expect(newEventHeading({ kind: 'egzamin' })).toBe('Add event');
    // Without ?kind= the form defaults to a Test but stays "Add event".
    expect(newEventHeading({})).toBe('Add event');
  });
});
